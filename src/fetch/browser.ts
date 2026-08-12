/**
 * Browser tier of `webcmd web fetch`.
 *
 * Renders a page in a real browser and extracts the main content with DOM
 * heuristics:
 *   1. <article> element
 *   2. [role="main"] element
 *   3. <main> element
 *   4. Largest text-dense block as fallback
 *
 * Pipes through the shared article-download pipeline (Turndown + image download).
 *
 * This is the escalation target when the plain and impit tiers in `client.ts`
 * cannot read a page. It moved here from `clis/web/fetch-browser.js` so the
 * whole fetch ladder ships in the core package rather than an adapter that was
 * never installed by default (#247).
 */
import { articleHtmlToMarkdown, downloadArticle } from '../download/article-download.js';
import type { CommandArgs } from '../registry.js';
import type { IPage } from '../types.js';

export const DEFAULT_OUTPUT_DIR = './web-articles';

const NETWORK_IDLE_QUIET_MS = 1000;
const NETWORK_IDLE_POLL_MS = 500;
const MIN_NON_STRUCTURAL_IFRAME_TEXT_CHARS = 50;

export type FrameMode = 'same-origin' | 'all-same-origin' | 'none';
export type WaitUntil = 'domstable' | 'networkidle';

export interface NetworkEntry {
  method: string;
  url: string;
  status: number;
  contentType: string;
  size: number;
  bodyTruncated: boolean;
}

export interface FrameDiagnostic {
  index: number;
  src: string;
  title: string;
  sameOrigin: boolean;
  accessible: boolean;
  textLength: number;
}

export interface ExtractedPage {
  title: string;
  author: string;
  publishTime: string;
  contentHtml: string;
  imageUrls: string[];
  diagnostics: {
    url: string;
    frames: FrameDiagnostic[];
    emptyContainers: Array<{ scope: string; url: string; tag: string; id: string; className: string }>;
    includedFrameCount: number;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function boolish(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}

export function normalizeFrameMode(value: unknown): FrameMode {
  const mode = String(value || 'same-origin').toLowerCase();
  if (mode === 'same-origin' || mode === 'all-same-origin' || mode === 'none') return mode;
  return 'same-origin';
}

export function normalizeWaitUntil(value: unknown): WaitUntil {
  const waitUntil = String(value || 'domstable').toLowerCase();
  if (waitUntil === 'domstable' || waitUntil === 'networkidle') return waitUntil;
  return 'domstable';
}

function normalizeNetworkEntry(entry: Record<string, unknown> | null | undefined): NetworkEntry {
  const preview = typeof entry?.responsePreview === 'string' ? entry.responsePreview : '';
  return {
    method: typeof entry?.method === 'string' ? entry.method : 'GET',
    url: typeof entry?.url === 'string' ? entry.url : '',
    status: typeof entry?.responseStatus === 'number' ? entry.responseStatus : 0,
    contentType: typeof entry?.responseContentType === 'string' ? entry.responseContentType : '',
    size: typeof entry?.responseBodyFullSize === 'number' ? entry.responseBodyFullSize : preview.length,
    bodyTruncated: entry?.responseBodyTruncated === true,
  };
}

export function isInterestingNetworkEntry(entry: NetworkEntry): boolean {
  const ct = (entry.contentType || '').toLowerCase();
  const url = entry.url || '';
  const method = (entry.method || 'GET').toUpperCase();
  const staticAsset = /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ico|map)(\?|$)/i.test(url);
  const noisy = /analytics|tracking|telemetry|beacon|pixel|gtag|fbevents/i.test(url);
  const apiLikeUrl = /\/(api|ajax|graphql|rest|service|handler)(\/|[?._-]|$)|\.(ashx|aspx|asmx|php)(\?|$)/i.test(url);
  const dataLikeContent = ct.includes('json')
    || ct.includes('xml')
    || ct.includes('text/plain')
    || ct.includes('javascript')
    || (apiLikeUrl && ct.includes('text/html'));
  return (
    !staticAsset
    && !noisy
    && (dataLikeContent || apiLikeUrl || method !== 'GET')
  );
}

async function drainNetworkCapture(page: IPage, sink: NetworkEntry[]): Promise<NetworkEntry[]> {
  if (!page.readNetworkCapture) return [];
  const raw = await page.readNetworkCapture().catch(() => []);
  const entries = Array.isArray(raw)
    ? raw.map(entry => normalizeNetworkEntry(entry as Record<string, unknown>)).filter(entry => entry.url)
    : [];
  sink.push(...entries);
  return entries;
}

async function maybeStartNetworkCapture(page: IPage): Promise<boolean> {
  if (!page.startNetworkCapture) return false;
  try {
    return await page.startNetworkCapture('');
  } catch {
    return false;
  }
}

async function waitForNetworkIdle(page: IPage, maxSeconds: number, sink: NetworkEntry[]): Promise<{ ok: boolean; timedOut?: boolean }> {
  const timeoutMs = Math.max(1, Number(maxSeconds) || 1) * 1000;
  const deadline = Date.now() + timeoutMs;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    const entries = await drainNetworkCapture(page, sink);
    if (entries.length > 0) quietSince = Date.now();
    if (Date.now() - quietSince >= NETWORK_IDLE_QUIET_MS) return { ok: true };
    await sleep(NETWORK_IDLE_POLL_MS);
  }
  return { ok: false, timedOut: true };
}

