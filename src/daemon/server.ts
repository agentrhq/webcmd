import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DAEMON_HEADER_NAME, DEFAULT_DAEMON_PORT } from '../constants.js';
import type { BrowserRuntimeCommand, BrowserRuntimeResult } from '../browser/protocol.js';
import type { BrowserRuntimeProvider } from '../browser/runtime/provider.js';
import { buildCommandTimeoutFailure, getResponseCorsHeaders } from '../daemon-utils.js';
import { getSessionLeaseKey, isSessionLeaseCommand, type SessionLease, SessionLeaseRegistry } from '../session-lease.js';
import { CliError } from '../errors.js';
import type { BrowserSessionRecord } from '../browser/sessions.js';

const MAX_BODY = 1024 * 1024;
const LOG_BUFFER_SIZE = 200;
const CANCEL_SETTLE_TIMEOUT_MS = 2_000;

export interface DaemonServerOptions {
  port?: number;
  host?: string;
  version: string;
}

export interface DaemonServerHandle {
  server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
}

interface PendingCommand {
  promise: Promise<BrowserRuntimeResult>;
  runId?: string;
  leaseKey?: string;
  abortController: AbortController;
}

async function cancelAndSettle(entries: PendingCommand[]): Promise<boolean> {
  entries.forEach((entry) => entry.abortController.abort());
  if (entries.length === 0) return true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    Promise.allSettled(entries.map((entry) => entry.promise)).then(() => true),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), CANCEL_SETTLE_TIMEOUT_MS);
      timeout.unref?.();
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  return settled;
}

function publicSessionHolder(holder: SessionLease | undefined) {
  if (!holder) return null;
  const { key: _key, runId: _runId, ...publicHolder } = holder;
  const [, sessionId, admissionSite] = holder.key.split('␟');
  return { ...publicHolder, ...(sessionId ? { sessionId } : {}), ...(admissionSite ? { admissionSite } : {}) };
}

function displacedSessionHolder(holder: SessionLease | undefined): { command: string; pid?: number } | null {
  if (!holder) return null;
  return { command: holder.command, ...(holder.pid === undefined ? {} : { pid: holder.pid }) };
}

function commandTimeoutMs(command: BrowserRuntimeCommand): number {
  return typeof command.deadlineAt === 'number' && command.deadlineAt > 0
    ? Math.max(1000, command.deadlineAt - Date.now())
    : (typeof command.timeout === 'number' && command.timeout > 0 ? command.timeout * 1000 : 120_000);
}

