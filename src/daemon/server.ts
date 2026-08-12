import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DAEMON_HEADER_NAME, DEFAULT_DAEMON_PORT } from '../constants.js';
import type { BrowserRuntimeCommand, BrowserRuntimeResult } from '../browser/protocol.js';
import type { BrowserRuntimeProvider } from '../browser/runtime/provider.js';
import { buildCommandTimeoutFailure, getResponseCorsHeaders } from '../daemon-utils.js';
import { getSessionLeaseKey, isSessionLeaseCommand, SessionLeaseRegistry } from '../session-lease.js';
import type { BrowserSessionRecord } from '../browser/sessions.js';

const MAX_BODY = 1024 * 1024;
const LOG_BUFFER_SIZE = 200;

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

const SESSION_LIFECYCLE_ACTIONS = new Set<BrowserRuntimeCommand['action']>([
  'session-create',
  'session-list',
  'session-close',
]);

function commandProfileId(provider: BrowserRuntimeProvider, command: BrowserRuntimeCommand): string | undefined {
  return provider.resolveProfileId?.(command)
    ?? command.profileId
    ?? command.contextId
    ?? command.preferredContextId;
}

async function resolveBrowserSession(
  provider: BrowserRuntimeProvider,
  command: BrowserRuntimeCommand,
): Promise<BrowserRuntimeCommand> {
  if (command.action === 'lease-release' || command.action === 'run-cancel' || SESSION_LIFECYCLE_ACTIONS.has(command.action)) return command;
  let session: BrowserSessionRecord | undefined;
  let sessionKind: BrowserRuntimeCommand['sessionKind'];
  if (command.surface === 'adapter' && !command.session) {
    session = await provider.resolveAdapterDefault?.(command);
    sessionKind = 'adapter-default';
  } else {
    session = await provider.requireSession?.(command);
    sessionKind = 'explicit';
  }
  return session ? { ...command, session: session.id, sessionId: session.id, sessionKind } : command;
}

async function handleSessionLifecycle(
  provider: BrowserRuntimeProvider,
  command: BrowserRuntimeCommand,
): Promise<BrowserRuntimeResult | null> {
  switch (command.action) {
    case 'session-create': {
      const session = await provider.createSession?.(command);
      return session ? { id: command.id, ok: true, data: session } : null;
    }
    case 'session-list': {
      const sessions = await provider.listSessions?.({ profileId: commandProfileId(provider, command) });
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

export function createDaemonServer(provider: BrowserRuntimeProvider, opts: DaemonServerOptions): DaemonServerHandle {
  const port = opts.port ?? DEFAULT_DAEMON_PORT;
  const host = opts.host ?? '127.0.0.1';
  const logBuffer: Array<{ level: string; msg: string; ts: number }> = [];
  const pending = new Map<string, PendingCommand>();
  const leases = new SessionLeaseRegistry();
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
          const released = typeof body.runId === 'string' ? leases.releaseByRunId(body.runId) : 0;
          jsonResponse(res, 200, { id: body.id, ok: true, data: { released } });
          return;
        }
        const lifecycleResult = await handleSessionLifecycle(provider, body);
        if (lifecycleResult) {
          jsonResponse(res, 200, lifecycleResult);
          return;
        }
        const resolvedBody = await resolveBrowserSession(provider, body);
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
            const { key: _key, runId: _runId, ...holder } = acquired.holder;
            jsonResponse(res, 409, { ok: false, code: 'session_busy', holder });
            return;
          }
        }
        const commandPromise = provider.dispatch(resolvedBody).finally(() => {
          if (leaseKey && runId) leases.heartbeat(leaseKey, runId);
          pending.delete(body.id);
        });
        pending.set(body.id, { promise: commandPromise, runId, leaseKey });
        const result = await waitForCommandResult(body, commandPromise);
        if (!result.ok) pushLog('warn', `Command ${body.id} failed: ${result.error ?? result.errorCode ?? 'unknown error'}`);
        jsonResponse(res, result.ok ? 200 : result.errorCode === 'command_result_unknown' ? 408 : 400, result);
      } catch (err) {
        jsonResponse(res, 400, { ok: false, error: err instanceof Error ? err.message : 'Invalid request' });
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
