/**
 * Cross-process advisory lock for site memory read-modify-write updates.
 *
 * `atomicWrite()` keeps a single write from tearing, but site memory updates
 * read the current file, modify it, and write it back. Two webcmd processes
 * running that sequence against one file both read the same body and the second
 * rename discards the first process's work. The in-process promise chain in
 * local-store.ts cannot see the other process, so the critical section needs a
 * marker the filesystem can see: `open(..., 'wx')` creates the lock file only
 * when it does not already exist, atomically, on every platform we support.
 *
 * Abandoned locks never wedge site memory. A lock whose owner process is gone
 * is broken on the next attempt, and any lock older than `staleMs` is broken
 * regardless — the critical section itself is a small read plus a rename, which
 * takes milliseconds. `timeoutMs` is deliberately longer than `staleMs` so an
 * abandoned lock is always broken rather than surfaced to the user as an error.
 */
import { randomUUID } from 'node:crypto';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename } from 'node:path';
import { CliError, EXIT_CODES } from '../errors.js';
import { isActionablePid, isPidAlive } from '../session-lease.js';

/** A lock held longer than this is treated as abandoned by a crashed process. */
export const LOCK_STALE_MS = 10_000;
/** Total acquire budget. Longer than LOCK_STALE_MS so stale locks are broken, not reported. */
export const LOCK_TIMEOUT_MS = 15_000;

const RETRY_MIN_MS = 5;
const RETRY_MAX_MS = 50;

export interface FileLockOptions {
  staleMs?: number;
  timeoutMs?: number;
}

interface LockOwner {
  pid?: number;
  host?: string;
  token?: string;
  at?: string;
}

/** Lock marker for `target`, hidden from site memory readers by local-store. */
export function lockPathFor(target: string): string {
  return `${target}.lock`;
}

/** Run `fn` while holding the cross-process lock for `target`. */
export async function withFileLock<T>(target: string, fn: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  const lockPath = lockPathFor(target);
  const token = await acquire(lockPath, options);
  try {
    return await fn();
  } finally {
    await release(lockPath, token);
  }
}

async function acquire(lockPath: string, options: FileLockOptions): Promise<string> {
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
  const token = randomUUID();
  const body = `${JSON.stringify({ pid: process.pid, host: hostname(), token, at: new Date().toISOString() })}\n`;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  for (;;) {
    if (await create(lockPath, body)) return token;
    if (await breakIfAbandoned(lockPath, staleMs)) continue;
    if (Date.now() >= deadline) throw busyError(lockPath, await readOwner(lockPath), timeoutMs);
    await delay(backoffMs(attempt++));
  }
}

/** Resolves true when this call created the lock, false when someone else holds it. */
async function create(lockPath: string, body: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (err) {
    if (isNodeError(err) && err.code === 'EEXIST') return false;
    throw err;
  }
  try {
    await handle.writeFile(body, 'utf8');
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Remove a lock left behind by a dead or wedged process, and report whether the
 * caller should retry straight away. The mtime is re-read immediately before
 * unlinking so a lock that was released and re-taken while we were deciding is
 * left alone.
 */
async function breakIfAbandoned(lockPath: string, staleMs: number): Promise<boolean> {
  const before = await statOrUndefined(lockPath);
  if (!before) return true;
  const owner = await readOwner(lockPath);
  const expired = Date.now() - before.mtimeMs > staleMs;
  const ownerGone = owner.host === hostname() && isActionablePid(owner.pid) && !isPidAlive(owner.pid);
  if (!expired && !ownerGone) return false;

  const after = await statOrUndefined(lockPath);
  if (!after || after.mtimeMs !== before.mtimeMs) return true;
  await unlink(lockPath).catch(ignoreMissing);
  return true;
}

/** Never remove a lock we no longer own — it was broken and handed to another process. */
async function release(lockPath: string, token: string): Promise<void> {
  const owner = await readOwner(lockPath);
  if (owner.token !== undefined && owner.token !== token) return;
  await unlink(lockPath).catch(ignoreMissing);
}

async function readOwner(lockPath: string): Promise<LockOwner> {
  let body: string;
  try {
    body = await readFile(lockPath, 'utf8');
  } catch {
    // The holder released (or broke) the lock between our attempt and this read.
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as LockOwner : {};
  } catch {
    // A truncated or hand-written lock file still blocks; it just has no owner.
    return {};
  }
}

function busyError(lockPath: string, owner: LockOwner, timeoutMs: number): CliError {
  const file = basename(lockPath).replace(/\.lock$/, '');
  const holder = isActionablePid(owner.pid) ? ` (pid ${owner.pid})` : '';
  const stop = isActionablePid(owner.pid) && owner.host === hostname()
    ? ` If it is stuck, run \`kill ${owner.pid}\`, or delete ${lockPath}.`
    : ` If it is stuck, delete ${lockPath}.`;
  return new CliError(
    'SITE_MEMORY_BUSY',
    `Site memory ${file} is locked by another webcmd process${holder}.`,
    `Nothing was written. Wait for that process to finish and retry — it has held the lock for over ${Math.round(timeoutMs / 1000)}s.${stop}`,
    EXIT_CODES.TEMPFAIL,
  );
}

/** Exponential backoff with jitter so queued writers do not retry in lockstep. */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(RETRY_MIN_MS * 2 ** attempt, RETRY_MAX_MS);
  return RETRY_MIN_MS + Math.random() * (ceiling - RETRY_MIN_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function statOrUndefined(path: string) {
  try {
    return await stat(path);
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return undefined;
    throw err;
  }
}

function ignoreMissing(err: unknown): void {
  if (isNodeError(err) && err.code === 'ENOENT') return;
  throw err;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
