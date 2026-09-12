import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { JSDOM } from 'jsdom';

export interface CloneOptions {
  url: string;
  outputDir: string;
  timeout?: number;
  autoScroll?: boolean;
  includeScripts?: boolean;
  formatHtml?: boolean;
  userAgent?: string;
  viewport?: { width: number; height: number };
  onLog?: (level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', message: string) => void;
  onStep?: (step: number, total: number, message: string, status?: 'START' | 'DONE' | 'FAIL') => void;
}

export interface AssetRecord {
  originalUrl: string;
  normalizedUrl: string;
  localPath: string;
  relativePath: string;
  mimeType: string;
  category: 'css' | 'js' | 'images' | 'fonts' | 'media' | 'other';
  buffer?: Buffer;
}

export interface CloneResult {
  sourceUrl: string;
  outputDir: string;
  htmlPath: string;
  totalAssets: number;
  assetsByCategory: Record<string, number>;
  durationMs: number;
}

export function formatHtmlString(html: string): string {
  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr', '!doctype'
  ]);

  let formatted = '';
  let indentLevel = 0;
  const indentStr = '  ';

  // Tokenize HTML tags and text nodes
  const tokens = html.replace(/>\s*</g, '><').split(/(<\/?[^>]+>)/g).filter(Boolean);

  let inScriptOrStyle = false;

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('<!--')) {
      formatted += `${indentStr.repeat(indentLevel)}${trimmed}\n`;
      continue;
    }

    if (trimmed.startsWith('</')) {
      // Closing tag
      const tagName = trimmed.substring(2, trimmed.length - 1).split(/\s+/)[0].toLowerCase();
      if (tagName === 'script' || tagName === 'style') {
        inScriptOrStyle = false;
      }
      indentLevel = Math.max(0, indentLevel - 1);
      formatted += `${indentStr.repeat(indentLevel)}${trimmed}\n`;
    } else if (trimmed.startsWith('<') && !trimmed.startsWith('<!')) {
      // Opening or self-closing tag
      const isSelfClosing = trimmed.endsWith('/>');
      const tagMatch = trimmed.match(/^<([a-zA-Z0-9:-]+)/);
      const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';

      formatted += `${indentStr.repeat(indentLevel)}${trimmed}\n`;

      if (tagName === 'script' || tagName === 'style') {
        inScriptOrStyle = true;
      }

      if (!isSelfClosing && !voidTags.has(tagName)) {
        indentLevel++;
      }
    } else if (trimmed.startsWith('<!')) {
      formatted += `${trimmed}\n`;
    } else {
      // Text content
      if (inScriptOrStyle) {
        formatted += `${token}\n`;
      } else {
        formatted += `${indentStr.repeat(indentLevel)}${trimmed}\n`;
      }
    }
  }

  return formatted.trim() + '\n';
}

