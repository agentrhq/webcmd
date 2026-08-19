import type { BrowserRuntimeCommand, BrowserRuntimeResult } from '../../protocol.js';
import { extractArticle, type ExtractedArticle } from '../../article-extract.js';
import {
  captureSnapshot,
  boundSnapshotText,
  MemorySnapshotBaselineStore,
  renderSnapshotResult,
  type SnapshotBaselineStore,
} from '../../snapshot/index.js';
import { redactText, redactUrl } from '../../../observation/redaction.js';
import { articleHtmlToMarkdown } from '../../../download/article-download.js';
import { waitForDownload } from './downloads.js';
import type { SlabSessionManager } from './session-manager.js';
import type { BrowserContext, Frame, Page as PlaywrightPage } from 'playwright-core';
import { runBrowserProgram } from '../../run/runner.js';
import { BROWSER_RUN_MAX_SOURCE_BYTES } from '../../run/types.js';

const snapshotBaselines = new WeakMap<SlabSessionManager, SnapshotBaselineStore>();

function snapshotBaselineStore(manager: SlabSessionManager): SnapshotBaselineStore {
  let baselineStore = snapshotBaselines.get(manager);
  if (!baselineStore) {
    baselineStore = new MemorySnapshotBaselineStore();
    snapshotBaselines.set(manager, baselineStore);
  }
  return baselineStore;
}

class SlabActionError extends Error {
  constructor(
    readonly errorCode: string,
    error: string,
    readonly page?: string,
    readonly errorHint?: string,
  ) {
    super(error);
  }
}

export function resolveSlabCommandProfileId(manager: SlabSessionManager, command: BrowserRuntimeCommand): string {
  const requested = command.profileId ?? command.contextId;
  if (requested?.trim()) return requested.trim();

  const preferred = command.preferredContextId?.trim();
  if (!preferred) return 'default';

  const active = manager.activeProfileIds();
  if (active.includes(preferred)) return preferred;
  if (active.length === 1) return active[0];
  if (active.length > 1) {
    throw new SlabActionError(
      'profile_required',
      `Default SLAB profile "${preferred}" is not active and multiple profiles are running; choose one with --profile.`,
      undefined,
      'Run webcmd profile list, then update the default with webcmd profile use <name> or pass --profile <name>.',
    );
  }
  return preferred;
}

function invalidRequest(command: BrowserRuntimeCommand, error: string): BrowserRuntimeResult {
  return { id: command.id, ok: false, errorCode: 'invalid_request', error };
}

async function resolveLease(manager: SlabSessionManager, command: BrowserRuntimeCommand) {
  const profileId = resolveSlabCommandProfileId(manager, command);
  if (command.page) {
    const existing = await manager.findPageById(command.page, {
      profileId,
      session: command.session,
      sessionId: command.sessionId,
      surface: command.surface,
      idleTimeout: command.idleTimeout,
    });
    if (existing) return existing;
    throw new SlabActionError('stale_page_identity', `Page not found: ${command.page} — stale page identity`);
  }
  return manager.getPage({
    profileId,
    session: command.session,
    surface: command.surface,
    siteSession: command.siteSession,
    sessionKind: command.sessionKind,
    sessionId: command.sessionId,
    adapterSite: command.adapterSite,
    runId: command.runId,
    idleTimeout: command.idleTimeout,
    freshPage: command.freshPage,
    windowMode: command.windowMode,
  });
}

async function resolveExistingLease(manager: SlabSessionManager, command: BrowserRuntimeCommand) {
  const profileId = resolveSlabCommandProfileId(manager, command);
  if (command.page) {
    const existing = await manager.findPageById(command.page, {
      profileId,
      session: command.session,
      sessionId: command.sessionId,
      surface: command.surface,
      idleTimeout: command.idleTimeout,
    });
    if (existing) return existing;
    throw new SlabActionError('stale_page_identity', `Page not found: ${command.page} — stale page identity`);
  }
  const existing = await manager.findPage({
    profileId,
    session: command.session,
    surface: command.surface,
    siteSession: command.siteSession,
    sessionId: command.sessionId,
    adapterSite: command.adapterSite,
    runId: command.runId,
    idleTimeout: command.idleTimeout,
  });
  if (existing) return existing;
  throw new SlabActionError(
    'session_not_found',
    `Browser session not found: ${command.session ?? ''}`,
    undefined,
    'Start the session with browser run or navigate before requesting a snapshot.',
  );
}

