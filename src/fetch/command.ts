import { cli, Strategy, type CommandArgs } from '../registry.js';
import { ArgumentError } from '../errors.js';
import type { WebFetchOptions, WebFetchResult } from './client.js';

/** Kept in sync with `DEFAULT_OUTPUT_DIR` in ./browser.js, which is imported
 *  lazily so Turndown and the download pipeline stay out of CLI startup. */
const DEFAULT_OUTPUT_DIR = './web-articles';

export const webFetchBrowserCommand = cli({
  site: 'web', name: 'fetch-browser', access: 'read',
  description: 'Fetch any web page in a real browser and export as Markdown',
  strategy: Strategy.COOKIE,
  navigateBefore: false, // we handle navigation ourselves
  args: [
    { name: 'url', required: true, help: 'Any web page URL' },
    { name: 'output', default: DEFAULT_OUTPUT_DIR, help: 'Output directory' },
    { name: 'download-images', type: 'boolean', default: true, help: 'Download images locally' },
    { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load' },
    { name: 'wait-for', valueRequired: true, help: 'CSS selector to wait for in the main document or same-origin iframes' },
    { name: 'wait-until', default: 'domstable', choices: ['domstable', 'networkidle'], help: 'Readiness policy after navigation: domstable or networkidle' },
    { name: 'frames', default: 'same-origin', choices: ['same-origin', 'all-same-origin', 'none'], help: 'Iframe handling mode: relevant same-origin, all-same-origin, or none' },
    { name: 'diagnose', type: 'boolean', default: false, help: 'Print render diagnostics (frames, empty containers, XHR/API-like requests) to stderr' },
    { name: 'stdout', type: 'boolean', default: false, help: 'Print markdown to stdout instead of saving to a file' },
  ],
  columns: ['title', 'author', 'publish_time', 'status', 'size', 'saved'],
  func: async (page, kwargs, debug) => (await import('./browser.js')).runFetchBrowser(page, kwargs, debug),
});

export const webFetchCommand = cli({
  site: 'web', name: 'fetch', access: 'read', strategy: Strategy.PUBLIC, browser: false,
  clientOwned: true,
  description: 'Fetch a URL with local HTTP clients', defaultFormat: 'md',
  renderMarkdown: data => (isWebFetchResult(data) ? formatWebFetchMarkdown(data) : undefined),
  args: [
    { name: 'url', type: 'string', required: true, help: 'HTTP or HTTPS URL to fetch' },
    { name: 'timeout', type: 'int', default: 30, help: 'Total fetch budget in seconds' },
    { name: 'max-chars', type: 'int', default: 50_000, help: 'Maximum extracted characters; 0 disables truncation' },
    { name: 'allow-private', type: 'boolean', default: false, help: 'Allow private and loopback destinations' },
  ],
  validateArgs: validateWebFetchArgs,
  func: async (kwargs) => {
    const { webFetch } = await import('./client.js');
    return webFetch(clientOptionsFromKwargs(kwargs));
  },
});

function clientOptionsFromKwargs(kwargs: CommandArgs): WebFetchOptions {
  return {
    url: String(kwargs.url),
    timeoutSeconds: Number(kwargs.timeout ?? 30),
    maxChars: Number(kwargs['max-chars'] ?? 50000),
    allowPrivate: kwargs['allow-private'] === true,
  };
}

function validateWebFetchArgs(kwargs: CommandArgs): void {
  let url: URL;
  try { url = new URL(String(kwargs.url)); } catch { throw new ArgumentError('--url must be an http or https URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ArgumentError('--url must be an http or https URL');
  for (const name of ['timeout', 'max-chars']) {
    if (!Number.isInteger(kwargs[name]) || kwargs[name] < 0) throw new ArgumentError(`--${name} must be a non-negative integer`);
  }
}

function isWebFetchResult(data: unknown): data is WebFetchResult {
  return typeof data === 'object' && data !== null && 'requestedUrl' in data && 'content' in data;
}

export function formatWebFetchMarkdown(result: WebFetchResult): string {
  return [`# ${result.title || 'Fetched content'}`, '', `Source: ${result.requestedUrl}`, `Final URL: ${result.finalUrl}`, `Content type: ${result.contentType || 'unknown'}`, `Extraction: ${result.extractionSource}`, '', result.content].join('\n');
}
