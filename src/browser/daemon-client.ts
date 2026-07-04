/**
 * HTTP client for communicating with the webcmd daemon.
 *
 * Provides a typed send() function that posts a Command and returns a Result.
 */

import { sleep } from '../utils.js';
import { BrowserConnectError } from '../errors.js';
import { COMMAND_RESULT_UNKNOWN_CODE, COMMAND_RESULT_UNKNOWN_HINT } from '../daemon-utils.js';
import { classifyBrowserError } from './errors.js';
import { resolveProfileContextId } from './profile.js';
import { DEFAULT_BROWSER_CONNECT_TIMEOUT } from './config.js';
import { ensureBrowserBridgeReady } from './daemon-lifecycle.js';
import { isPreDispatchError } from './bridge-readiness.js';
import {
  fetchDaemonStatus,
  getDaemonHealth,
  requestDaemon,
  requestDaemonShutdown,
  type BrowserProfileStatus,
  type DaemonHealth,
  type DaemonStatus,
} from './daemon-transport.js';
import type { BrowserRuntimeCommand, BrowserRuntimeResult } from './protocol.js';

let _idCounter = 0;

function generateId(): string {
  return `cmd_${process.pid}_${Date.now()}_${++_idCounter}`;
}

const DEFAULT_COMMAND_TIMEOUT_SECONDS = 120;
const RUNTIME_OP_TIMEOUT_MARGIN_MS = 15_000;
const HTTP_TIMEOUT_MARGIN_MS = 10_000;
const TRANSPORT_MAX_ATTEMPTS = 4;

let _userCommandTimeoutSeconds: number | null = null;

export function setDaemonCommandTimeoutSeconds(seconds: number | null): void {
  _userCommandTimeoutSeconds = typeof seconds === 'number' && seconds > 0 ? Math.ceil(seconds) : null;
}

function effectiveCommandTimeoutSeconds(params: Omit<DaemonCommand, 'id' | 'action'>): number {
  const base = _userCommandTimeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT_SECONDS;
  if (typeof params.timeoutMs === 'number' && params.timeoutMs > 0) {
    return Math.max(base, Math.ceil((params.timeoutMs + RUNTIME_OP_TIMEOUT_MARGIN_MS) / 1000));
  }
  return base;
}

const UNKNOWN_OUTCOME_CODES = new Set([
  COMMAND_RESULT_UNKNOWN_CODE,
  'command_lost',
  'result_evicted',
]);

const PRE_CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
]);

function isPreConnectFetchError(err: unknown): boolean {
  const queue: unknown[] = [err];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const { code, cause, errors } = current as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof code === 'string' && PRE_CONNECT_ERROR_CODES.has(code)) return true;
    if (cause) queue.push(cause);
    if (Array.isArray(errors)) queue.push(...errors);
  }
  return false;
}

export type DaemonCommand = BrowserRuntimeCommand;
export type DaemonResult = BrowserRuntimeResult;

export class BrowserCommandError extends Error {
  constructor(message: string, readonly code?: string, readonly hint?: string) {
    super(message);
    this.name = 'BrowserCommandError';
  }
}

export {
  fetchDaemonStatus,
  getDaemonHealth,
  requestDaemonShutdown,
  type BrowserProfileStatus,
  type DaemonHealth,
  type DaemonStatus,
};

/**
 * Internal: send a command to the daemon and return the raw `DaemonResult`.
 *
 * Retry policy is explicit:
 * - pre-dispatch bridge/profile errors and pre-connect fetch failures run the
 *   full daemon/runtime ensure path, then resend the same command id;
 * - executor-transient errors that happened before page code ran get one new
 *   logical attempt with a fresh id;
 * - `command_result_unknown`, duplicate pending ids from old daemons,
 *   post-connect drops, and AbortError are never retried automatically.
 */
