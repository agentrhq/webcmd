import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DAEMON_HEADER_NAME, DEFAULT_DAEMON_PORT } from '../constants.js';
import type { BrowserRuntimeCommand, BrowserRuntimeResult } from '../browser/protocol.js';
import type { BrowserRuntimeProvider } from '../browser/runtime/provider.js';
import { buildCommandTimeoutFailure, getResponseCorsHeaders } from '../daemon-utils.js';

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
  const pending = new Map<string, Promise<BrowserRuntimeResult>>();
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
          const result = await existing;
          jsonResponse(res, result.ok ? 200 : result.errorCode === 'command_result_unknown' ? 408 : 400, result);
          return;
        }
        const timeoutMs = typeof body.deadlineAt === 'number' && body.deadlineAt > 0
          ? Math.max(1000, body.deadlineAt - Date.now())
          : (typeof body.timeout === 'number' && body.timeout > 0 ? body.timeout * 1000 : 120_000);
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const commandPromise: Promise<BrowserRuntimeResult> = Promise.race([
          provider.dispatch(body),
          new Promise<BrowserRuntimeResult>((resolve) => {
            timeoutId = setTimeout(() => {
              const failure = buildCommandTimeoutFailure(body.action, timeoutMs);
              resolve({
                id: body.id,
                ok: false,
                errorCode: failure.errorCode,
                error: failure.message,
                errorHint: failure.errorHint,
              });
            }, timeoutMs);
          }),
        ]).finally(() => {
          if (timeoutId) clearTimeout(timeoutId);
          pending.delete(body.id);
        });
        pending.set(body.id, commandPromise);
        const result = await commandPromise;
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