function waitForCommandResult(
  command: BrowserRuntimeCommand,
  providerPromise: Promise<BrowserRuntimeResult>,
): Promise<BrowserRuntimeResult> {
  const timeoutMs = commandTimeoutMs(command);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const responsePromise = Promise.race([
    providerPromise,
    new Promise<BrowserRuntimeResult>((resolve) => {
      timeoutId = setTimeout(() => {
        const failure = buildCommandTimeoutFailure(command.action, timeoutMs);
        resolve({
          id: command.id,
          ok: false,
          errorCode: failure.errorCode,
          error: failure.message,
          errorHint: failure.errorHint,
        });
      }, timeoutMs);
    }),
  ]);
  return responsePromise.finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

const UNRESOLVED_SESSION_LIFECYCLE_ACTIONS = new Set<BrowserRuntimeCommand['action']>([
  'session-create',
  'session-list',
  'profile-ensure',
]);

type ProfileEnsureResult = { profile: { id: string; displayName: string }; created: boolean };
const profileEnsures = new WeakMap<BrowserRuntimeProvider, Map<string, {
  idempotencyKey: string;
  operation: Promise<ProfileEnsureResult>;
}>>();

/** @internal Exported for deterministic concurrency contract tests. */
export async function ensureProfileCoalesced(provider: BrowserRuntimeProvider, alias: string, idempotencyKey: string) {
  const key = alias.trim();
  let providerEnsures = profileEnsures.get(provider);
  if (!providerEnsures) {
    providerEnsures = new Map();
    profileEnsures.set(provider, providerEnsures);
  }
  const existing = providerEnsures.get(key);
  if (existing) {
    if (existing.idempotencyKey !== idempotencyKey) {
      throw new CliError(
        'PROFILE_ENSURE_CONFLICT',
        `Profile ensure for alias "${key}" is already in progress with a different idempotency key.`,
      );
    }
    return existing.operation;
  }
  const operation = provider.ensureProfile!({ alias: key, idempotencyKey });
  providerEnsures.set(key, { idempotencyKey, operation });
  try {
    return await operation;
  } finally {
    if (providerEnsures.get(key)?.operation === operation) providerEnsures.delete(key);
  }
}

function commandProfileId(provider: BrowserRuntimeProvider, command: BrowserRuntimeCommand): string | undefined {
  return provider.resolveProfileId?.(command)
    ?? command.profileId
    ?? command.contextId
    ?? command.preferredContextId;
}

async function resolveBrowserSession(
  provider: BrowserRuntimeProvider,
  command: BrowserRuntimeCommand,
): Promise<{ command: BrowserRuntimeCommand; session?: BrowserSessionRecord }> {
  if (command.action === 'lease-release' || command.action === 'run-cancel' || UNRESOLVED_SESSION_LIFECYCLE_ACTIONS.has(command.action)) {
    return { command };
  }
  let session: BrowserSessionRecord | undefined;
  let sessionKind: BrowserRuntimeCommand['sessionKind'];
  if (command.surface === 'adapter' && !command.session) {
    session = await provider.resolveAdapterDefault?.(command);
    sessionKind = 'adapter-default';
  } else {
    session = await provider.requireSession?.(command);
    sessionKind = 'explicit';
  }
  return {
    command: session ? { ...command, session: session.id, sessionId: session.id, sessionKind } : command,
    session,
  };
}

const HANDOFF_ACTIONS = new Set<BrowserRuntimeCommand['action']>([
  'session-handoff-start',
  'session-handoff-clear',
]);

function isHandoffVerification(command: BrowserRuntimeCommand, site: string): boolean {
  return command.surface === 'adapter'
    && command.adapterSite === site
    && command.command === `${site}/whoami`;
}

function handoffPauseResult(command: BrowserRuntimeCommand, session: BrowserSessionRecord): BrowserRuntimeResult | null {
  const handoff = session.handoff;
  if (!handoff || Date.parse(handoff.expiresAt) <= Date.now()) return null;
  if (isHandoffVerification(command, handoff.site)) return null;
  return {
    id: command.id,
    ok: false,
    errorCode: 'SESSION_PAUSED_FOR_HUMAN_HANDOFF',
    error: `Session ${session.id} is paused while a human completes ${handoff.site} authentication.`,
    details: { sessionId: session.id, sessionKind: session.kind, ...handoff },
  };
}

async function handleSessionHandoff(
  provider: BrowserRuntimeProvider,
  command: BrowserRuntimeCommand,
  session: BrowserSessionRecord,
): Promise<BrowserRuntimeResult | null> {
  if (!HANDOFF_ACTIONS.has(command.action)) return null;
  if (!command.runId || !command.site?.trim()) {
    return { id: command.id, ok: false, errorCode: 'invalid_request', error: 'Session handoff controls require runId and site.' };
  }
  if (command.action === 'session-handoff-start') {
    const expiresAt = command.expiresAt ? Date.parse(command.expiresAt) : Number.NaN;
    if (command.command !== `${command.site}/login` || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return { id: command.id, ok: false, errorCode: 'invalid_request', error: 'Invalid Session handoff start control.' };
    }
    const record = await provider.startSessionHandoff?.(command);
    return record
      ? { id: command.id, ok: true, data: record }
      : { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: 'Session handoff is not supported by this runtime.' };
  }
  if (!isHandoffVerification(command, command.site) || (session.handoff && command.site !== session.handoff.site)) {
    return { id: command.id, ok: false, errorCode: 'invalid_request', error: 'Invalid Session handoff clear control.' };
  }
  const record = await provider.clearSessionHandoff?.(command);
  return record
    ? { id: command.id, ok: true, data: record }
    : { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: 'Session handoff is not supported by this runtime.' };
}

async function handleSessionLifecycle(
  provider: BrowserRuntimeProvider,
  command: BrowserRuntimeCommand,
): Promise<BrowserRuntimeResult | null> {
  switch (command.action) {
    case 'profile-ensure': {
      if (!command.alias?.trim() || !command.idempotencyKey?.trim()) {
        return { id: command.id, ok: false, errorCode: 'invalid_request', error: 'Profile ensure requires alias and idempotencyKey.' };
      }
      const ensured = provider.ensureProfile
        ? await ensureProfileCoalesced(provider, command.alias.trim(), command.idempotencyKey.trim())
        : undefined;
      return ensured ? { id: command.id, ok: true, data: ensured } : {
        id: command.id, ok: false, errorCode: 'PROFILE_ENSURE_UNSUPPORTED', error: 'Selected browser runtime does not support eager Profile creation.',
      };
    }
    case 'session-create': {
      const session = await provider.createSession?.(command);
      return session ? { id: command.id, ok: true, data: session } : null;
    }
    case 'session-list': {
      const sessions = await provider.listSessions?.({ profileId: commandProfileId(provider, command), limit: command.limit });
      return sessions ? { id: command.id, ok: true, data: sessions } : null;
    }
    case 'session-close': {
      const closed = await provider.closeSession?.(command);
      return closed ? { id: command.id, ok: true, data: closed } : null;
    }
    default:
      return null;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        aborted = true;
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
  });
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  data: unknown,
  extraHeaders?: Record<string, string>,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(data));
}