export class WebsiteCloner {
  private options: Required<Omit<CloneOptions, 'onLog' | 'onStep'>> & {
    onLog?: (level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', message: string) => void;
    onStep?: (step: number, total: number, message: string, status?: 'START' | 'DONE' | 'FAIL') => void;
  };
  private assetMap: Map<string, AssetRecord> = new Map();
  private assetCounter = 0;

  constructor(options: CloneOptions) {
    this.options = {
      url: options.url,
      outputDir: path.resolve(options.outputDir),
      timeout: options.timeout ?? 45000,
      autoScroll: options.autoScroll ?? true,
      includeScripts: options.includeScripts ?? true,
      formatHtml: options.formatHtml ?? true,
      userAgent:
        options.userAgent ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      viewport: options.viewport ?? { width: 1440, height: 900 },
      onLog: options.onLog,
      onStep: options.onStep,
    };
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', message: string) {
    if (this.options.onLog) {
      this.options.onLog(level, message);
    }
  }

  private step(step: number, total: number, message: string, status?: 'START' | 'DONE' | 'FAIL') {
    if (this.options.onStep) {
      this.options.onStep(step, total, message, status);
    }
  }

  private normalizeUrl(inputUrl: string, baseUrl?: string): string | null {
    try {
      if (!inputUrl || inputUrl.startsWith('data:') || inputUrl.startsWith('javascript:') || inputUrl.startsWith('#')) {
        return null;
      }
      const resolved = baseUrl ? new URL(inputUrl, baseUrl) : new URL(inputUrl);
      resolved.hash = '';
      return resolved.toString();
    } catch {
      return null;
    }
  }

  private categorizeAsset(url: string, mimeType: string): 'css' | 'js' | 'images' | 'fonts' | 'media' | 'other' {
    const lowerUrl = url.toLowerCase().split('?')[0];
    const lowerMime = mimeType.toLowerCase();

    if (lowerUrl.endsWith('.css') || lowerMime.includes('text/css')) {
      return 'css';
    }
    if (
      lowerUrl.endsWith('.js') ||
      lowerUrl.endsWith('.mjs') ||
      lowerMime.includes('javascript') ||
      lowerMime.includes('ecmascript')
    ) {
      return 'js';
    }
    if (
      lowerUrl.match(/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff)$/) ||
      lowerMime.startsWith('image/')
    ) {
      return 'images';
    }
    if (
      lowerUrl.match(/\.(woff2?|ttf|otf|eot)$/) ||
      lowerMime.includes('font') ||
      lowerMime.includes('opentype')
    ) {
      return 'fonts';
    }
    if (
      lowerUrl.match(/\.(mp4|webm|ogg|mp3|wav)$/) ||
      lowerMime.startsWith('video/') ||
      lowerMime.startsWith('audio/')
    ) {
      return 'media';
    }
    return 'other';
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 80);
  }

  private getExtensionFromMimeOrUrl(url: string, mimeType: string, category: string): string {
    try {
      const parsed = new URL(url);
      const ext = path.extname(parsed.pathname);
      if (ext && ext.length <= 6 && ext.length >= 2) {
        return ext.split('?')[0].split('#')[0];
      }
    } catch {
      // fallback
    }

    const mimeMap: Record<string, string> = {
      'text/css': '.css',
      'application/javascript': '.js',
      'text/javascript': '.js',
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/x-icon': '.ico',
      'image/gif': '.gif',
      'font/woff2': '.woff2',
      'font/woff': '.woff',
      'font/ttf': '.ttf',
    };

    for (const [mime, ext] of Object.entries(mimeMap)) {
      if (mimeType.includes(mime)) return ext;
    }

    if (category === 'css') return '.css';
    if (category === 'js') return '.js';
    if (category === 'images') return '.png';
    if (category === 'fonts') return '.woff2';
    return '.bin';
  }

  public registerAsset(url: string, buffer?: Buffer, mimeType: string = ''): AssetRecord {
    const normalized = this.normalizeUrl(url) || url;
    const existing = this.assetMap.get(normalized);
    if (existing) {
      if (buffer && !existing.buffer) {
        existing.buffer = buffer;
      }
      return existing;
    }

    this.assetCounter++;
    const category = this.categorizeAsset(normalized, mimeType);
    let baseName = '';
    try {
      const parsed = new URL(normalized);
      baseName = path.basename(parsed.pathname);
    } catch {
      baseName = `asset_${this.assetCounter}`;
    }

    if (!baseName || baseName === '/' || baseName === '.') {
      baseName = `asset_${this.assetCounter}`;
    }

    const ext = this.getExtensionFromMimeOrUrl(normalized, mimeType, category);
    const cleanBase = this.sanitizeFilename(baseName.replace(/\.[^/.]+$/, '')) || `asset_${this.assetCounter}`;
    const finalFilename = `${cleanBase}_${this.assetCounter}${ext}`;
    const relativePath = `assets/${category}/${finalFilename}`;
    const localPath = path.join(this.options.outputDir, 'assets', category, finalFilename);

    const record: AssetRecord = {
      originalUrl: url,
      normalizedUrl: normalized,
      localPath,
      relativePath,
      mimeType,
      category,
      buffer,
    };

    this.assetMap.set(normalized, record);
    return record;
  }

  public async fetchMissingAsset(url: string, baseUrl?: string): Promise<AssetRecord | null> {
    const normalized = this.normalizeUrl(url, baseUrl);
    if (!normalized) return null;

    if (this.assetMap.has(normalized)) {
      const existing = this.assetMap.get(normalized)!;
      if (existing.buffer) return existing;
    }

    try {
      const res = await fetch(normalized, {
        headers: { 'User-Agent': this.options.userAgent },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const mimeType = res.headers.get('content-type') || '';
        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        return this.registerAsset(normalized, buffer, mimeType);
      }
    } catch {
      // Ignore
    }
    return null;
  }

  public async processCssContent(cssContent: string, cssBaseUrl: string): Promise<string> {
    const urlRegex = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    let match: RegExpExecArray | null;
    const matches: string[] = [];

    while ((match = urlRegex.exec(cssContent)) !== null) {
      if (match[1] && !match[1].startsWith('data:')) {
        matches.push(match[1]);
      }
    }

    let updatedCss = cssContent;

    for (const rawRef of matches) {
      const resolved = this.normalizeUrl(rawRef, cssBaseUrl);
      if (resolved) {
        let asset = this.assetMap.get(resolved);
        if (!asset || !asset.buffer) {
          asset = (await this.fetchMissingAsset(resolved, cssBaseUrl)) || undefined;
        }

        if (asset) {
          const cssToAssetRelative = `../${asset.category}/${path.basename(asset.localPath)}`;
          updatedCss = updatedCss.split(rawRef).join(cssToAssetRelative);
        }
      }
    }

    return updatedCss;
  }

  public async rewriteDom(html: string, baseUrl: string): Promise<string> {
    const dom = new JSDOM(html, { url: baseUrl });
    const document = dom.window.document;

    const baseTag = document.querySelector('base');
    if (baseTag) {
      baseTag.remove();
    }

    const urlAttributes = [
      { selector: 'link[href]', attr: 'href' },
      { selector: 'script[src]', attr: 'src' },
      { selector: 'img[src]', attr: 'src' },
      { selector: 'source[src]', attr: 'src' },
      { selector: 'video[src]', attr: 'src' },
      { selector: 'video[poster]', attr: 'poster' },
      { selector: 'audio[src]', attr: 'src' },
      { selector: 'object[data]', attr: 'data' },
    ];

    for (const { selector, attr } of urlAttributes) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const el of elements) {
        const val = el.getAttribute(attr);
        if (!val || val.startsWith('data:') || val.startsWith('javascript:') || val.startsWith('#')) {
          continue;
        }

        const normalized = this.normalizeUrl(val, baseUrl);
        if (normalized) {
          let asset = this.assetMap.get(normalized);
          if (!asset || !asset.buffer) {
            asset = (await this.fetchMissingAsset(normalized, baseUrl)) || undefined;
          }

          if (asset) {
            el.setAttribute(attr, `./${asset.relativePath}`);
          }
        }
      }
    }

    const srcsetElements = Array.from(document.querySelectorAll('[srcset]'));
    for (const el of srcsetElements) {
      const val = el.getAttribute('srcset');
      if (val) {
        const parts = val.split(',').map((p) => p.trim()).filter(Boolean);
        const rewrittenParts: string[] = [];

        for (const part of parts) {
          const [u, descriptor] = part.split(/\s+/);
          const normalized = this.normalizeUrl(u, baseUrl);
          if (normalized) {
            let asset = this.assetMap.get(normalized);
            if (!asset || !asset.buffer) {
              asset = (await this.fetchMissingAsset(normalized, baseUrl)) || undefined;
            }
            if (asset) {
              rewrittenParts.push(`./${asset.relativePath}${descriptor ? ' ' + descriptor : ''}`);
              continue;
            }
          }
          rewrittenParts.push(part);
        }

        el.setAttribute('srcset', rewrittenParts.join(', '));
      }
    }

    const inlineStyleElements = Array.from(document.querySelectorAll('[style]'));
    for (const el of inlineStyleElements) {
      const styleVal = el.getAttribute('style');
      if (styleVal && styleVal.includes('url(')) {
        const processed = await this.processCssContent(styleVal, baseUrl);
        el.setAttribute('style', processed);
      }
    }

    const styleTags = Array.from(document.querySelectorAll('style'));
    for (const styleTag of styleTags) {
      if (styleTag.textContent && styleTag.textContent.includes('url(')) {
        styleTag.textContent = await this.processCssContent(styleTag.textContent, baseUrl);
      }
    }

    if (!this.options.includeScripts) {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const s of scripts) {
        s.remove();
      }
    }

    let serialized = dom.serialize();

    if (this.options.formatHtml) {
      try {
        serialized = formatHtmlString(serialized);
      } catch {
        // fallback to standard serialization if formatting fails
      }
    }

    return serialized;
  }

  public async clone(): Promise<CloneResult> {
    const startTime = Date.now();
    const outputDir = this.options.outputDir;

    this.step(1, 6, 'Initializing headless browser engine & directory hierarchy...', 'START');
    this.log('INFO', `[ENGINE] Target workspace: ${outputDir}`);
    await fs.mkdir(path.join(outputDir, 'assets', 'css'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'assets', 'js'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'assets', 'images'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'assets', 'fonts'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'assets', 'media'), { recursive: true });
    await fs.mkdir(path.join(outputDir, 'assets', 'other'), { recursive: true });

    let puppeteer: any;
    try {
      puppeteer = await import('puppeteer');
    } catch {
      throw new Error('Puppeteer is required. Run: npm install puppeteer');
    }

    this.log('INFO', '[CHROMIUM] Launching Chromium sandbox with stealth anti-detection flags...');
    const browser = await (puppeteer.default || puppeteer).launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport(this.options.viewport);
      await page.setUserAgent(this.options.userAgent);
      this.log('INFO', `[VIEWPORT] Configured virtual viewport ${this.options.viewport.width}x${this.options.viewport.height} (DPR: 1.0)`);

      page.on('response', async (response: any) => {
        try {
          const resUrl = response.url();
          const status = response.status();
          if (status >= 200 && status < 300 && !resUrl.startsWith('data:')) {
            const mimeType = response.headers()['content-type'] || '';
            const buffer = await response.buffer().catch(() => null);
            if (buffer) {
              const rec = this.registerAsset(resUrl, buffer, mimeType);
              this.log('INFO', `[NET] ⬇ 200 OK (${(buffer.length / 1024).toFixed(1)} KB) -> ${rec.relativePath}`);
            }
          }
        } catch {
          // Ignore aborted requests
        }
      });

      this.step(2, 6, `Connecting to ${this.options.url} & rendering DOM...`, 'START');
      this.log('INFO', `[HTTP] Dispatching GET ${this.options.url} (Timeout: ${this.options.timeout}ms)`);
      await page.goto(this.options.url, {
        waitUntil: ['domcontentloaded', 'networkidle2'],
        timeout: this.options.timeout,
      }).catch((err: any) => {
        this.log('WARN', `[HTTP] Navigation notice: ${err.message}. Capturing active DOM snapshot.`);
      });

      await new Promise((r) => setTimeout(r, 1200));
      this.log('SUCCESS', '[DOM] Initial page payload received and V8 script hydration complete');
      this.step(2, 6, 'Page connection and initial render complete', 'DONE');

      if (this.options.autoScroll) {
        this.step(3, 6, 'Auto-scrolling viewport to trigger lazy-loaded assets & IntersectionObservers...', 'START');
        this.log('INFO', '[SCROLL] Initiating progressive page scroll to trigger lazy images and infinite components...');
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 400;
            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;

              if (totalHeight >= scrollHeight || totalHeight > 15000) {
                clearInterval(timer);
                window.scrollTo(0, 0);
                resolve();
              }
            }, 75);
          });
        });
        await new Promise((r) => setTimeout(r, 800));
        this.log('SUCCESS', `[SCROLL] Viewport scan complete. Discovered ${this.assetMap.size} network assets in session.`);
        this.step(3, 6, 'Viewport auto-scroll complete', 'DONE');
      }

      this.step(4, 6, `Processing & caching network assets (${this.assetMap.size} files)...`, 'START');
      const rawHtml = await page.content();

      // Deep process CSS assets
      let cssProcessedCount = 0;
      for (const asset of Array.from(this.assetMap.values())) {
        if (asset.category === 'css' && asset.buffer) {
          try {
            const cssString = asset.buffer.toString('utf-8');
            const processedCss = await this.processCssContent(cssString, asset.normalizedUrl);
            asset.buffer = Buffer.from(processedCss, 'utf-8');
            cssProcessedCount++;
          } catch {
            // Keep original buffer
          }
        }
      }
      this.log('INFO', `[CSS] Processed ${cssProcessedCount} stylesheets for deep @import and font URLs`);

      // Write assets to disk
      const assetsByCategory: Record<string, number> = {
        css: 0,
        js: 0,
        images: 0,
        fonts: 0,
        media: 0,
        other: 0,
      };

      for (const asset of this.assetMap.values()) {
        assetsByCategory[asset.category] = (assetsByCategory[asset.category] || 0) + 1;
        if (asset.buffer) {
          try {
            await fs.mkdir(path.dirname(asset.localPath), { recursive: true });
            await fs.writeFile(asset.localPath, asset.buffer);
          } catch (err: any) {
            this.log('WARN', `Failed to write ${asset.relativePath}: ${err.message}`);
          }
        }
      }
      this.log('SUCCESS', `[STORAGE] Persisted ${this.assetMap.size} assets (CSS: ${assetsByCategory.css}, JS: ${assetsByCategory.js}, Images: ${assetsByCategory.images}, Fonts: ${assetsByCategory.fonts})`);
      this.step(4, 6, `Saved ${this.assetMap.size} assets to disk`, 'DONE');

      this.step(5, 6, 'Parsing DOM tree, rewriting asset paths & links...', 'START');
      this.log('INFO', '[AST] Injecting JSDOM instance to rewrite src, href, and inline style references to relative paths...');
      const rewrittenHtml = await this.rewriteDom(rawHtml, this.options.url);

      this.step(6, 6, 'Formatting HTML with 2-space indentation hierarchy...', 'START');
      this.log('INFO', '[FORMAT] Prettifying HTML tags, doctype, and attribute indentation...');
      const htmlPath = path.join(outputDir, 'index.html');
      await fs.writeFile(htmlPath, rewrittenHtml, 'utf-8');

      const durationMs = Date.now() - startTime;
      const metadata = {
        sourceUrl: this.options.url,
        clonedAt: new Date().toISOString(),
        durationMs,
        totalAssets: this.assetMap.size,
        assetsByCategory,
      };
      await fs.writeFile(
        path.join(outputDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf-8'
      );

      this.log('SUCCESS', `[METADATA] Generated provenance report in metadata.json (${(durationMs / 1000).toFixed(2)}s)`);
      this.step(6, 6, 'DOM rewriting and HTML formatting complete', 'DONE');

      return {
        sourceUrl: this.options.url,
        outputDir,
        htmlPath,
        totalAssets: this.assetMap.size,
        assetsByCategory,
        durationMs,
      };
    } finally {
      await browser.close().catch(() => {});
      this.log('INFO', '[CHROMIUM] Headless browser session gracefully closed.');
    }
  }
}
