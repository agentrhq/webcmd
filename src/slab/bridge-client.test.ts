import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { SlabBridgeClient, SlabProtocolError } from './bridge-client.js';
import { SlabCredential, SLAB_MAX_CONTROL_LINE_BYTES } from './protocol.js';

const CREDENTIAL = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface ScriptedServer {
  endpoint: string;
  requests: unknown[];
  close(): Promise<void>;
}

const servers: Array<{ server: Server; dir: string }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async ({ server, dir }) => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }));
});

async function listen(onConnection: (socket: Socket) => void): Promise<ScriptedServer> {
  const dir = await mkdtemp(join(tmpdir(), 'slab-control-'));
  const endpoint = join(dir, 'slab-bridge.sock');
  const requests: unknown[] = [];
  const server = createServer(onConnection);
  servers.push({ server, dir });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => resolve());
  });
  return {
    endpoint,
    requests,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function collectRequests(socket: Socket, requests: unknown[], onRequest: (req: { id: string; method: string; params: unknown }) => void): void {
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx = buf.indexOf('\n');
    while (idx !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const req = JSON.parse(line) as { id: string; method: string; params: unknown };
      requests.push(req);
      onRequest(req);
      idx = buf.indexOf('\n');
    }
  });
}

function helloOk(id: string, browserVersion = '152.0.7977.65'): string {
  return `${JSON.stringify({
    id,
    ok: true,
    result: {
      protocolVersion: 1,
      browserVersion,
      browserPid: 1234,
      profiles: [{ id: 'default', displayName: 'Default' }],
    },
  })}\n`;
}

function attachOk(id: string, credential = CREDENTIAL): string {
  return `${JSON.stringify({
    id,
    ok: true,
    result: {
      connectionId: '00000000-0000-4000-8000-000000000000',
      profile: { id: 'default', displayName: 'Default' },
      transport: {
        kind: 'cdp-ipc',
        endpoint: '/Users/test/.slab/run/AAAAAAAAAAA.sock',
        credential,
      },
    },
  })}\n`;
}

function releaseOk(id: string): string {
  return `${JSON.stringify({ id, ok: true, result: null })}\n`;
}

function errorLine(id: string, code: string, message: string): string {
  return `${JSON.stringify({ id, ok: false, error: { code, message } })}\n`;
}

function sizedHello(id: string, targetBytes: number): string {
  const make = (pad: string) => JSON.stringify({
    id,
    ok: true,
    result: {
      protocolVersion: 1,
      browserVersion: pad,
      browserPid: 1234,
      profiles: [{ id: 'default', displayName: 'Default' }],
    },
  });
  const pad = 'x'.repeat(targetBytes - Buffer.byteLength(make('')));
  return `${make(pad)}\n`;
}