export function buildWaitForSelectorAcrossFramesJs(selector: string, timeoutMs: number): string {
  return `
      (async () => {
        const selector = ${JSON.stringify(selector)};
        const timeoutAt = Date.now() + ${Number(timeoutMs) || 10000};
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const sameOriginFrameDocs = () => Array.from(document.querySelectorAll('iframe')).map((frame) => {
          try {
            const href = new URL(frame.getAttribute('src') || frame.src || '', window.location.href).href;
            if (new URL(href).origin !== window.location.origin) return null;
            return { href, doc: frame.contentDocument };
          } catch {
            return null;
          }
        }).filter(Boolean);
        const findMatch = () => {
          try {
            if (document.querySelector(selector)) return { ok: true, scope: 'main', url: window.location.href };
          } catch (err) {
            return { ok: false, invalidSelector: true, error: String(err && err.message || err) };
          }
          for (const frame of sameOriginFrameDocs()) {
            try {
              if (frame.doc?.querySelector(selector)) return { ok: true, scope: 'iframe', url: frame.href };
            } catch {}
          }
          return { ok: false };
        };
        while (Date.now() < timeoutAt) {
          const found = findMatch();
          if (found.ok || found.invalidSelector) return found;
          await sleep(100);
        }
        return { ok: false, timedOut: true, selector };
      })()
    `;
}