function execTarget(page: PlaywrightPage, frameIndex: number | undefined, pageId: string): PlaywrightPage | Frame {
  if (frameIndex == null) return page;
  const frame = page.frames().slice(1)[frameIndex];
  if (!frame) throw new SlabActionError('frame_not_found', `Frame not found: ${frameIndex}`, pageId);
  return frame;
}

function readableSnapshotText(article: ExtractedArticle | null): { text: string; warnings: string[]; article: unknown } {
  if (!article) {
    return {
      text: 'No readable article content found. Use --snapshot-mode tree to inspect the page structure.',
      warnings: ['No readable article content found.'],
      article: null,
    };
  }
  const meta = [
    article.title ? `# ${article.title}` : '',
    article.byline ? `> Author: ${article.byline}` : '',
    article.publishedTime ? `> Published: ${article.publishedTime}` : '',
    article.siteName ? `> Site: ${article.siteName}` : '',
    `> Source: ${article.source}`,
  ].filter(Boolean);
  return {
    text: `${meta.join('\n')}\n\n${articleHtmlToMarkdown(article.html)}`.trim(),
    warnings: [],
    article: {
      title: article.title,
      byline: article.byline,
      publishedTime: article.publishedTime,
      siteName: article.siteName,
      source: article.source,
    },
  };
}