async function sendCommandRaw(
  action: DaemonCommand['action'],
  params: Omit<DaemonCommand, 'id' | 'action'>,
): Promise<DaemonResult> {
  const timeoutSeconds = effectiveCommandTimeoutSeconds(params);
  const deadlineAt = Date.now() + timeoutSeconds * 1000;
  const rawWindowMode = process.env.WEBCMD_WINDOW;
  const envWindowMode = rawWindowMode === 'foreground' || rawWindowMode === 'background'
    ? rawWindowMode
    : undefined;
  const contextId = params.contextId ?? resolveProfileContextId();
  const windowMode = params.windowMode ?? envWindowMode;

  let id = generateId();
  let ensureUsed = false;
  let semanticRetryUsed = false;

  const ensureBridge = async (): Promise<void> => {
    const remainingSeconds = Math.ceil((deadlineAt - Date.now()) / 1000);
    await ensureBrowserBridgeReady({
      timeoutSeconds: Math.max(1, Math.min(DEFAULT_BROWSER_CONNECT_TIMEOUT, remainingSeconds)),
      contextId,
      verbose: false,
    });
  };

  for (let attempt = 1; attempt <= TRANSPORT_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1 && Date.now() >= deadlineAt) {
      throw new BrowserCommandError(
        'Browser command deadline exhausted across transport retries.',
        COMMAND_RESULT_UNKNOWN_CODE,
        COMMAND_RESULT_UNKNOWN_HINT,
      );
    }

    const remainingMs = Math.max(1000, deadlineAt - Date.now());
    const command: DaemonCommand = {
      id,
      action,
      ...params,
      timeout: timeoutSeconds,
      deadlineAt,
      ...(contextId && { contextId }),
      ...(windowMode && { windowMode }),
    };
    try {
      const res = await requestDaemon('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        timeout: remainingMs + HTTP_TIMEOUT_MARGIN_MS,
      });

      const result = (await res.json()) as DaemonResult;

      if (result.ok) return result;

      if (result.errorCode && UNKNOWN_OUTCOME_CODES.has(result.errorCode)) {
        throw new BrowserCommandError(result.error ?? 'Browser command result is unknown', result.errorCode, result.errorHint);
      }

      const isDuplicateCommandId = res.status === 409
        && !result.errorCode
        && (result.error ?? '').includes('Duplicate command id');
      if (isDuplicateCommandId) {
        throw new BrowserCommandError(
          'Daemon already has this command id pending; the command may already be running.',
          COMMAND_RESULT_UNKNOWN_CODE,
          COMMAND_RESULT_UNKNOWN_HINT,
        );
      }

      if (isPreDispatchError(result.errorCode) && !ensureUsed) {
        ensureUsed = true;
        await ensureBridge();
        continue;
      }

      const advice = classifyBrowserError(new BrowserCommandError(result.error ?? '', result.errorCode));
      if (advice.kind === 'extension-transient' && !semanticRetryUsed) {
        semanticRetryUsed = true;
        id = generateId();
        await sleep(advice.delayMs);
        continue;
      }

      throw new BrowserCommandError(result.error ?? 'Daemon command failed', result.errorCode, result.errorHint);
    } catch (err) {
      if (err instanceof BrowserCommandError || err instanceof BrowserConnectError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        throw new BrowserCommandError(
          'Browser command timed out client-side; the page may still have applied it.',
          COMMAND_RESULT_UNKNOWN_CODE,
          COMMAND_RESULT_UNKNOWN_HINT,
        );
      }

      if (err instanceof TypeError) {
        await ensureBridge();
        if (isPreConnectFetchError(err)) continue;
        throw new BrowserCommandError(
          'Connection to the daemon was lost mid-command; it may have already been applied.',
          COMMAND_RESULT_UNKNOWN_CODE,
          COMMAND_RESULT_UNKNOWN_HINT,
        );
      }

      throw err;
    }
  }

  throw new BrowserCommandError('sendCommand: max attempts exhausted', 'max_attempts_exhausted');
}

/**
 * Send a command to the daemon and return the result data.
 */
export async function sendCommand(
  action: DaemonCommand['action'],
  params: Omit<DaemonCommand, 'id' | 'action'> = {},
): Promise<unknown> {
  const result = await sendCommandRaw(action, params);
  return result.data;
}

/**
 * Like sendCommand, but returns both data and page identity (targetId).
 * Use this for page-scoped commands where the caller needs the page identity.
 */
export async function sendCommandFull(
  action: DaemonCommand['action'],
  params: Omit<DaemonCommand, 'id' | 'action'> = {},
): Promise<{ data: unknown; page?: string }> {
  const result = await sendCommandRaw(action, params);
  return { data: result.data, page: result.page };
}

export async function bindTab(session: string, opts: { contextId?: string; page?: string; index?: number } = {}): Promise<unknown> {
  return sendCommand('bind', { session, surface: 'browser', ...opts });
}