export function buildRenderAwareExtractorJs(options: { frames: FrameMode }): string {
  return `
      (() => {
        const frameMode = ${JSON.stringify(options.frames)};
        const minNonStructuralIframeTextChars = ${MIN_NON_STRUCTURAL_IFRAME_TEXT_CHARS};
        const result = {
          title: '',
          author: '',
          publishTime: '',
          contentHtml: '',
          imageUrls: [],
          diagnostics: {
            url: window.location.href,
            frames: [],
            emptyContainers: [],
            includedFrameCount: 0
          }
        };

        const absolutize = (value, base) => {
          if (!value || value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('#')) return value || '';
          try { return new URL(value, base).href; } catch { return value; }
        };
        const absolutizeTree = (root, base) => {
          root.querySelectorAll?.('[href]').forEach(el => el.setAttribute('href', absolutize(el.getAttribute('href'), base)));
          root.querySelectorAll?.('[src]').forEach(el => el.setAttribute('src', absolutize(el.getAttribute('src'), base)));
          root.querySelectorAll?.('[poster]').forEach(el => el.setAttribute('poster', absolutize(el.getAttribute('poster'), base)));
          root.querySelectorAll?.('[action]').forEach(el => el.setAttribute('action', absolutize(el.getAttribute('action'), base)));
        };
        const textLen = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim().length;
        const describeFrame = (frame, index) => {
          const rawSrc = frame.getAttribute('src') || frame.src || '';
          let href = '';
          try { href = new URL(rawSrc, window.location.href).href; } catch { href = rawSrc; }
          let sameOrigin = false;
          try { sameOrigin = href ? new URL(href).origin === window.location.origin : false; } catch {}
          let accessible = false;
          let title = frame.getAttribute('title') || frame.getAttribute('name') || frame.id || '';
          let length = 0;
          try {
            accessible = !!frame.contentDocument;
            title = title || frame.contentDocument?.title || '';
            length = textLen(frame.contentDocument?.body);
          } catch {}
          return { index, src: href, title, sameOrigin, accessible, textLength: length };
        };
        const collectEmptyContainers = (root, scope, baseUrl) => {
          const likely = 'table, tbody, ul[id], ol[id], div[id], section[id], [class*="grid"], [class*="data"], [class*="list"], [id*="grid"], [id*="data"], [id*="list"]';
          root.querySelectorAll?.(likely).forEach((el) => {
            if (scope === 'main' && el.closest?.('[data-webcmd-iframe-source]')) return;
            const id = el.getAttribute('id') || '';
            const cls = el.getAttribute('class') || '';
            const name = [id, cls].join(' ').toLowerCase();
            if (!/(grid|data|list|table|content|result)/.test(name) && !['TABLE', 'TBODY', 'UL', 'OL'].includes(el.nodeName)) return;
            if (textLen(el) > 20) return;
            result.diagnostics.emptyContainers.push({
              scope,
              url: baseUrl,
              tag: el.tagName.toLowerCase(),
              id,
              className: cls,
            });
          });
        };
        const hasDataContainerSignal = (root) => {
          const likely = 'table, tbody, ul[id], ol[id], [id*="grid"], [id*="data"], [id*="list"], [id*="content"], [id*="result"], [class*="grid"], [class*="data"], [class*="list"], [class*="content"], [class*="result"]';
          return !!root.querySelector?.(likely);
        };
        const shouldIncludeExternalFrame = (frameBody) => {
          // Outside-content iframes are less trusted than placeholders inside
          // contentEl. Long plain text is the fallback for simple same-origin
          // frames that lack article/table/list structure.
          if (textLen(frameBody) >= minNonStructuralIframeTextChars) return true;
          if (frameBody.querySelector?.('article, main, [role="main"], table, tbody, ul li, ol li')) return true;
          return hasDataContainerSignal(frameBody);
        };
        const buildFrameSection = (frameBody, desc, fallbackLabel) => {
          absolutizeTree(frameBody, desc.src || window.location.href);
          collectEmptyContainers(frameBody, 'iframe', desc.src);
          const section = document.createElement('section');
          section.setAttribute('data-webcmd-iframe-source', desc.src);
          const heading = document.createElement('h2');
          heading.textContent = 'localized text iframe: ' + (desc.src || fallbackLabel);
          section.appendChild(heading);
          Array.from(frameBody.childNodes).forEach(node => section.appendChild(node));
          return section;
        };

        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) result.title = ogTitle.getAttribute('content')?.trim() || '';
        if (!result.title) result.title = document.title?.trim() || '';
        if (!result.title) result.title = document.querySelector('h1')?.textContent?.trim() || 'untitled';
        result.title = result.title.replace(/\\s*[|\\-–—]\\s*[^|\\-–—]{1,30}$/, '').trim();

        const authorMeta = document.querySelector('meta[name="author"], meta[property="article:author"], meta[name="twitter:creator"]');
        result.author = authorMeta?.getAttribute('content')?.trim() || '';

        const timeMeta = document.querySelector('meta[property="article:published_time"], meta[name="date"], meta[name="publishdate"], time[datetime]');
        if (timeMeta) {
          result.publishTime = timeMeta.getAttribute('content')
            || timeMeta.getAttribute('datetime')
            || timeMeta.textContent?.trim()
            || '';
        }

        let contentEl = null;
        const articles = document.querySelectorAll('article');
        if (articles.length === 1) {
          contentEl = articles[0];
        } else if (articles.length > 1) {
          let maxLen = 0;
          articles.forEach(a => {
            const len = textLen(a);
            if (len > maxLen) { maxLen = len; contentEl = a; }
          });
        }
        if (!contentEl) contentEl = document.querySelector('[role="main"]');
        if (!contentEl) contentEl = document.querySelector('main');
        if (!contentEl) {
          const candidates = document.querySelectorAll(
            'div[class*="content"], div[class*="article"], div[class*="post"], ' +
            'div[class*="entry"], div[class*="body"], div[id*="content"], ' +
            'div[id*="article"], div[id*="post"], section'
          );
          let maxLen = 0;
          candidates.forEach(c => {
            const len = textLen(c);
            if (len > maxLen) { maxLen = len; contentEl = c; }
          });
        }
        if (!contentEl || textLen(contentEl) < 200) contentEl = document.body;

        const clone = contentEl.cloneNode(true);
        absolutizeTree(clone, window.location.href);

        const originalFrames = Array.from(contentEl.querySelectorAll('iframe'));
        const clonedFrames = Array.from(clone.querySelectorAll('iframe'));
        const clonedFrameByOriginal = new Map();
        originalFrames.forEach((frame, index) => {
          const cloned = clonedFrames[index];
          if (cloned) clonedFrameByOriginal.set(frame, cloned);
        });
        const allFrames = Array.from(document.querySelectorAll('iframe'));
        const frameDescriptions = new Map();
        allFrames.forEach((frame, index) => frameDescriptions.set(frame, describeFrame(frame, index)));
        const getFrameDescription = (frame, fallbackIndex) => frameDescriptions.get(frame) || describeFrame(frame, fallbackIndex);
        result.diagnostics.frames = allFrames.map(frame => frameDescriptions.get(frame));

        if (frameMode === 'same-origin' || frameMode === 'all-same-origin') {
          allFrames.forEach((frame, index) => {
            const insideContent = contentEl.contains(frame);
            const cloned = insideContent ? clonedFrameByOriginal.get(frame) : null;
            if (insideContent && !cloned) return;
            const desc = getFrameDescription(frame, index);
            if (!desc.sameOrigin || !desc.accessible) return;
            try {
              const doc = frame.contentDocument;
              if (!doc?.body) return;
              const frameBody = doc.body.cloneNode(true);
              if (frameMode !== 'all-same-origin' && !insideContent && !shouldIncludeExternalFrame(frameBody)) return;
              const section = buildFrameSection(frameBody, desc, frame.getAttribute('src') || ('#' + index));
              if (insideContent) cloned.replaceWith(section);
              else clone.appendChild(section);
              result.diagnostics.includedFrameCount += 1;
            } catch {}
          });
        }

        collectEmptyContainers(clone, 'main', window.location.href);

        const noise = 'nav, header, footer, aside, .sidebar, .nav, .menu, .footer, ' +
          '.header, .comments, .comment, .ad, .ads, .advertisement, .social-share, ' +
          '.related-posts, .newsletter, .cookie-banner, script, style, noscript, iframe';
        clone.querySelectorAll(noise).forEach(el => el.remove());

        const stripWS = (s) => (s || '').replace(/\\s+/g, '');
        const dedup = (parent) => {
          const children = Array.from(parent.children || []);
          for (let i = children.length - 1; i >= 1; i--) {
            const curRaw = children[i].textContent || '';
            const prevRaw = children[i - 1].textContent || '';
            const cur = stripWS(curRaw);
            const prev = stripWS(prevRaw);
            if (cur.length < 20 || prev.length < 20) continue;
            if (cur === prev) {
              const curSpaces = (curRaw.match(/ /g) || []).length;
              const prevSpaces = (prevRaw.match(/ /g) || []).length;
              if (curSpaces >= prevSpaces) children[i - 1].remove();
              else children[i].remove();
            } else if (prev.includes(cur) && cur.length / prev.length > 0.8) {
              children[i].remove();
            } else if (cur.includes(prev) && prev.length / cur.length > 0.8) {
              children[i - 1].remove();
            }
          }
        };
        dedup(clone);
        clone.querySelectorAll('section, div').forEach(el => {
          if (el.children && el.children.length > 2) dedup(el);
        });

        clone.querySelectorAll('img').forEach(img => {
          const srcset = img.getAttribute('data-srcset') || '';
          const srcsetFirst = srcset.split(',')[0]?.trim().split(' ')[0] || '';
          const real = img.getAttribute('data-src')
            || img.getAttribute('data-original')
            || img.getAttribute('data-lazy-src')
            || srcsetFirst;
          if (real) img.setAttribute('src', absolutize(real, window.location.href));
        });

        result.contentHtml = clone.innerHTML;

        const seen = new Set();
        clone.querySelectorAll('img').forEach(img => {
          const src = img.getAttribute('src') || '';
          if (src && !src.startsWith('data:') && !seen.has(src)) {
            seen.add(src);
            result.imageUrls.push(src);
          }
        });

        return result;
      })()
    `;
}