function abortOnResponseClose(res: ServerResponse, controller: AbortController, onAbort: () => void): () => void {
  let completed = false;
  const onClose = () => {
    if (completed) return;
    onAbort();
    controller.abort();
  };
  res.once('close', onClose);
  return () => {
    completed = true;
    res.off('close', onClose);
  };
}

export function createDaemonServer(provider: BrowserRuntimeProvider, opts: DaemonServerOptions): DaemonServerHandle {
  const port = opts.port ?? DEFAULT_DAEMON_PORT;
  const host = opts.host ?? '127.0.0.1';
  const logBuffer: Array<{ level: string; msg: string; ts: number }> = [];
  const pending = new Map<string, PendingCommand>();
  const leases = new SessionLeaseRegistry();
  const forceClosingRuns = new Set<string>();
  const hasPendingWork = (runId: string) => [...pending.values()].some((entry) => entry.runId === runId);
  let shutdownStarted = false;

  function pushLog(level: string, msg: string): void {
    logBuffer.push({ level, msg, ts: Date.now() });
    if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  }

  async function shutdownProvider(): Promise<void> {
    if (shutdownStarted) return;
    shutdownStarted = true;
    await provider.shutdown();
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin as string | undefined;
    if (origin && !origin.startsWith('chrome-extension://')) {
      jsonResponse(res, 403, { ok: false, error: 'Forbidden: cross-origin request blocked' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';
    const pathname = url.split('?')[0];

    if (req.method === 'GET' && pathname === '/ping') {
      jsonResponse(res, 200, { ok: true }, getResponseCorsHeaders(pathname, origin));
      return;
    }

    if (!req.headers[DAEMON_HEADER_NAME.toLowerCase()]) {
      jsonResponse(res, 403, { ok: false, error: `Forbidden: missing ${DAEMON_HEADER_NAME} header` });
      return;
    }

    if (req.method === 'GET' && pathname === '/status') {
      const mem = process.memoryUsage();
      const params = new URL(url, `http://localhost:${port}`).searchParams;
      const contextId = params.get('contextId')?.trim() || undefined;
      const runtime = await provider.status({ contextId });
      jsonResponse(res, 200, {
        ok: true,
        pid: process.pid,
        uptime: process.uptime(),
        daemonVersion: opts.version,
        ...runtime,
        pending: pending.size + runtime.pending,
        sessionLeases: leases.list(hasPendingWork).map(({ runId: _runId, ...lease }) => lease),
        memoryMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
        port,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/logs') {
      const params = new URL(url, `http://localhost:${port}`).searchParams;
      const level = params.get('level');
      const logs = level ? logBuffer.filter((entry) => entry.level === level) : logBuffer;
      jsonResponse(res, 200, { ok: true, logs });
      return;
    }

    if (req.method === 'DELETE' && pathname === '/logs') {
      logBuffer.length = 0;
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/shutdown') {
      jsonResponse(res, 200, { ok: true, message: 'Shutting down' });
      setTimeout(() => {
        shutdownProvider().finally(() => {
          server.close();
        });
      }, 10);
      return;
    }

    if (req.method === 'POST' && pathname === '/command') {
      try {
        const body = JSON.parse(await readBody(req)) as BrowserRuntimeCommand;
        if (!body.id) {
          jsonResponse(res, 400, { ok: false, error: 'Missing command id' });
          return;
        }
        const existing = pending.get(body.id);
        if (existing) {
          const result = await waitForCommandResult(body, existing.promise);
          jsonResponse(res, result.ok ? 200 : result.errorCode === 'command_result_unknown' ? 408 : 400, result);
          return;
        }
        if (body.action === 'lease-release' || body.action === 'run-cancel') {
          const matching = body.action === 'run-cancel' && typeof body.runId === 'string'
            ? [...pending.values()].filter((entry) => entry.runId === body.runId)
            : [];
          const canceled = await cancelAndSettle(matching);
          if (!canceled) {
            const holder = typeof body.runId === 'string'
              ? leases.list(hasPendingWork).find((lease) => lease.runId === body.runId)
              : undefined;
            jsonResponse(res, 409, { id: body.id, ok: false, code: 'session_busy', holder: publicSessionHolder(holder) });
            return;
          }
          const released = typeof body.runId === 'string' ? leases.releaseByRunId(body.runId) : 0;
          jsonResponse(res, 200, { id: body.id, ok: true, data: { released } });
          return;
        }
        if (body.action !== 'session-close') {
          const lifecycleResult = await handleSessionLifecycle(provider, body);
          if (lifecycleResult) {
            jsonResponse(res, 200, lifecycleResult);
            return;
          }
        }
        const resolved = await resolveBrowserSession(provider, body);
        const resolvedBody = resolved.command;
        const activeSessionLeases = (sessionKey: string) => leases.list(hasPendingWork).filter((lease) => (
          lease.key === sessionKey
          || lease.key.startsWith(`${sessionKey}␟`)
          || sessionKey.startsWith(`${lease.key}␟`)
        ));
        if (resolved.session && !(resolvedBody.action === 'session-close' && resolvedBody.force === true)) {
          const paused = handoffPauseResult(resolvedBody, resolved.session);
          if (paused) {
            jsonResponse(res, 409, paused);
            return;
          }
        }
        if (resolvedBody.action === 'session-close') {
          const profileId = commandProfileId(provider, resolvedBody) ?? 'default';
          const sessionKey = getSessionLeaseKey(profileId, resolvedBody.sessionId!);
          const holders = activeSessionLeases(sessionKey);
          const holder = holders[0];
          if (holder && resolvedBody.force !== true) {
            jsonResponse(res, 409, { ok: false, code: 'session_busy', holder: publicSessionHolder(holder) });
            return;
          }
          const forcedRunIds = resolvedBody.force === true
            ? new Set(holders.map((lease) => lease.runId))
            : new Set<string>();
          const forcedCommands = [...pending.values()]
            .filter((entry) => entry.runId && forcedRunIds.has(entry.runId))
            .map((entry) => entry);
          forcedRunIds.forEach((runId) => forceClosingRuns.add(runId));
          const canceled = await cancelAndSettle(forcedCommands);
          if (!canceled) {
            forcedRunIds.forEach((runId) => forceClosingRuns.delete(runId));
            jsonResponse(res, 409, { ok: false, code: 'session_busy', holder: publicSessionHolder(holder) });
            return;
          }
          const lifecycleResult = await handleSessionLifecycle(provider, resolvedBody);
          if (lifecycleResult) {
            for (const runId of forcedRunIds) {
              leases.releaseByRunId(runId);
              forceClosingRuns.delete(runId);
            }
            jsonResponse(res, 200, resolvedBody.force === true ? {
              ...lifecycleResult,
              data: {
                ...(lifecycleResult.data as Record<string, unknown>),
                displaced: displacedSessionHolder(holder),
                clearedHandoff: Boolean(resolved.session?.handoff),
              },
            } : lifecycleResult);
            return;
          }
        }
        let leaseKey: string | undefined;
        let runId: string | undefined;
        if (isSessionLeaseCommand(resolvedBody)) {
          const profileId = commandProfileId(provider, resolvedBody)
            ?? 'default';
          const admissionSite = resolvedBody.sessionKind === 'adapter-default'
            && resolvedBody.surface === 'adapter'
            ? resolvedBody.adapterSite
            : undefined;
          leaseKey = getSessionLeaseKey(profileId, resolvedBody.sessionId, admissionSite);
          runId = resolvedBody.runId;
          const acquired = leases.acquire({
            key: leaseKey,
            runId,
            command: resolvedBody.command ?? resolvedBody.action,
            pid: resolvedBody.pid,
          }, hasPendingWork);
          if (!acquired.acquired) {
            jsonResponse(res, 409, { ok: false, code: 'session_busy', holder: publicSessionHolder(acquired.holder) });
            return;
          }
        }
        if (resolved.session) {
          const handoffResult = await handleSessionHandoff(provider, resolvedBody, resolved.session);
          if (handoffResult) {
            if (leaseKey && runId) leases.heartbeat(leaseKey, runId);
            jsonResponse(res, handoffResult.ok ? 200 : 400, handoffResult);
            return;
          }
        }
        const abortController = new AbortController();
        let responseAborted = false;
        const removeResponseAbort = abortOnResponseClose(res, abortController, () => {
          responseAborted = true;
        });
        const commandPromise = provider.dispatch(resolvedBody, abortController.signal).finally(() => {
          removeResponseAbort();
          if (leaseKey && runId && !responseAborted) leases.heartbeat(leaseKey, runId);
          pending.delete(body.id);
          if (runId && (responseAborted || forceClosingRuns.delete(runId))) leases.releaseByRunId(runId);
        });
        pending.set(body.id, { promise: commandPromise, runId, leaseKey, abortController });
        const result = await waitForCommandResult(body, commandPromise);
        removeResponseAbort();
        if (!result.ok) pushLog('warn', `Command ${body.id} failed: ${result.error ?? result.errorCode ?? 'unknown error'}`);
        if (!responseAborted) jsonResponse(res, result.ok ? 200 : result.errorCode === 'command_result_unknown' ? 408 : 400, result);
      } catch (err) {
        // Keep the machine-readable code: clients (e.g. `session close`)
        // branch on it, and dropping it leaves them only a message to match.
        jsonResponse(res, 400, {
          ok: false,
          errorCode: err instanceof CliError ? err.code : undefined,
          error: err instanceof Error ? err.message : 'Invalid request',
        });
      }
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      jsonResponse(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  });

  return {
    server,
    listen: () => new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    }),
    close: async () => {
      await shutdownProvider();
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
