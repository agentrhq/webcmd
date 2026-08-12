import { cli, Strategy, type CliCommand, type CommandArgs } from '../registry.js';
import { ArgumentError, CliError } from '../errors.js';
import type { webFetch, WebFetchOptions, WebFetchResult } from './client.js';
import type { IPage } from '../types.js';

/** `./client.js` pulls in impit and undici. Both tiers import it lazily so a
 *  `webcmd <other-site> <command>` startup never pays for the fetch stack. */
const loadWebFetch = async (): Promise<typeof webFetch> => (await import('./client.js')).webFetch;

/** Kept in sync with `DEFAULT_OUTPUT_DIR` in ./browser.js, which is imported
 *  lazily so Turndown and the download pipeline stay out of CLI startup. */
const DEFAULT_OUTPUT_DIR = './web-articles';

/**
 * Failures the browser tier can still recover from. Anything else — a timeout,
 * a refused connection, an oversized body — is a real error and is rethrown, so
 * escalation never masks a broken URL as a slow one.
 */
const ESCALATION_CODES = new Set(['FETCH_BLOCKED', 'FETCH_REQUIRES_BROWSER']);

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

/**
 * The escalation runs the same browser session plumbing as `web fetch-browser`
 * — same site, strategy and navigation policy — but returns the page content
 * instead of exporting it to disk. Reusing the normalized command keeps the two
 * tiers from drifting apart; it is deliberately not registered, so `webcmd list`
 * still shows exactly two web commands.
 */
const escalationCommand = {
  ...webFetchBrowserCommand,
  func: async (page: IPage, kwargs: CommandArgs) => (await import('./browser.js')).extractPageMarkdown(page, kwargs),
} as CliCommand;

/**
 * Whether a failed HTTP fetch should be retried in a browser, and if not, why.
 *
 * The reason matters: `client.ts` raises these errors with a generic hint, and
 * an agent that reaches one deserves to know escalation was declined rather
 * than unavailable. Hosted mode is excluded on purpose — it executes adapters
 * server-side, and a hosted user's machine may have no daemon or Cloak at all,
 * so a local browser must never be launched behind their back.
 */
async function escalationDecision(allowBrowser: boolean, error: unknown): Promise<{ escalate: boolean; hint?: string }> {
  if (!(error instanceof CliError) || !ESCALATION_CODES.has(error.code)) return { escalate: false };
  if (!allowBrowser) return { escalate: false, hint: 'Re-run without --browser false to render this page in a browser.' };
  // An embedding runtime — the hosted cloud executor — calls this func directly
  // and owns browser execution itself. Self-dispatching would reach for a local
  // Chromium that a cloud worker does not have, so a blocked page would hang on
  // a CDP connect before failing. The embedder sets this; the CLI never does.
  if (process.env.WEBCMD_EMBEDDED_EXECUTOR === '1') {
    return { escalate: false, hint: 'Retry this URL with the browser-backed command: web fetch-browser.' };
  }
  const { shouldUseHostedMode } = await import('../hosted/config.js');
  if (shouldUseHostedMode()) return { escalate: false, hint: 'Hosted mode does not launch a local browser. Switch to local mode with: webcmd setup' };
  return { escalate: true };
}

/** Rethrows a declined escalation with the accurate reason attached. */
function declined(error: unknown, hint?: string): never {
  if (hint && error instanceof CliError) throw new CliError(error.code, error.message, hint);
  throw error;
}

async function escalateToBrowser(kwargs: CommandArgs, result: Partial<WebFetchResult>, debug: boolean): Promise<WebFetchResult> {
  const { executeCommand } = await import('../execution.js');
  const page = await executeCommand(escalationCommand, { url: kwargs.url, wait: kwargs.wait ?? 3, frames: 'same-origin' }, debug) as { title: string; content: string };
  return {
    status: result.status ?? 200,
    requestedUrl: String(kwargs.url),
    finalUrl: result.finalUrl ?? String(kwargs.url),
    contentType: 'text/html',
    tier: 'browser',
    title: page.title,
    extractionSource: 'browser',
    truncated: false,
    content: page.content,
  };
}

