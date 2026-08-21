import fs from 'node:fs';
import type {
  Browser as PlaywrightBrowser,
  BrowserContext as PlaywrightBrowserContext,
  Page as PlaywrightPage,
} from 'playwright-core';
import {
  redactText,
  redactUrl,
  redactValue,
} from '../../observation/redaction.js';
import { LocalBrowserRunArtifactSink } from './artifacts.js';
import { PlaywrightTransport } from './playwright-transport.js';
import { QuickJSHost } from './quickjs-host.js';
import {
  captureSnapshot,
  boundSnapshotText,
  diffSnapshots,
  MemorySnapshotBaselineStore,
  renderSnapshotDiff,
  waitForPageStable,
} from '../snapshot/index.js';
import {
  BROWSER_RUN_DEFAULT_MAX_OUTPUT_CHARS,
  BROWSER_RUN_DEFAULT_MEMORY_LIMIT_BYTES,
  BROWSER_RUN_DEFAULT_TIMEOUT_MS,
  BrowserRunError,
  type BrowserRunArtifactReceipt,
  type BrowserRunArtifactSink,
  type BrowserRunFailureDetails,
  type BrowserRunLogEntry,
  type BrowserRunOptions,
  type BrowserRunResult,
  type BrowserRunTimings,
  type BrowserRunWarning,
  isClosedContextError,
} from './types.js';

export interface BrowserRunSessionScope {
  browser: PlaywrightBrowser;
  context: PlaywrightBrowserContext;
  page: PlaywrightPage;
  pages(): readonly PlaywrightPage[];
  createPage(): Promise<PlaywrightPage>;
  onPage(listener: (page: PlaywrightPage) => void): () => void;
}

export interface BrowserRunProgramHost extends BrowserRunSessionScope {
  pageId: string;
  artifactSink?: BrowserRunArtifactSink;
}

const PLAYWRIGHT_CLIENT_SOURCE = fs.readFileSync(
  new URL('./generated/playwright-client.js', import.meta.url),
  'utf8',
);

const GENERIC_TIMEOUT_HINT = 'Split the task into a smaller run or increase --timeout.';
export const DOWNLOAD_WAIT_TIMEOUT_HINT = 'A timed-out download wait is not a license to invent file contents. If a download event fired, use download.saveAs(suggestedFilename()). If none fired, report that gap. Do not rebuild the file from page logic.';