/**
 * A page that navigates after load — a challenge interstitial handing off to
 * the real page, a client-side redirect — destroys the execution context out
 * from under `evaluate`. That is the normal case on the escalation path, since
 * escalation only happens for pages that blocked plain HTTP in the first place.
 * Retry once after letting the new document settle; a second failure is real.
 */
async function evaluateAfterNavigation<T>(page: IPage, js: string, settleSeconds: number): Promise<T> {
  try {
    return await page.evaluate<T>(js);
  } catch (error) {
    if (!/execution context was destroyed|context was destroyed|navigation/i.test(String((error as Error)?.message ?? error))) throw error;
    await page.wait(Math.max(1, settleSeconds));
    return page.evaluate<T>(js);
  }
}

export function formatDiagnostics(
  data: Partial<ExtractedPage> | null | undefined,
  networkEntries: NetworkEntry[],
  captureSupported: boolean,
): string {
  const lines: string[] = [];
  const diag = data?.diagnostics ?? ({} as Partial<ExtractedPage['diagnostics']>);
  lines.push('[web-fetch-browser diagnose]');
  lines.push(`url: ${diag.url || '-'}`);
  lines.push(`frames: ${Array.isArray(diag.frames) ? diag.frames.length : 0}, included_same_origin: ${diag.includedFrameCount || 0}`);
  for (const frame of (diag.frames || []).slice(0, 20)) {
    lines.push(`  [frame ${frame.index}] ${frame.sameOrigin ? 'same-origin' : 'cross-origin'} ${frame.accessible ? 'accessible' : 'blocked'} text=${frame.textLength || 0} ${frame.src || '-'}`);
  }
  if (Array.isArray(diag.emptyContainers) && diag.emptyContainers.length > 0) {
    lines.push(`empty_containers: ${diag.emptyContainers.length}`);
    for (const item of diag.emptyContainers.slice(0, 12)) {
      const selector = `${item.tag}${item.id ? `#${item.id}` : ''}${item.className ? `.${String(item.className).trim().split(/\s+/).filter(Boolean).join('.')}` : ''}`;
      lines.push(`  ${item.scope}: ${selector} (${item.url || '-'})`);
    }
  }
  const interesting = networkEntries.filter(isInterestingNetworkEntry);
  lines.push(`network_capture: ${captureSupported ? 'enabled' : 'unavailable'}, entries=${networkEntries.length}, api_like=${interesting.length}`);
  for (const entry of interesting.slice(0, 20)) {
    lines.push(`  ${entry.method} ${entry.status || '-'} ${entry.contentType || '-'} ${entry.url}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Render `--url` in the browser and return its main content as markdown.
 *
 * This is the escalation target for `web fetch`: it deliberately writes no
 * files and downloads no images, so an escalated fetch answers in the same
 * shape as the plain and impit tiers and still honours `-f`. The file-export
 * pipeline stays behind `web fetch-browser`.
 */
export async function extractPageMarkdown(page: IPage, kwargs: CommandArgs): Promise<{ title: string; content: string }> {
  const url = String(kwargs.url);
  const waitSeconds = Number(kwargs.wait ?? 3);
  await page.goto(url);
  await page.wait(waitSeconds);
  const data = await evaluateAfterNavigation<ExtractedPage>(
    page,
    buildRenderAwareExtractorJs({ frames: normalizeFrameMode(kwargs.frames) }),
    waitSeconds,
  );
  return {
    title: data?.title || '',
    content: articleHtmlToMarkdown(data?.contentHtml || ''),
  };
}

/**
 * Render `--url` in the browser and hand the extracted article to the shared
 * download pipeline. Returns `null` in `--stdout` mode: the markdown body has
 * already gone to process.stdout inside downloadArticle(), so returning rows
 * would make Commander append table/JSON output to the same stream and break
 * piping.
 */
export async function runFetchBrowser(page: IPage, kwargs: CommandArgs, debug: boolean = false): Promise<unknown> {
  const url = String(kwargs.url);
  const waitSeconds = Number(kwargs.wait ?? 3);
  const waitUntil = normalizeWaitUntil(kwargs['wait-until']);
  const frameMode = normalizeFrameMode(kwargs.frames);
  const shouldDiagnose = boolish(kwargs.diagnose) || debug || !!process.env.WEBCMD_VERBOSE;
  const networkEntries: NetworkEntry[] = [];
  const captureSupported = (waitUntil === 'networkidle' || shouldDiagnose)
    ? await maybeStartNetworkCapture(page)
    : false;
  // Navigate to the target URL
  await page.goto(url);
  if (kwargs['wait-for']) {
    const waitResult = await page.evaluate<{ ok?: boolean; invalidSelector?: boolean; error?: string }>(
      buildWaitForSelectorAcrossFramesJs(String(kwargs['wait-for']), waitSeconds * 1000),
    );
    if (waitResult?.invalidSelector) {
      throw new Error(`Invalid --wait-for selector "${kwargs['wait-for']}": ${waitResult.error || 'querySelector failed'}`);
    }
    if (!waitResult?.ok) {
      throw new Error(`Timed out waiting for selector "${kwargs['wait-for']}" in main document or same-origin iframes`);
    }
  } else if (waitUntil !== 'networkidle') {
    await page.wait(waitSeconds);
  }
  if (waitUntil === 'networkidle') {
    if (!captureSupported) {
      throw new Error('Network capture is unavailable, so --wait-until networkidle cannot be satisfied');
    }
    const idle = await waitForNetworkIdle(page, waitSeconds, networkEntries);
    if (!idle?.ok) {
      throw new Error(`Timed out waiting for network idle after ${waitSeconds}s`);
    }
  }
  // Extract article content using browser-side heuristics
  const data = await evaluateAfterNavigation<ExtractedPage>(page, buildRenderAwareExtractorJs({ frames: frameMode }), waitSeconds);
  if (captureSupported) await drainNetworkCapture(page, networkEntries);
  if (shouldDiagnose) process.stderr.write(formatDiagnostics(data, networkEntries, captureSupported));
  // Determine Referer from URL for image downloads
  let referer = '';
  try {
    const parsed = new URL(url);
    referer = `${parsed.origin}/`;
  } catch { /* ignore */ }
  const result = await downloadArticle({
    title: data?.title || 'untitled',
    author: data?.author,
    publishTime: data?.publishTime,
    sourceUrl: url,
    contentHtml: data?.contentHtml || '',
    imageUrls: data?.imageUrls,
  }, {
    output: String(kwargs.output ?? DEFAULT_OUTPUT_DIR),
    downloadImages: kwargs['download-images'] !== false,
    imageHeaders: referer ? { Referer: referer } : undefined,
    stdout: kwargs.stdout === true,
    configureTurndown: (td) => {
      td.addRule('preserveButtons', {
        filter: (node) => node.nodeName === 'BUTTON',
        replacement: (content) => content,
      });
    },
  });
  return kwargs.stdout ? null : result;
}