export const webFetchCommand = cli({
  site: 'web', name: 'fetch', access: 'read', strategy: Strategy.PUBLIC, browser: false,
  description: 'Fetch a URL, escalating to a real browser only if plain HTTP is blocked', defaultFormat: 'md',
  // Without this, `-f md` renders a nine-column table of the result object
  // while the fast path prints a document — same command, two shapes.
  renderMarkdown: data => (isWebFetchResult(data) ? formatWebFetchMarkdown(data) : undefined),
  args: [
    { name: 'url', type: 'string', required: true, help: 'Any http or https URL' },
    { name: 'timeout', type: 'int', default: 30, help: 'Total budget in seconds across every tier' },
    { name: 'max-chars', type: 'int', default: 50000, help: 'Truncate content at this many characters (0 disables)' },
    { name: 'allow-private', type: 'boolean', default: false, help: 'Allow fetching private/loopback addresses' },
    { name: 'browser', type: 'boolean', default: true, help: 'Escalate to a real browser when the site blocks plain HTTP (--browser false to stop at HTTP)' },
    { name: 'wait', type: 'int', default: 3, help: 'Seconds to wait after page load when escalating to the browser' },
  ],
  func: async (kwargs, debug = false) => {
    try {
      return await (await loadWebFetch())(clientOptionsFromKwargs(kwargs));
    } catch (error) {
      const decision = await escalationDecision(kwargs.browser !== false, error);
      if (!decision.escalate) declined(error, decision.hint);
      return escalateToBrowser(kwargs, {}, debug);
    }
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

function isWebFetchResult(data: unknown): data is WebFetchResult {
  return typeof data === 'object' && data !== null && 'requestedUrl' in data && 'content' in data;
}

export function formatWebFetchMarkdown(result: WebFetchResult): string {
  return [`# ${result.title || 'Fetched content'}`, '', `Source: ${result.requestedUrl}`, `Final URL: ${result.finalUrl}`, `Content type: ${result.contentType || 'unknown'}`, `Extraction: ${result.extractionSource}`, '', result.content].join('\n');
}

function clientOptions(argv: readonly string[]): WebFetchOptions & { browser: boolean; wait: number } {
  const values: Record<string, string | boolean> = {};
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2); const value = argv[index + 1];
    if (value && !value.startsWith('--')) { values[name] = value; index++; } else values[name] = true;
  }
  if (typeof values.url !== 'string' || !/^https?:\/\//i.test(values.url)) throw new ArgumentError('--url must be an http or https URL');
  const int = (name: string, fallback: number) => { const value = values[name]; const number = value === undefined ? fallback : Number(value); if (!Number.isInteger(number) || number < 0) throw new ArgumentError(`--${name} must be a non-negative integer`); return number; };
  return {
    url: values.url,
    timeoutSeconds: int('timeout', 30),
    maxChars: int('max-chars', 50000),
    allowPrivate: values['allow-private'] === true || values['allow-private'] === 'true',
    browser: !(values.browser === 'false' || values['no-browser'] === true),
    wait: int('wait', 3),
  };
}

/**
 * Client-owned fast path used by `src/main.ts`, which reaches this before
 * adapter discovery so a plain fetch never pays the startup tax. It shares
 * `webFetch` and the same escalation rule as the registered command; only the
 * argv parsing and markdown rendering are its own.
 */
export async function runClientOwnedWebFetch(argv: readonly string[], dependencies: { webFetch?: typeof webFetch; stdout?: NodeJS.WritableStream } = {}): Promise<void> {
  const options = clientOptions(argv);
  const fetcher = dependencies.webFetch ?? await loadWebFetch();
  let result: WebFetchResult;
  try {
    result = await fetcher(options);
  } catch (error) {
    const decision = await escalationDecision(options.browser, error);
    if (!decision.escalate) declined(error, decision.hint);
    result = await escalateToBrowser({ url: options.url, wait: options.wait }, {}, false);
  }
  (dependencies.stdout ?? process.stdout).write(`${formatWebFetchMarkdown(result)}\n`);
}

/**
 * `main.ts` entry point for the fast path. Renders the same error envelope every
 * other command produces instead of letting a `CliError` reach Node's default
 * handler as a raw stack trace (#246), and returns the process exit code.
 */
export async function runClientOwnedWebFetchCli(argv: readonly string[]): Promise<number> {
  const { EXIT_CODES, toEnvelope } = await import('../errors.js');
  try {
    await runClientOwnedWebFetch(argv);
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const { formatErrorEnvelope } = await import('../output.js');
    process.stderr.write(formatErrorEnvelope(toEnvelope(error), { cmdName: 'web/fetch' }));
    return error instanceof CliError ? error.exitCode : EXIT_CODES.GENERIC_ERROR;
  }
}
