import { ProxyAgent } from 'undici';
import { Impit } from 'impit';
import { CliError, TimeoutError } from '../errors.js';
import { extractFetchedContent, type ExtractFetchedContentResult } from './extract.js';
import { createSafeProxy, type SafeProxy } from './safe-proxy.js';
import { isChallengeResponse, isJavaScriptShell } from './classify.js';

export interface WebFetchOptions { url: string; timeoutSeconds: number; maxChars: number; allowPrivate: boolean; raw?: boolean; }
export interface WebFetchResult {
  status: number; requestedUrl: string; finalUrl: string; contentType: string; tier: 'plain' | 'impit'; profile?: 'chrome' | 'firefox';
  title: string; extractionSource: ExtractFetchedContentResult['source']; truncated: boolean; content: string; bytes?: number;
}
type ResponseLike = Pick<Response, 'status' | 'headers' | 'url'> & { body?: ReadableStream<Uint8Array> | null; bytes?: () => Promise<Uint8Array>; };
type FetchLike = (url: string, options?: Record<string, unknown>) => Promise<ResponseLike>;
type ImpitClient = { fetch(url: string, options?: Record<string, unknown>): Promise<ResponseLike> };
export interface WebFetchDependencies {
  plainFetch?: FetchLike;
  createImpit?: (options: { browser: 'chrome' | 'firefox'; proxyUrl: string; timeout: number }) => ImpitClient;
  createSafeProxy?: (options: { allowPrivate: boolean }) => Promise<SafeProxy>;
}
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const BROWSER_WORKFLOW = 'Create a browser Session with `webcmd --profile work session create`, then navigate with `webcmd --profile work --session <session-id> browser run --stdin`.';

function headersOf(response: ResponseLike): Record<string, string> { return Object.fromEntries(response.headers.entries()); }
function beforeDeadline<T>(promise: Promise<T>, deadline: number, timeoutSeconds: number, cancel?: () => void): Promise<T> {
  const ms = deadline - Date.now();
  if (ms <= 0) { cancel?.(); return Promise.reject(new TimeoutError('web fetch', timeoutSeconds)); }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { cancel?.(); reject(new TimeoutError('web fetch', timeoutSeconds)); }, ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
async function readBody(response: ResponseLike, deadline: number, timeoutSeconds: number): Promise<string> {
  if (!response.body && response.bytes) {
    const bytes = await beforeDeadline(response.bytes(), deadline, timeoutSeconds);
    if (bytes.byteLength > MAX_BODY_BYTES) throw new CliError('FETCH_BODY_TOO_LARGE', 'Fetched body exceeds 10 MiB');
    return new TextDecoder().decode(bytes);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await beforeDeadline(reader.read(), deadline, timeoutSeconds, () => { void reader.cancel(); }); if (done) break; size += value.byteLength; if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new CliError('FETCH_BODY_TOO_LARGE', 'Fetched body exceeds 10 MiB'); } chunks.push(value); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
function truncate(content: string, limit: number, raw = false): { content: string; truncated: boolean } {
  if (!limit || content.length <= limit) return { content, truncated: false };
  // Raw bodies are cut at the exact limit: markup has no paragraph boundaries worth snapping to.
  const end = raw ? limit : Math.max(content.lastIndexOf('\n\n', limit), content.lastIndexOf('\n#', limit), 0) || limit;
  return { content: `${content.slice(0, end)}\n\n[webcmd: truncated at ${limit} characters; rerun with --max-chars 0]`, truncated: true };
}

export async function webFetch(options: WebFetchOptions, dependencies: WebFetchDependencies = {}): Promise<WebFetchResult> {
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  const proxy = await (dependencies.createSafeProxy ?? createSafeProxy)({ allowPrivate: options.allowPrivate });
  const remaining = () => { const ms = deadline - Date.now(); if (ms <= 0) throw new TimeoutError('web fetch', options.timeoutSeconds); return ms; };
  const plainFetch = dependencies.plainFetch ?? ((url, init) => fetch(url, init));
  const createImpit = dependencies.createImpit ?? (impitOptions => new Impit(impitOptions));
  try {
    const ladder = [undefined, 'chrome', 'firefox'] as const;
    let lastTransport: unknown;
    for (const browser of ladder) {
      try {
        const timeout = remaining();
        const response = browser
          ? await createImpit({ browser, proxyUrl: proxy.url, timeout }).fetch(options.url, { redirect: 'manual', timeout: remaining() })
          : await plainFetch(options.url, { redirect: 'manual', dispatcher: new ProxyAgent(proxy.url), signal: AbortSignal.timeout(timeout) });
        const policyError = proxy.policyError();
        if (policyError) throw new CliError('FETCH_UNSAFE_ADDRESS', policyError.message);
        const body = await readBody(response, deadline, options.timeoutSeconds);
        if (proxy.policyError()) throw new CliError('FETCH_UNSAFE_ADDRESS', proxy.policyError()!.message);
        if (isJavaScriptShell(body)) throw new CliError('FETCH_REQUIRES_BROWSER', 'This page requires browser rendering.', BROWSER_WORKFLOW);
        if (isChallengeResponse(response.status, headersOf(response), body)) {
          if (browser === 'firefox') throw new CliError('FETCH_BLOCKED', 'The site blocked non-browser fetches.', BROWSER_WORKFLOW);
          continue;
        }
        const extracted = options.raw
          ? { title: '', content: body, source: 'raw' as const }
          : extractFetchedContent({ body, contentType: response.headers.get('content-type') ?? '', url: options.url });
        const clipped = truncate(extracted.content, options.maxChars, options.raw === true);
        return { status: response.status, requestedUrl: options.url, finalUrl: response.url || options.url, contentType: response.headers.get('content-type') ?? '', tier: browser ? 'impit' : 'plain', ...(browser && { profile: browser }), title: extracted.title, extractionSource: extracted.source, truncated: clipped.truncated, content: clipped.content, ...(options.raw && { bytes: Buffer.byteLength(body) }) };
      } catch (error) {
        const policyError = proxy.policyError();
        if (policyError) throw new CliError('FETCH_UNSAFE_ADDRESS', policyError.message);
        const mapped = asFetchError(error, options.timeoutSeconds, deadline);
        if (mapped instanceof CliError) throw mapped;
        lastTransport = mapped;
      }
    }
    throw lastTransport;
  } catch (error) {
    throw asFetchError(error, options.timeoutSeconds, deadline);
  } finally { await proxy.close(); }
}

/** An aborted fetch surfaces as a DOMException; agents need the structured timeout instead. */
function asFetchError(error: unknown, timeoutSeconds: number, deadline: number): unknown {
  if (error instanceof CliError) return error;
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return new TimeoutError('web fetch', timeoutSeconds);
  // Impit reports its own deadline as a plain Error with a message we do not control, so the name
  // check misses it. Anything that fails at or past the budget is a timeout whatever it calls
  // itself; a failure with time left is a real error and is passed through untouched, so a refused
  // connection or DNS failure is never mislabelled.
  if (Date.now() >= deadline) return new TimeoutError('web fetch', timeoutSeconds);
  return error;
}
