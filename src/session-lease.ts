import { AsyncLocalStorage } from 'node:async_hooks';

/** Inactivity window after which an unowned session lease expires. */
export const SESSION_LEASE_TTL_MS = 45_000;

let runIdCounter = 0;

/** Generate an id for one complete logical CLI command run. */
export function generateRunId(): string {
  return `run_${process.pid}_${Date.now()}_${++runIdCounter}`;
}

export interface DaemonRunContext {
  runId: string;
  command: string;
}

let activeRun: DaemonRunContext | undefined;
const daemonRunContextStorage = new AsyncLocalStorage<DaemonRunContext>();

/** Run one logical execution with context isolated across its async chain. */
export function runWithDaemonRunContext<T>(context: DaemonRunContext, callback: () => T): T {
  return daemonRunContextStorage.run(context, callback);
}

export function setDaemonRunContext(context: DaemonRunContext): void {
  activeRun = context;
}

export function getDaemonRunContext(): DaemonRunContext | undefined {
  return daemonRunContextStorage.getStore() ?? activeRun;
}

/**
 * Clear only the context still owned by `runId`. Deferred cleanup from an old
 * command must not clear a newer command's run identity.
 */
export function clearDaemonRunContext(runId: string): void {
  if (activeRun?.runId === runId) activeRun = undefined;
}

const UNKNOWN_OUTCOME_CODES = [
  'command_result_unknown',
  'command_lost',
  'result_evicted',
] as const;

function containsUnknownOutcomeCode(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  return UNKNOWN_OUTCOME_CODES.some((code) => {
    const start = normalized.indexOf(code);
    if (start < 0) return false;
    const before = normalized[start - 1];
    const after = normalized[start + code.length];
    return (!before || !/[a-z0-9_]/.test(before)) && (!after || !/[a-z0-9_]/.test(after));
  });
}

/**
 * Detect errors whose browser-side result is unknown. The traversal includes
 * wrapper causes and AggregateError members and tolerates cyclic error graphs.
 */
export function isUnknownOutcomeError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || (typeof current !== 'object' && typeof current !== 'function') || seen.has(current)) {
      continue;
    }
    seen.add(current);

    const record = current as Record<string, unknown>;
    if (
      containsUnknownOutcomeCode(record.code)
      || containsUnknownOutcomeCode(record.errorCode)
      || containsUnknownOutcomeCode(record.daemonCode)
      || containsUnknownOutcomeCode(record.message)
      || containsUnknownOutcomeCode(record.error)
    ) {
      return true;
    }

    if (record.cause !== undefined) queue.push(record.cause);
    if (Array.isArray(record.errors)) queue.push(...record.errors);
  }

  return false;
}

export interface SessionLeaseHolder {
  command: string;
  pid?: number;
  acquiredAt: number;
  heartbeatAt: number;
}

export interface SessionLease extends SessionLeaseHolder {
  key: string;
  runId: string;
}

/** Public status shape: the internal ownership token is intentionally omitted. */
export type SessionLeaseStatus = Omit<SessionLease, 'runId'>;

export interface AcquireSessionLeaseInput {
  key: string;
  runId: string;
  command: string;
  pid?: number;
}

export type AcquireResult =
  | { acquired: true; lease: SessionLease }
  | { acquired: false; holder: SessionLease };

/**
 * Lease key after the daemon has resolved the immutable browser Session.
 */
export function getSessionLeaseKey(
  profileId: string,
  sessionId: string,
  admissionSite?: string,
): string {
  return `${profileId}␟${sessionId}${admissionSite === undefined ? '' : `␟${admissionSite}`}`;
}

/** Whether a process id is safe to interpolate into local process guidance. */
export function isActionablePid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0;
}

export function isPidAlive(pid: unknown): boolean {
  if (!isActionablePid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function pidFromRunId(runId: string): number | undefined {
  const match = /^run_(\d+)_/.exec(runId);
  if (!match) return undefined;
  const pid = Number(match[1]);
  return isActionablePid(pid) ? pid : undefined;
}

export interface SessionLeaseCommand {
  action?: unknown;
  sessionId?: unknown;
  runId?: unknown;
}

/** Every resolved browser-backed top-level run with a complete owner identity needs a lease. */
export function isSessionLeaseCommand<T extends SessionLeaseCommand>(
  command: T,
): command is T & {
  sessionId: string;
  runId: string;
} {
  return command.action !== 'lease-release'
    && command.action !== 'run-cancel'
    && typeof command.sessionId === 'string'
    && command.sessionId.length > 0
    && typeof command.runId === 'string'
    && command.runId.length > 0;
}

export class SessionLeaseRegistry {
  private readonly leases = new Map<string, SessionLease>();

  constructor(private readonly now = Date.now, private readonly pidAlive = isPidAlive) {}

  acquire(
    input: AcquireSessionLeaseInput,
    hasPendingWork: (runId: string) => boolean,
  ): AcquireResult {
    const now = this.now();
    const current = this.leases.get(input.key);
    const currentIsLive = current !== undefined
      && (
        hasPendingWork(current.runId)
        || (
          now - current.heartbeatAt <= SESSION_LEASE_TTL_MS
          && (!isActionablePid(current.pid) || this.pidAlive(current.pid))
        )
      );

    if (current && currentIsLive && current.runId !== input.runId) {
      return { acquired: false, holder: { ...current } };
    }

    const pid = input.pid === undefined
      ? pidFromRunId(input.runId)
      : (isActionablePid(input.pid) ? input.pid : undefined);
    const lease: SessionLease = current?.runId === input.runId
      ? { ...current, heartbeatAt: now }
      : {
          key: input.key,
          runId: input.runId,
          command: input.command,
          ...(pid === undefined ? {} : { pid }),
          acquiredAt: now,
          heartbeatAt: now,
        };
    this.leases.set(input.key, lease);
    return { acquired: true, lease: { ...lease } };
  }

  /** Refresh a lease only when both its key and logical owner match. */
  heartbeat(key: string, runId: string): boolean {
    const current = this.leases.get(key);
    if (!current || current.runId !== runId) return false;
    current.heartbeatAt = this.now();
    return true;
  }

  /** Release all leases owned by one logical run. */
  releaseByRunId(runId: string): number {
    let released = 0;
    for (const [key, lease] of this.leases) {
      if (lease.runId !== runId) continue;
      this.leases.delete(key);
      released += 1;
    }
    return released;
  }

  /** Return a snapshot of currently live leases without exposing mutable state. */
  list(hasPendingWork: (runId: string) => boolean): SessionLease[] {
    const now = this.now();
    const active: SessionLease[] = [];
    for (const lease of this.leases.values()) {
      if (now - lease.heartbeatAt <= SESSION_LEASE_TTL_MS || hasPendingWork(lease.runId)) {
        active.push({ ...lease });
      }
    }
    return active;
  }
}