async function captureScreenshot(page: PlaywrightPage, context: BrowserContext, command: BrowserRuntimeCommand): Promise<Buffer> {
  const width = Number.isFinite(command.width) && command.width! > 0 ? Math.ceil(command.width!) : undefined;
  const height = !command.fullPage && Number.isFinite(command.height) && command.height! > 0 ? Math.ceil(command.height!) : undefined;
  const options = {
    type: command.format ?? 'png',
    quality: command.format === 'jpeg' ? command.quality : undefined,
    fullPage: command.fullPage,
  } as const;
  if (width === undefined && height === undefined) return page.screenshot(options);

  const current = page.viewportSize();
  if (current) {
    // Emulated viewport: override for the shot, then restore the prior fixed size.
    await page.setViewportSize({ width: width ?? current.width, height: height ?? current.height });
    try {
      return await page.screenshot(options);
    } finally {
      await page.setViewportSize(current);
    }
  }

  // Real-window context (viewport: null): setViewportSize can't return to a windowed
  // state, so override reversibly via CDP and clear it so the override is per-shot only.
  const windowSize = width === undefined || height === undefined
    ? await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    : { width: 0, height: 0 };
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: width ?? windowSize.width,
      height: height ?? windowSize.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
    return await page.screenshot(options);
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

export async function dispatchSlabAction(manager: SlabSessionManager, command: BrowserRuntimeCommand, signal?: AbortSignal): Promise<BrowserRuntimeResult> {
  try {
    switch (command.action) {
      case 'navigate': {
        if (!command.url) return invalidRequest(command, 'Missing url');
        const profileId = resolveSlabCommandProfileId(manager, command);
        // 'none' maps to Playwright's 'commit': sites that stream analytics forever
        // never fire the load event, so adapters gating readiness on their own
        // selector waits must be able to skip it.
        const lease = await manager.navigatePage(
          {
            profileId,
            session: command.session,
            surface: command.surface,
            siteSession: command.siteSession,
            sessionKind: command.sessionKind,
            sessionId: command.sessionId,
            adapterSite: command.adapterSite,
            runId: command.runId,
            idleTimeout: command.idleTimeout,
            freshPage: command.freshPage,
            windowMode: command.windowMode,
          },
          command.url,
          command.waitUntil === 'none' ? 'commit' : 'load',
        );
        return { id: command.id, ok: true, data: { title: await lease.page.title(), url: lease.page.url(), timedOut: false }, page: lease.pageId };
      }
      case 'exec': {
        if (!command.code) return invalidRequest(command, 'Missing code');
        const lease = await resolveLease(manager, command);
        const target = execTarget(lease.page, command.frameIndex, lease.pageId);
        const data = await target.evaluate(command.code);
        return { id: command.id, ok: true, data, page: lease.pageId };
      }
      case 'run': {
        if (typeof command.source !== 'string' || !command.source.trim()) {
          return invalidRequest(command, 'Missing source');
        }
        if (Buffer.byteLength(command.source, 'utf8') > BROWSER_RUN_MAX_SOURCE_BYTES) {
          return {
            id: command.id,
            ok: false,
            errorCode: 'BROWSER_RUN_SOURCE_LIMIT',
            error: `Browser-run source exceeds the ${BROWSER_RUN_MAX_SOURCE_BYTES}-byte limit.`,
          };
        }
        const lease = await resolveLease(manager, command);
        const scope = await manager.browserRunScope({
          profileId: lease.profileId,
          session: command.session,
          sessionId: command.sessionId,
          surface: command.surface,
          siteSession: command.siteSession,
          sessionKind: command.sessionKind,
          adapterSite: command.adapterSite,
          runId: command.runId,
          idleTimeout: command.idleTimeout,
          windowMode: command.windowMode,
        }, lease.page);
        const data = await runBrowserProgram({
          ...scope,
          pageId: lease.pageId,
        }, command.source, {
          timeoutMs: command.timeoutMs,
          maxOutputChars: command.maxOutputChars,
          memoryLimitBytes: command.memoryLimitBytes,
          snapshotDiff: command.noSnapshotDiff ? false : command.snapshotDiff,
          snapshotMode: command.snapshotMode === 'tree' ? 'tree' : 'act',
          snapshotBaselineStore: snapshotBaselineStore(manager),
          ...(signal ? { signal } : {}),
        });
        return {
          id: command.id,
          ok: true,
          data,
          page: lease.pageId,
        };
      }
      case 'snapshot': {
        const lease = await resolveExistingLease(manager, command);
        if (command.snapshotMode === 'read') {
          const readable = readableSnapshotText(await extractArticle(lease.page, { force: true }));
          const redacted = redactUrl(redactText(readable.text, { maxStringLength: Number.MAX_SAFE_INTEGER }));
          const bounded = Number.isFinite(command.maxOutputChars)
            ? boundSnapshotText(redacted, command.maxOutputChars!)
            : { value: redacted, truncated: false };
          return {
            id: command.id,
            ok: true,
            data: {
              ok: true,
              tree: bounded.value,
              article: readable.article,
              page: {
                id: lease.pageId,
                url: redactUrl(lease.page.url()),
                title: redactText(await lease.page.title().catch(() => '')),
              },
              warnings: readable.warnings,
              limits: { snapshotTruncated: bounded.truncated },
            },
            page: lease.pageId,
          };
        }
        const snapshot = await captureSnapshot(lease.page);
        const rendered = renderSnapshotResult(snapshot, {
          mode: command.snapshotMode === 'tree' ? 'tree' : 'act',
          ref: command.ref,
          maxChars: command.maxOutputChars,
        });
        const redacted = redactUrl(redactText(rendered.value, { maxStringLength: Number.MAX_SAFE_INTEGER }));
        const bounded = Number.isFinite(command.maxOutputChars)
          ? boundSnapshotText(redacted, command.maxOutputChars!)
          : { value: redacted, truncated: false };
        const warnings = [...rendered.warnings];
        if (bounded.truncated) warnings.push('Snapshot output was truncated after redaction.');
        snapshotBaselineStore(manager).set(lease.pageId, snapshot);
        return {
          id: command.id,
          ok: true,
          data: {
            ok: true,
            tree: bounded.value,
            page: {
              id: lease.pageId,
              url: redactUrl(lease.page.url()),
              title: redactText(await lease.page.title().catch(() => '')),
            },
            warnings,
            limits: { snapshotTruncated: rendered.truncated || bounded.truncated },
          },
          page: lease.pageId,
        };
      }
      case 'cookies': {
        const lease = await resolveLease(manager, command);
        const cookies = await lease.context.cookies(command.url ? [command.url] : undefined);
        const data = command.domain ? cookies.filter((cookie) => cookie.domain.includes(command.domain!)) : cookies;
        return { id: command.id, ok: true, data };
      }
      case 'screenshot': {
        const lease = await resolveLease(manager, command);
        const buffer = await captureScreenshot(lease.page, lease.context, command);
        return { id: command.id, ok: true, data: buffer.toString('base64'), page: lease.pageId };
      }
      case 'close-window': {
        if (command.page) {
          const closed = await manager.closePage({
            profileId: resolveSlabCommandProfileId(manager, command),
            session: command.session,
            surface: command.surface,
            pageId: command.page,
          });
          return { id: command.id, ok: true, data: { closed: Boolean(closed), page: closed ?? command.page, session: command.session } };
        } else {
          await manager.release({
            profileId: resolveSlabCommandProfileId(manager, command),
            session: command.session,
            surface: command.surface,
            siteSession: command.siteSession,
            sessionKind: command.sessionKind,
            sessionId: command.sessionId,
            adapterSite: command.adapterSite,
            runId: command.runId,
          });
          return { id: command.id, ok: true, data: { closed: true, session: command.session } };
        }
      }
      case 'tabs': {
        switch (command.op ?? 'list') {
          case 'list': {
            const tabs = await manager.listPages({
              profileId: resolveSlabCommandProfileId(manager, command),
              session: command.session,
              surface: command.surface,
            });
            return { id: command.id, ok: true, data: tabs };
          }
          case 'new': {
            const lease = await manager.newPage({
              profileId: resolveSlabCommandProfileId(manager, command),
              session: command.session,
              surface: command.surface,
              siteSession: command.siteSession,
              sessionKind: command.sessionKind,
              sessionId: command.sessionId,
              adapterSite: command.adapterSite,
              runId: command.runId,
              idleTimeout: command.idleTimeout,
              url: command.url,
              windowMode: command.windowMode,
            });
            return { id: command.id, ok: true, data: { title: await lease.page.title(), url: lease.page.url() }, page: lease.pageId };
          }
          case 'select': {
            const lease = await manager.selectPage({
              profileId: resolveSlabCommandProfileId(manager, command),
              session: command.session,
              surface: command.surface,
              pageId: command.page,
              index: command.index,
              windowMode: command.windowMode,
            });
            if (!lease) return { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: 'Tab not found' };
            return { id: command.id, ok: true, data: { selected: true, url: lease.page.url() }, page: lease.pageId };
          }
          case 'close': {
            const closed = await manager.closePage({
              profileId: resolveSlabCommandProfileId(manager, command),
              session: command.session,
              surface: command.surface,
              pageId: command.page,
              index: command.index,
            });
            if (!closed) return { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: 'Tab not found' };
            return { id: command.id, ok: true, data: { closed } };
          }
          default:
            return invalidRequest(command, `Unknown tabs op: ${command.op}`);
        }
      }
      case 'set-file-input': {
        if (!command.files?.length) return invalidRequest(command, 'Missing or empty files array');
        const lease = await resolveLease(manager, command);
        const locator = lease.page.locator(command.selector ?? 'input[type="file"]').first();
        await locator.setInputFiles(command.files);
        return { id: command.id, ok: true, data: { count: command.files.length }, page: lease.pageId };
      }
      case 'insert-text': {
        if (typeof command.text !== 'string') return invalidRequest(command, 'Missing text payload');
        const lease = await resolveLease(manager, command);
        await lease.page.keyboard.insertText(command.text);
        return { id: command.id, ok: true, data: { inserted: true }, page: lease.pageId };
      }
      case 'network-capture-start': {
        const lease = await resolveLease(manager, command);
        manager.networkCapture.start(command.pattern ?? '', lease.page);
        return { id: command.id, ok: true, data: { started: true }, page: lease.pageId };
      }
      case 'network-capture-read': {
        const lease = await resolveLease(manager, command);
        return { id: command.id, ok: true, data: await manager.networkCapture.read(lease.page), page: lease.pageId };
      }
      case 'wait-download': {
        const lease = await resolveLease(manager, command);
        const result = await waitForDownload(lease.page, command.pattern ?? '', command.timeoutMs ?? 30_000);
        return { id: command.id, ok: true, data: result, page: lease.pageId };
      }
      case 'cdp': {
        if (!command.cdpMethod) return invalidRequest(command, 'Missing cdpMethod');
        const lease = await resolveLease(manager, command);
        const session = await lease.context.newCDPSession(lease.page);
        const data = await session.send(command.cdpMethod as any, command.cdpParams ?? {});
        return { id: command.id, ok: true, data, page: lease.pageId };
      }
      case 'frames': {
        const lease = await resolveLease(manager, command);
        const frames = lease.page.frames().slice(1).map((frame, index) => ({
          index,
          frameId: frame.name() || String(index),
          url: frame.url(),
          name: frame.name(),
        }));
        return { id: command.id, ok: true, data: frames, page: lease.pageId };
      }
      case 'bind':
        if (!command.page && command.index == null) {
          return {
            id: command.id,
            ok: false,
            errorCode: 'invalid_request',
            error: 'Bind requires --page or --index for a SLAB runtime tab',
            errorHint: 'Run `webcmd --session <session-id> browser tab list`, then retry with `webcmd --session <session-id> browser bind --page <page-id>`.',
          };
        }
        {
          const lease = await manager.bindPage({
            profileId: resolveSlabCommandProfileId(manager, command),
            session: command.session,
            surface: command.surface,
            siteSession: command.siteSession,
            sessionKind: command.sessionKind,
            sessionId: command.sessionId,
            adapterSite: command.adapterSite,
            runId: command.runId,
            idleTimeout: command.idleTimeout,
            windowMode: command.windowMode,
            pageId: command.page,
            index: command.index,
          });
          if (!lease) {
            return {
              id: command.id,
              ok: false,
              errorCode: 'bound_tab_not_found',
              error: 'SLAB tab not found for bind target',
              errorHint: 'Run `webcmd --session <session-id> browser tab list` and choose a current SLAB tab id or index.',
            };
          }
          return {
            id: command.id,
            ok: true,
            page: lease.pageId,
            data: {
              bound: true,
              session: command.session,
              page: lease.pageId,
              url: lease.page.url(),
              title: await lease.page.title().catch(() => ''),
            },
          };
        }
      default:
        return { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: `Unknown action: ${command.action}` };
    }
  } catch (err) {
    if (err instanceof SlabActionError) {
      return { id: command.id, ok: false, errorCode: err.errorCode, error: err.message, ...(err.page && { page: err.page }), ...(err.errorHint && { errorHint: err.errorHint }) };
    }
    if (
      err instanceof Error
      && 'code' in err
      && typeof err.code === 'string'
      && (err.code.startsWith('BROWSER_RUN_') || err.code === 'SESSION_WINDOW_CONFLICT')
    ) {
      const hint = 'hint' in err && typeof err.hint === 'string'
        ? err.hint
        : undefined;
      const details = 'details' in err ? err.details : undefined;
      return {
        id: command.id,
        ok: false,
        errorCode: err.code,
        error: err.message,
        ...(hint && { errorHint: hint }),
        ...(details !== undefined ? { details } : {}),
      };
    }
    return { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: err instanceof Error ? err.message : String(err) };
  }
}
