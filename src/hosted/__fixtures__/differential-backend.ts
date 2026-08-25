import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface DifferentialBackend {
  url: string;
  requests: { method: string; path: string; body: string }[];
  close(): Promise<void>;
}

const MANIFEST = {
  userId: 'u_fixture',
  metadata: {
    contractSchemaVersion: 1,
    sessionProtocolVersion: 1,
    webcmdPackageVersion: '0.7.4',
    generatedAt: '1970-01-01T00:00:00.000Z',
  },
  commands: [
    {
      site: 'acme', name: 'search', command: 'acme/search', description: 'Search Acme.',
      access: 'read', strategy: 'PUBLIC', browser: false, columns: ['id', 'title'], tags: ['search'],
      args: [{ name: 'query', type: 'string', required: true }], adapterPackageId: 'pkg_fixture', sourceFile: 'search.js',
    },
    {
      site: 'acme', name: 'create', command: 'acme/create', description: 'Create an Acme item.',
      access: 'write', strategy: 'PUBLIC', browser: false, columns: ['id', 'title'],
      args: [{ name: 'title', type: 'string', required: true }],
    },
    {
      site: 'auth', name: 'status', command: 'auth/status', description: 'Show authentication status.',
      access: 'read', strategy: 'PUBLIC', browser: false, columns: ['status'], args: [],
    },
    {
      site: 'auth', name: 'refresh', command: 'auth/refresh', description: 'Refresh authentication.',
      access: 'write', strategy: 'PUBLIC', browser: false, columns: ['status'],
      args: [{ name: 'site', type: 'string', required: true }],
    },
  ],
};

const session = {
  id: 'session_fixture', kind: 'explicit', profileId: 'profile_fixture', runtimeState: 'idle', handoff: null,
  createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z',
  lastUsedAt: '1970-01-01T00:00:00.000Z',
};

const browserRun = {
  executionId: 'browser_execution_fixture', session: 'session_fixture',
  profile: { id: 'profile_fixture', displayName: 'Fixture profile' },
};

const ADAPTER_SOURCE = 'export const fixture = true;\n';

function executeSuccess(command: string): unknown {
  if (command === 'auth/status' || command === 'auth/refresh') {
    return {
      ok: true, result: { status: command === 'auth/status' ? 'authenticated' : 'refreshed' }, columns: ['status'],
      execution: { id: 'exec_fixture', command, status: 'succeeded' },
    };
  }
  return {
    ok: true, result: [{ id: '1', title: command === 'acme/create' ? 'New item' : 'First' }], columns: ['id', 'title'],
    execution: { id: 'exec_fixture', command, status: 'succeeded' },
  };
}

function executeFailure(query: unknown, command: string): { status: number; body: unknown } | undefined {
  const errors: Record<string, { status: number; code: string; message: string; exitCode: number }> = {
    'trigger-failure': { status: 500, code: 'ADAPTER_FAILED', message: 'The adapter failed.', exitCode: 1 },
    'trigger-timeout': { status: 504, code: 'EXECUTION_TIMED_OUT', message: 'The command timed out.', exitCode: 75 },
    'trigger-login-wall': { status: 401, code: 'LOGIN_WALL', message: 'Sign in to continue.', exitCode: 77 },
  };
  const error = typeof query === 'string' ? errors[query] : undefined;
  if (!error) return undefined;
  return {
    status: error.status,
    body: {
      ok: false,
      error: { code: error.code, message: error.message, exitCode: error.exitCode },
      execution: { id: 'exec_fixture', command, status: error.code === 'EXECUTION_TIMED_OUT' ? 'timed_out' : 'failed' },
    },
  };
}

function json(response: import('node:http').ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** Deterministic endpoints make byte-for-byte entrypoint comparisons meaningful. */
export async function startDifferentialBackend(): Promise<DifferentialBackend> {
  const requests: DifferentialBackend['requests'] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
      const method = request.method ?? 'GET';
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method, path, body });

      if (method === 'GET' && path === '/v1/manifest') return json(response, { ok: true, manifest: MANIFEST });
      if (method === 'GET' && path === '/v1/profiles') return json(response, { ok: true, profiles: [] });
      if (method === 'DELETE' && path === '/v1/profiles/profile_fixture') return json(response, { ok: true, deleted: true });
      if (method === 'GET' && path === '/v1/sessions') return json(response, { ok: true, sessions: [] });
      if (method === 'POST' && path === '/v1/sessions') {
        const requestBody = JSON.parse(body) as { name?: unknown };
        if (typeof requestBody.name !== 'string') {
          return json(response, { ok: false, error: { code: 'INVALID_SESSION_NAME', message: 'Session name is required.', exitCode: 2 } }, 422);
        }
        return json(response, { ok: true, session: { ...session, liveViewUrl: 'https://cloud.example.test/account/live/fixture-token' } });
      }
      if (method === 'POST' && path === '/v1/sessions/session_fixture/close') return json(response, { ok: true, closed: true, alreadyIdle: false, session: 'session_fixture' });
      if (method === 'POST' && path === '/v1/browser/session_fixture/commands') {
        const invocation = JSON.parse(body) as { action?: string };
        if (invocation.action === 'snapshot') return json(response, { ok: true, run: browserRun, result: { tree: 'Fixture snapshot' } });
        return json(response, { ok: true, result: { tabs: [] }, columns: [], trace: null, run: browserRun, execution: { id: 'browser_execution_fixture', status: 'succeeded' } });
      }
      if (method === 'GET' && path === '/v1/marketplace/plugins') return json(response, { ok: true, result: { plugins: [], errors: [] } });
      if (method === 'GET' && path === '/v1/marketplace/installations') return json(response, { ok: true, result: { installations: [] } });
      if (method === 'GET' && path === '/v1/sites/acme/memory') {
        return json(response, { ok: true, artifacts: [{ path: 'notes.md', kind: 'notes', contentType: 'text/markdown', sha256: 'fixture', byteSize: 13, updatedAt: '1970-01-01T00:00:00.000Z' }] });
      }
      if (method === 'GET' && path === '/v1/sites/acme/memory/notes.md') {
        response.writeHead(200, { 'content-type': 'text/markdown' });
        return response.end('# Acme notes\n');
      }
      if (method === 'GET' && path === '/v1/adapters/pkg_fixture/source/search.js') {
        response.writeHead(200, { 'content-type': 'text/javascript' });
        return response.end('export default {};\n');
      }
      if (method === 'PUT' && path === '/v1/adapters/pkg_fixture/source/search.js') {
        if (body !== ADAPTER_SOURCE) {
          return json(response, {
            ok: false,
            error: {
              code: 'INVALID_ADAPTER_SOURCE',
              message: 'Fixture adapter source does not match expected bytes.',
              exitCode: 2,
            },
          }, 422);
        }
        return json(response, { ok: true, package: { id: 'pkg_fixture', storagePath: 'acme/search.js' }, commands: ['acme/search'] });
      }
      if (method === 'POST' && path === '/v1/execute') {
        const invocation = JSON.parse(body) as { command: string; args?: { query?: unknown } };
        const failure = executeFailure(invocation.args?.query, invocation.command);
        return failure ? json(response, failure.body, failure.status) : json(response, executeSuccess(invocation.command));
      }
      return json(response, { ok: false, error: { code: 'NOT_FOUND', message: 'No route.', exitCode: 66 } }, 404);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