describe('SlabBridgeClient', () => {
  it('reassembles fragmented JSONL responses', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, (req) => {
        const line = helloOk(req.id);
        socket.write(line.slice(0, 8));
        socket.write(line.slice(8, 20));
        socket.write(line.slice(20));
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    await expect(client.hello()).resolves.toMatchObject({ protocolVersion: 1, browserPid: 1234 });
    await client.close();
  });

  it('splits coalesced JSONL responses', async () => {
    const harness = await listen((socket) => {
      const pending: string[] = [];
      collectRequests(socket, harness.requests, (req) => {
        pending.push(helloOk(req.id));
        if (pending.length === 2) socket.write(pending.join(''));
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    const [first, second] = await Promise.all([client.hello(), client.hello()]);
    expect(first.protocolVersion).toBe(1);
    expect(second.protocolVersion).toBe(1);
    expect(new Set(harness.requests.map((req) => (req as { id: string }).id)).size).toBe(2);
    await client.close();
  });

  it('accepts a response line of exactly 64 KiB', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, (req) => {
        const line = sizedHello(req.id, SLAB_MAX_CONTROL_LINE_BYTES);
        expect(Buffer.byteLength(line.slice(0, -1))).toBe(SLAB_MAX_CONTROL_LINE_BYTES);
        socket.write(line);
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    const result = await client.hello();
    expect(result.protocolVersion).toBe(1);
    expect(result.browserVersion.length).toBeGreaterThan(64 * 1024 - 200);
    await client.close();
  });

  it('rejects an oversized line and closes the control connection', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, (req) => {
        socket.write(sizedHello(req.id, SLAB_MAX_CONTROL_LINE_BYTES + 1));
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    await expect(client.hello()).rejects.toThrow(/64 KiB|oversized|control/i);
    await expect(client.hello()).rejects.toThrow();
  });

  it('rejects malformed JSON and closes the control connection', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, () => {
        socket.write('{not-json}\n');
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    await expect(client.hello()).rejects.toThrow(/json|invalid|malformed/i);
    await expect(client.release('x')).rejects.toThrow();
  });

  it('rejects invalid UTF-8 and closes the control connection', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, () => {
        socket.write(Buffer.from([0xff, 0xfe, 0x0a]));
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    await expect(client.hello()).rejects.toThrow(/utf-8|utf8|invalid/i);
    await expect(client.hello()).rejects.toThrow();
  });

  it('times out a pending request and closes the control connection', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, () => {});
    });
    const client = await SlabBridgeClient.connect(harness.endpoint, { timeoutMs: 40 });
    await expect(client.hello()).rejects.toThrow(/timeout/i);
    await expect(client.hello()).rejects.toThrow();
  });

  it('rejects pending requests when the socket closes', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, () => {
        socket.destroy();
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    await expect(client.hello()).rejects.toThrow(/close|closed|disconnect/i);
  });

  it('rejects an unexpected response id and closes the control connection', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, () => {
        socket.write(helloOk('not-the-request-id'));
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    await expect(client.hello()).rejects.toThrow(/id|unexpected/i);
    await expect(client.hello()).rejects.toThrow();
  });

  it('rejects a duplicate response and closes the control connection', async () => {
    let socketRef: Socket | undefined;
    const harness = await listen((socket) => {
      socketRef = socket;
      collectRequests(socket, harness.requests, (req) => {
        socket.write(helloOk(req.id));
        socket.write(helloOk(req.id));
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    await expect(client.hello()).resolves.toMatchObject({ protocolVersion: 1 });
    await expect(client.attach('default')).rejects.toThrow(/duplicate|closed|id/i);
    await new Promise<void>((resolve) => {
      if (!socketRef || socketRef.destroyed) {
        resolve();
        return;
      }
      socketRef.once('close', () => resolve());
    });
    expect(socketRef?.destroyed || socketRef?.readableEnded).toBeTruthy();
  });

  it('rejects unknown response fields and closes the control connection', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, (req) => {
        socket.write(`${JSON.stringify({
          id: req.id,
          ok: true,
          result: {
            protocolVersion: 1,
            browserVersion: '1',
            browserPid: 1,
            profiles: [],
          },
          extra: true,
        })}\n`);
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    await expect(client.hello()).rejects.toThrow(/unknown|field|unexpected/i);
    await expect(client.hello()).rejects.toThrow();
  });

  it('rejects extra result fields and destroys the control socket', async () => {
    let socketRef: Socket | undefined;
    const harness = await listen((socket) => {
      socketRef = socket;
      collectRequests(socket, harness.requests, (req) => {
        if (req.method === 'attach') {
          socket.write(`${JSON.stringify({
            id: req.id,
            ok: true,
            result: {
              connectionId: '00000000-0000-4000-8000-000000000000',
              profile: { id: 'default', displayName: 'Default' },
              transport: {
                kind: 'cdp-ipc',
                endpoint: '/tmp/x.sock',
                credential: CREDENTIAL,
              },
              extra: true,
            },
          })}\n`);
          return;
        }
        socket.write(`${JSON.stringify({
          id: req.id,
          ok: true,
          result: {
            protocolVersion: 1,
            browserVersion: '1',
            browserPid: 1,
            profiles: [],
            extra: true,
          },
        })}\n`);
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    await expect(client.hello()).rejects.toThrow(/unknown|field/i);
    await new Promise<void>((resolve, reject) => {
      if (!socketRef) {
        reject(new Error('missing server socket'));
        return;
      }
      if (socketRef.destroyed) {
        resolve();
        return;
      }
      socketRef.once('close', () => resolve());
      setTimeout(() => reject(new Error('socket stayed open')), 100);
    });
    expect(socketRef?.destroyed || socketRef?.readableEnded).toBeTruthy();
    await expect(client.attach('default')).rejects.toThrow();
  });

  it('maps stable protocol errors without leaking credentials or raw responses', async () => {
    const codes = [
      'INVALID_REQUEST',
      'INCOMPATIBLE_PROTOCOL',
      'PROFILE_NOT_FOUND',
      'ATTACH_FAILED',
      'AUTHENTICATION_FAILED',
      'CONNECTION_NOT_FOUND',
    ] as const;
    for (const code of codes) {
      const harness = await listen((socket) => {
        collectRequests(socket, harness.requests, (req) => {
          socket.write(errorLine(req.id, code, `secret ${CREDENTIAL} raw={"ok":false}`));
        });
      });
      const client = await SlabBridgeClient.connect(harness.endpoint);
      const error = await client.attach('default').then(
        () => {
          throw new Error(`expected ${code}`);
        },
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(SlabProtocolError);
      expect((error as SlabProtocolError).code).toBe(code);
      expect(String(error)).not.toContain(CREDENTIAL);
      expect(String(error)).not.toContain('raw=');
      expect((error as Error).message).not.toContain(CREDENTIAL);
      await client.close().catch(() => {});
    }
  });

  it('redacts attachment credentials in inspection and stringification', async () => {
    const harness = await listen((socket) => {
      collectRequests(socket, harness.requests, (req) => {
        if (req.method === 'attach') socket.write(attachOk(req.id));
        else if (req.method === 'release') socket.write(releaseOk(req.id));
        else socket.write(helloOk(req.id));
      });
    });
    const client = await SlabBridgeClient.connect(harness.endpoint);
    const lease = await client.attach('default');
    expect(lease.transport.kind).toBe('cdp-ipc');
    expect(lease.transport.credential).toBeInstanceOf(SlabCredential);
    expect(String(lease.transport.credential)).toBe('[REDACTED]');
    expect(JSON.stringify(lease.transport.credential)).toBe('"[REDACTED]"');
    expect(inspect(lease.transport.credential)).toContain('[REDACTED]');
    expect(inspect(lease)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(lease)).not.toContain(CREDENTIAL);
    expect(lease.transport.credential.reveal()).toBe(CREDENTIAL);
    await expect(client.release(lease.connectionId)).resolves.toBeNull();
    await client.close();
  });
});