function isDownloadWait(text: string): boolean {
  return /waiting for event ["']download["']/i.test(text)
    || /waitForEvent\(\s*['"]download['"]\s*\)/.test(text);
}

function timeoutRunError(message: string, source?: string): BrowserRunError {
  const download = isDownloadWait(message) || (source !== undefined && isDownloadWait(source));
  return new BrowserRunError(
    'BROWSER_RUN_TIMEOUT',
    download && !isDownloadWait(message)
      ? 'Browser-run timed out waiting for a download.'
      : message,
    download ? DOWNLOAD_WAIT_TIMEOUT_HINT : GENERIC_TIMEOUT_HINT,
  );
}

function requirePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new BrowserRunError(
      'BROWSER_RUN_INVALID_INPUT',
      `${name} must be a positive integer.`,
    );
  }
  return resolved;
}

function normalizeExecutionError(error: unknown): Error {
  const sanitize = (value: string): string => redactUrl(redactText(value));
  if (error instanceof BrowserRunError) {
    return new BrowserRunError(
      error.code,
      sanitize(error.message),
      error.hint ? sanitize(error.hint) : undefined,
    );
  }
  if (
    error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && error.code.startsWith('BROWSER_RUN_')
  ) {
    return new BrowserRunError(
      error.code as BrowserRunError['code'],
      sanitize(error.message),
      'hint' in error && typeof error.hint === 'string'
        ? sanitize(error.hint)
        : undefined,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  const unsupported = message.match(/BROWSER_RUN_API_UNSUPPORTED:\s*(.*)/s)
    ?? message.match(/(File paths? are unavailable in the QuickJS sandbox[^.]*)/i);
  if (unsupported) {
    return new BrowserRunError(
      'BROWSER_RUN_API_UNSUPPORTED',
      sanitize(unsupported[1] ?? message),
    );
  }
  if (/Storage is disabled inside data:/i.test(message) || /Access is denied for this document/i.test(message)) {
    return new BrowserRunError(
      'BROWSER_RUN_INVALID_INPUT',
      'localStorage is disabled on data: and about:blank documents.',
      'Navigate to an http(s) URL, or use page.evaluate memory. data: pages cannot use localStorage.',
    );
  }
  if (isDownloadWait(message)) {
    return timeoutRunError(sanitize(message));
  }
  if (/interrupted|execution timeout|timed out/i.test(message)) {
    return timeoutRunError('Browser-run execution exceeded its time limit.');
  }
  if (/out of memory|memory limit/i.test(message)) {
    return new BrowserRunError(
      'BROWSER_RUN_MEMORY_LIMIT',
      'Browser-run execution exceeded its memory limit.',
    );
  }
  // A compile failure of the caller's program is tagged BROWSER_RUN_SYNTAX_ERROR where it
  // happens and returned by the code.startsWith('BROWSER_RUN_') branch above. Every
  // SyntaxError reaching here is therefore a runtime one — JSON.parse on malformed input is
  // the common case — so it keeps its own name and message like any other runtime error.
  const normalized = new Error(sanitize(message));
  normalized.name = error instanceof Error ? error.name : 'Error';
  return normalized;
}

function artifactContentType(filename: string): string {
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  return 'application/octet-stream';
}

function boundedLogs(
  logs: BrowserRunLogEntry[],
  remainingChars: number,
): { logs: BrowserRunLogEntry[]; truncated: boolean } {
  const kept: BrowserRunLogEntry[] = [];
  let used = 0;
  for (const log of logs) {
    const chars = JSON.stringify(log).length;
    if (used + chars > remainingChars) {
      return { logs: kept, truncated: true };
    }
    kept.push(log);
    used += chars;
  }
  return { logs: kept, truncated: false };
}

function javascriptStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export async function runBrowserProgram(
  input: BrowserRunProgramHost,
  source: string,
  options: BrowserRunOptions = {},
): Promise<BrowserRunResult> {
  const logs: BrowserRunLogEntry[] = [];
  const artifacts: BrowserRunArtifactReceipt[] = [];
  const warnings: BrowserRunWarning[] = [];
  const timings: BrowserRunTimings = {};
  let maxOutputChars = BROWSER_RUN_DEFAULT_MAX_OUTPUT_CHARS;
  let savedSnapshotDiff: string | undefined;
  let snapshotTruncated = false;
  let snapshotDiffOmitted = false;
  const redactionOptions = {
    maxDepth: 8,
    maxArrayItems: 100,
    maxObjectFields: 100,
    maxStringLength: BROWSER_RUN_DEFAULT_MAX_OUTPUT_CHARS,
  };
  let capturedLogChars = 0;
  let logOutputTruncated = false;

  let timedOut = false;
  const pageMetadata = async () => ({
    id: input.pageId,
    url: redactUrl(input.page.url()),
    title: timedOut ? '' : redactText(await input.page.title().catch(() => '')),
  });
  const details = async (): Promise<BrowserRunFailureDetails> => {
    const bounded = boundedLogs(logs, maxOutputChars);
    return {
      logs: bounded.logs,
      page: await pageMetadata(),
      ...(savedSnapshotDiff !== undefined && { snapshotDiff: savedSnapshotDiff }),
      artifacts,
      warnings,
      limits: {
        outputTruncated: logOutputTruncated || bounded.truncated,
        snapshotTruncated,
        ...(snapshotDiffOmitted && { snapshotDiffOmitted: true }),
      },
      ...(Object.keys(timings).length > 0 && { timings }),
    };
  };
  const failure = async (error: unknown): Promise<Error> => {
    const normalized = normalizeExecutionError(error);
    if (normalized instanceof BrowserRunError && normalized.code === 'BROWSER_RUN_TIMEOUT') {
      warnings.push({
        code: 'BROWSER_RUN_SIDE_EFFECTS_MAY_HAVE_OCCURRED',
        message: 'Already-issued browser actions were not rolled back.',
      });
    }
    if (normalized instanceof BrowserRunError) {
      return new BrowserRunError(
        normalized.code,
        normalized.message,
        normalized.hint,
        await details(),
      );
    }
    Object.assign(normalized, { details: await details() });
    return normalized;
  };

  let timeoutMs: number;
  let memoryLimitBytes: number;
  let deadlineAt: number;
  try {
    timeoutMs = requirePositiveInteger(
      options.timeoutMs,
      BROWSER_RUN_DEFAULT_TIMEOUT_MS,
      'timeoutMs',
    );
    maxOutputChars = requirePositiveInteger(
      options.maxOutputChars,
      BROWSER_RUN_DEFAULT_MAX_OUTPUT_CHARS,
      'maxOutputChars',
    );
    redactionOptions.maxStringLength = maxOutputChars;
    memoryLimitBytes = requirePositiveInteger(
      options.memoryLimitBytes,
      BROWSER_RUN_DEFAULT_MEMORY_LIMIT_BYTES,
      'memoryLimitBytes',
    );
    deadlineAt = Date.now() + timeoutMs;
  } catch (error) {
    throw await failure(error);
  }
  const snapshotMode = options.snapshotMode ?? 'act';
  const snapshotDiffEnabled = options.snapshotDiff !== false;
  const baselineStore = options.snapshotBaselineStore ?? new MemorySnapshotBaselineStore();
  if (!snapshotDiffEnabled) baselineStore.clear(input.pageId);
  let host!: QuickJSHost;
  const artifactSink = input.artifactSink ?? new LocalBrowserRunArtifactSink();
  const transport = new PlaywrightTransport(input, message => (
    host.deliverTransport(message)
  ));
  const quickjsBootStartedAt = Date.now();
  try {
    host = await QuickJSHost.create({
      memoryLimitBytes,
      maxStackSizeBytes: 2 * 1024 * 1024,
      cpuTimeoutMs: timeoutMs,
      globals: {
        __webcmdMaxLogChars: maxOutputChars,
      },
      onHostCall: async (name, args) => {
        if (
          name !== 'writeArtifact'
          || typeof args[0] !== 'string'
          || typeof args[1] !== 'string'
          || (args[2] != null && typeof args[2] !== 'string')
        ) {
          throw new BrowserRunError(
            'BROWSER_RUN_INVALID_INPUT',
            'Browser-run requested an invalid logical artifact write.',
          );
        }
        const receipt = await artifactSink.write({
          filename: args[0],
          contentType: args[2] ?? artifactContentType(args[0]),
          bytes: Buffer.from(args[1], 'base64'),
        });
        artifacts.push(receipt);
        return receipt;
      },
      onTransportSend: message => transport.send(message),
      onConsole: (level, args) => {
        const entry: BrowserRunLogEntry = {
          level,
          args: redactValue(args, redactionOptions) as unknown[],
        };
        const chars = JSON.stringify(entry).length;
        if (capturedLogChars + chars > maxOutputChars) {
          logOutputTruncated = true;
          return;
        }
        logs.push(entry);
        capturedLogChars += chars;
      },
    });
    host.installHostCall();
  } catch (error) {
    timings.quickjs_boot_ms = Math.max(0, Date.now() - quickjsBootStartedAt);
    await transport.dispose(error instanceof Error ? error : new Error(String(error)));
    throw await failure(error);
  } finally {
    timings.quickjs_boot_ms = Math.max(0, Date.now() - quickjsBootStartedAt);
  }
  const knownPages = new Set(input.pages());
  for (const page of knownPages) transport.registerPage(page);
  const registerNewPage = (page: PlaywrightPage) => {
    if (knownPages.has(page)) return;
    knownPages.add(page);
    transport.registerPage(page);
  };
  const unsubscribePages = input.onPage(registerNewPage);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutCleanup: Promise<void> | undefined;
  let execution: Promise<unknown> | undefined;
  let interrupted = false;
  const disposeTimedOutRun = (timeoutError: BrowserRunError): void => {
    if (timeoutCleanup) return;
    host.cancelPending(timeoutError);
    void transport.cancel(timeoutError);
    timeoutCleanup = host.callFunction(
      '__webcmdCancelPlaywright',
      timeoutError.message,
    )
      .catch(() => undefined)
      .then(async () => { await execution?.catch(() => undefined); })
      .finally(() => {
        host.dispose();
        void transport.dispose(timeoutError);
        unsubscribePages();
      });
  };
  try {
    const clientBundleInitStartedAt = Date.now();
    try {
    await host.executeScript(`
      (() => {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        globalThis.__webcmdEncodeBase64 = bytes => {
          let output = '';
          for (let index = 0; index < bytes.length; index += 3) {
            const chunk = (bytes[index] << 16)
              | ((bytes[index + 1] || 0) << 8)
              | (bytes[index + 2] || 0);
            output += alphabet[(chunk >>> 18) & 63] + alphabet[(chunk >>> 12) & 63]
              + (index + 1 < bytes.length ? alphabet[(chunk >>> 6) & 63] : '=')
              + (index + 2 < bytes.length ? alphabet[chunk & 63] : '=');
          }
          return output;
        };
        globalThis.__webcmdDecodeBase64 = value => {
          const output = [];
          for (let index = 0; index < value.length; index += 4) {
            const a = alphabet.indexOf(value[index]);
            const b = alphabet.indexOf(value[index + 1]);
            const c = value[index + 2] === '=' ? 64 : alphabet.indexOf(value[index + 2]);
            const d = value[index + 3] === '=' ? 64 : alphabet.indexOf(value[index + 3]);
            const chunk = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
            output.push((chunk >>> 16) & 255);
            if (c !== 64) output.push((chunk >>> 8) & 255);
            if (d !== 64) output.push(chunk & 255);
          }
          return new Uint8Array(output);
        };
        globalThis.__webcmdEncodeText = value => {
          const encoded = encodeURIComponent(String(value));
          const output = [];
          for (let index = 0; index < encoded.length; index += 1) {
            if (encoded[index] === '%') {
              output.push(parseInt(encoded.slice(index + 1, index + 3), 16));
              index += 2;
            } else {
              output.push(encoded.charCodeAt(index));
            }
          }
          return new Uint8Array(output);
        };
        globalThis.__webcmdDecodeText = bytes => {
          let encoded = '';
          for (const byte of bytes) encoded += '%' + byte.toString(16).padStart(2, '0');
          return decodeURIComponent(encoded);
        };
        // btoa/atob are latin1 binary-string codecs, not UTF-8. Composing them
        // with __webcmdEncodeText/__webcmdDecodeText would corrupt binary input.
        globalThis.btoa = value => {
          const binary = String(value);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) {
            const code = binary.charCodeAt(index);
            if (code > 255) {
              const error = new Error(
                "Failed to execute 'btoa': The string to be encoded contains "
                + 'characters outside of the Latin1 range.'
              );
              error.name = 'InvalidCharacterError';
              throw error;
            }
            bytes[index] = code;
          }
          return __webcmdEncodeBase64(bytes);
        };
        globalThis.atob = value => {
          let binary = '';
          for (const byte of __webcmdDecodeBase64(String(value))) {
            binary += String.fromCharCode(byte);
          }
          return binary;
        };
        globalThis.TextEncoder = class TextEncoder {
          get encoding() { return 'utf-8'; }
          encode(value = '') { return __webcmdEncodeText(value); }
        };
        globalThis.TextDecoder = class TextDecoder {
          get encoding() { return 'utf-8'; }
          decode(input) {
            if (input === undefined) return '';
            if (input instanceof Uint8Array) return __webcmdDecodeText(input);
            if (input instanceof ArrayBuffer) return __webcmdDecodeText(new Uint8Array(input));
            return __webcmdDecodeText(
              new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
            );
          }
        };
      })()
    `, { filename: 'browser-run-platform.js' });
    await host.executeScript(PLAYWRIGHT_CLIENT_SOURCE, {
      filename: 'playwright-client.js',
    });
    await host.executeScript(`
      (() => {
        const connection = __WebcmdPlaywrightClient.createConnection();
        const unsupported = api => {
          const error = new Error(
            'BROWSER_RUN_API_UNSUPPORTED: ' + api + ' is unavailable in browser run.'
          );
          error.name = 'BrowserRunError';
          throw error;
        };
        globalThis.__webcmdTransportReceive = message => {
          connection.dispatch(JSON.parse(message));
        };
        globalThis.writeArtifact = async (filename, bytes, contentType) => (
          __webcmdHostCall(
            'writeArtifact',
            JSON.stringify([
              filename,
              __webcmdEncodeBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
              contentType,
            ]),
          )
        );
        // Legacy alias; writeArtifact is the documented name.
        globalThis.__webcmdWriteArtifact = globalThis.writeArtifact;
        __WebcmdPlaywrightClient.quickjsPlatform.fs().promises.readFile = () => (
          unsupported('Host filesystem reads')
        );
        globalThis.__webcmdInitializePlaywright = async pageGuid => {
          const playwright = await connection.initializePlaywright();
          const suppliedBrowser = playwright._preLaunchedBrowser();
          const browserType = suppliedBrowser.browserType();
          browserType.connect = () => unsupported('BrowserType.connect');
          const selectedPage = connection.getObjectWithKnownName(pageGuid);
          if (!selectedPage) throw new Error('Selected Playwright page is unavailable.');
          const selectedContext = selectedPage.context();
          const selectedBrowser = selectedContext.browser();
          const screenshot = selectedPage.screenshot.bind(selectedPage);
          selectedPage.screenshot = async options => {
            if (!options?.path) return screenshot(options);
            const { path, type, ...rest } = options;
            const resolvedType = type || (/\.jpe?g$/i.test(path) ? 'jpeg' : 'png');
            const bytes = await screenshot({ ...rest, type: resolvedType });
            await __webcmdWriteArtifact(
              path,
              bytes,
              resolvedType === 'jpeg' ? 'image/jpeg' : 'image/png',
            );
            return bytes;
          };
          globalThis.page = selectedPage;
          globalThis.context = selectedContext;
          globalThis.browser = selectedBrowser;
        };
        let rejectRun;
        globalThis.__webcmdCancelPlaywright = message => {
          connection.close(message);
          rejectRun?.(new Error(message));
        };
        globalThis.__webcmdCompileError = (source, cause) => {
          // new AsyncFunction(body) prepends two lines of wrapper, so QuickJS reports
          // a line two ahead of the one the caller actually wrote.
          const lines = source.split('\\n');
          const line = (cause?.lineNumber ?? 0) - 2;
          const column = cause?.columnNumber ?? 0;
          const text = line >= 1 && line <= lines.length ? lines[line - 1] : undefined;
          let excerpt = '';
          if (text !== undefined) {
            const start = Math.max(0, column - 60);
            const caret = ' '.repeat(Math.max(0, column - 1 - start)) + '^';
            excerpt = '\\n  ' + text.slice(start, column + 20) + '\\n  ' + caret;
          }
          const where = line >= 1 ? ' at line ' + line + ', column ' + column : '';
          const message = cause?.message ?? 'Program failed to compile.';
          const error = new SyntaxError(message + where + excerpt);
          error.code = 'BROWSER_RUN_SYNTAX_ERROR';
          error.hint = 'Your program failed to compile; the browser was never touched. '
            + 'A common cause is an unescaped quote when embedding a URL or HTML in a '
            + 'string literal — use double quotes or a template literal for values that '
            + 'contain apostrophes.';
          return error;
        };
        globalThis.__webcmdRun = async source => {
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          let program;
          try {
            program = new AsyncFunction(source);
          } catch (cause) {
            throw __webcmdCompileError(source, cause);
          }
          let value;
          try {
            const cancellation = new Promise((_resolve, reject) => {
              rejectRun = reject;
            });
            value = await Promise.race([program(), cancellation]);
          } finally {
            rejectRun = undefined;
          }
          try {
            const serialized = JSON.stringify(value === undefined ? null : value);
            if (serialized === undefined) throw new TypeError('Result is not JSON serializable.');
            return serialized;
          } catch (cause) {
            const error = new Error('Browser-run result is not JSON serializable.');
            error.name = 'BrowserRunError';
            error.code = 'BROWSER_RUN_SERIALIZATION_ERROR';
            throw error;
          }
        };
      })()
    `, { filename: 'browser-run-bootstrap.js' });
    await host.callFunction('__webcmdInitializePlaywright', transport.pageGuid);
    } finally {
      timings.client_bundle_init_ms = Math.max(0, Date.now() - clientBundleInitStartedAt);
    }
    const timeoutError = () => timeoutRunError(
      `Browser-run execution exceeded ${timeoutMs}ms.`,
      source,
    );
    const beforeSnapshot = snapshotDiffEnabled
      ? baselineStore.get(input.pageId) ?? await captureSnapshot(input.page)
      : undefined;
    const programStartedAt = Date.now();
    execution = host.executeScript(`
      __webcmdRun(${javascriptStringLiteral(source)})
    `, {
      filename: 'browser-run.js',
    });
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw timeoutError();
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        const error = timeoutError();
        disposeTimedOutRun(error);
        reject(error);
      }, remainingMs);
    });
    const cancelled = new Promise<never>((_resolve, reject) => {
      const signal = options.signal;
      if (!signal) return;
      const abort = () => {
        interrupted = true;
        const error = new BrowserRunError('BROWSER_RUN_CANCELLED', 'Browser-run execution was cancelled.');
        disposeTimedOutRun(error);
        reject(error);
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
    execution.catch(() => {});
    let serialized: unknown;
    try {
      serialized = await Promise.race([execution, deadline, cancelled]);
    } finally {
      timings.program_ms = Math.max(0, Date.now() - programStartedAt);
      timings.browser_wait_ms = transport.browserWaitMs;
    }
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (typeof serialized !== 'string') {
      throw new BrowserRunError(
        'BROWSER_RUN_SERIALIZATION_ERROR',
        'Browser-run returned an invalid serialized result.',
      );
    }
    if (serialized.length > maxOutputChars) {
      throw new BrowserRunError(
        'BROWSER_RUN_OUTPUT_LIMIT',
        `Browser-run result exceeds the ${maxOutputChars}-character output limit.`,
        'Return a smaller value or increase --max-output.',
      );
    }
    const result = redactValue(
      JSON.parse(serialized) as unknown,
      redactionOptions,
    );
    const resultChars = JSON.stringify(result).length;
    if (resultChars > maxOutputChars) {
      throw new BrowserRunError(
        'BROWSER_RUN_OUTPUT_LIMIT',
        `Browser-run result exceeds the ${maxOutputChars}-character output limit.`,
        'Return a smaller value or increase --max-output.',
      );
    }
    const bounded = boundedLogs(logs, Math.max(0, maxOutputChars - resultChars));
    if (snapshotDiffEnabled && beforeSnapshot) {
      const snapshotStartedAt = Date.now();
      try {
        await waitForPageStable(input.page, deadlineAt - Date.now());
        const afterSnapshot = await captureSnapshot(input.page);
        baselineStore.set(input.pageId, afterSnapshot);
        const rendered = renderSnapshotDiff(
          diffSnapshots(beforeSnapshot, afterSnapshot, snapshotMode),
          maxOutputChars,
        );
        const bounded = boundSnapshotText(
          redactUrl(redactText(rendered.value, { maxStringLength: Number.MAX_SAFE_INTEGER })),
          maxOutputChars,
        );
        const diffExceededCeiling = rendered.truncated || bounded.truncated;
        snapshotTruncated ||= diffExceededCeiling;
        if (diffExceededCeiling) {
          snapshotDiffOmitted = true;
          warnings.push({
            code: 'BROWSER_RUN_SNAPSHOT_DIFF_OMITTED',
            message:
              `Snapshot diff exceeded the ${maxOutputChars}-character output ceiling and was omitted. `
              + 'If the returned result and page metadata are sufficient, continue without another observation. '
              + 'Otherwise inspect the relevant scope with a targeted browser snapshot or extraction.',
          });
        } else {
          savedSnapshotDiff = bounded.value;
        }
      } catch (snapshotError) {
        baselineStore.clear(input.pageId);
        warnings.push({
          code: 'BROWSER_RUN_SNAPSHOT_FAILED',
          message: normalizeExecutionError(snapshotError).message,
        });
        // The run itself already succeeded, so keep ok: true — but a closed-context
        // signature here means the connection is dying underneath it. Signal the
        // caller out-of-band so the dead Profile runtime doesn't get reused (#314).
        if (isClosedContextError(snapshotError)) options.onStaleContext?.();
      } finally {
        timings.snapshot_ms = (timings.snapshot_ms ?? 0) + Math.max(0, Date.now() - snapshotStartedAt);
      }
    }
    return {
      ok: true,
      result,
      logs: bounded.logs,
      page: await pageMetadata(),
      ...(savedSnapshotDiff !== undefined && {
        snapshotDiff: savedSnapshotDiff,
      }),
      artifacts,
      warnings,
      limits: {
        outputTruncated: logOutputTruncated || bounded.truncated,
        snapshotTruncated,
        ...(snapshotDiffOmitted && { snapshotDiffOmitted: true }),
      },
      timings,
    };
  } catch (error) {
    const normalized = normalizeExecutionError(error);
    if (normalized instanceof BrowserRunError && normalized.code === 'BROWSER_RUN_TIMEOUT') {
      timedOut = true;
      disposeTimedOutRun(normalized);
    }
    throw await failure(normalized);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (timedOut || interrupted) {
      void timeoutCleanup;
    } else {
      const completionError = new BrowserRunError(
        'BROWSER_RUN_CANCELLED',
        'Browser-run execution has ended.',
      );
      host.cancelPending(completionError);
      await transport.cancel(completionError);
      await host.callFunction(
        '__webcmdCancelPlaywright',
        completionError.message,
      ).catch(() => undefined);
      await transport.dispose(completionError);
      host.dispose();
      unsubscribePages();
    }
  }
}
