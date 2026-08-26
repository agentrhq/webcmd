import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectOverCDPTransport } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { CdpIpcTransport } from './cdp-ipc-transport.js';
import { SlabCredential } from './protocol.js';

const CREDENTIAL = new SlabCredential('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

interface Harness {
  endpoint: string;
  frames: unknown[];
  socket(): Socket;
}

const servers: Array<{ server: Server; dir: string; sockets: Set<Socket> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async ({ server, dir, sockets }) => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }));
});

async function listen(onConnection?: (socket: Socket) => void): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'slab-cdp-'));
  const endpoint = join(dir, 'attachment.sock');
  const frames: unknown[] = [];
  let serverSocket: Socket | undefined;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    serverSocket = socket;
    collectFrames(socket, frames);
    onConnection?.(socket);
  });
  servers.push({ server, dir, sockets });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => resolve());
  });
  return {
    endpoint,
    frames,
    socket() {
      if (!serverSocket) throw new Error('server did not accept a connection');
      return serverSocket;
    },
  };
}

function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.byteLength);
  return Buffer.concat([header, body]);
}

function collectFrames(socket: Socket, frames: unknown[]): void {
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (pending.byteLength >= 4) {
      const length = pending.readUInt32BE(0);
      if (pending.byteLength < length + 4) return;
      frames.push(JSON.parse(pending.subarray(4, length + 4).toString('utf8')));
      pending = pending.subarray(length + 4);
    }
  });
}

async function connectAuthenticated(harness: Harness, timeoutMs = 100): Promise<ConnectOverCDPTransport> {
  const transportPromise = CdpIpcTransport.connect({ endpoint: harness.endpoint, credential: CREDENTIAL, timeoutMs });
  await expect.poll(() => harness.frames.length).toBe(1);
  expect(harness.frames).toEqual([{ type: 'authenticate', credential: CREDENTIAL.reveal() }]);
  harness.socket().write(frame({ type: 'authenticated' }));
  return transportPromise;
}

function closed(transport: ConnectOverCDPTransport): Promise<string | undefined> {
  return new Promise((resolve) => {
    transport.onclose = resolve;
  });
}

describe('CdpIpcTransport', () => {
  it('authenticates, reassembles split frames, and delivers multiple CDP objects', async () => {
    const harness = await listen();
    const transport = await connectAuthenticated(harness);
    const messages: object[] = [];
    transport.onmessage = (message) => messages.push(message);
    transport.open?.();

    const payload = Buffer.concat([frame({ id: 1, result: {} }), frame({ method: 'Target.attachedToTarget', params: {} })]);
    harness.socket().write(payload.subarray(0, 2));
    harness.socket().write(payload.subarray(2, 9));
    harness.socket().write(payload.subarray(9));

    await expect.poll(() => messages).toEqual([{ id: 1, result: {} }, { method: 'Target.attachedToTarget', params: {} }]);
  });

  it('frames raw CDP messages after open', async () => {
    const harness = await listen();
    const transport = await connectAuthenticated(harness);
    transport.open?.();
    transport.send({ id: 1, method: 'Browser.getVersion' });

    await expect.poll(() => harness.frames).toEqual([
      { type: 'authenticate', credential: CREDENTIAL.reveal() },
      { id: 1, method: 'Browser.getVersion' },
    ]);
  });

  it('rejects an advertised frame over 64 MiB before waiting for its body', async () => {
    const harness = await listen();
    const transport = await connectAuthenticated(harness);
    const close = closed(transport);
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(MAX_FRAME_BYTES + 1);
    harness.socket().write(header);

    await expect(close).resolves.toMatch(/64 MiB/i);
  });

  it.each([
    ['invalid JSON', Buffer.from('{not-json}')],
    ['a JSON array', Buffer.from('[]')],
  ])('closes on %s CDP frames', async (_name, body) => {
    const harness = await listen();
    const transport = await connectAuthenticated(harness);
    const close = closed(transport);
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(body.byteLength);
    harness.socket().write(Buffer.concat([header, body]));

    await expect(close).resolves.toMatch(/JSON|object/i);
  });

  it('rejects authentication failures', async () => {
    const harness = await listen();
    const connection = CdpIpcTransport.connect({ endpoint: harness.endpoint, credential: CREDENTIAL, timeoutMs: 100 });
    await expect.poll(() => harness.frames.length).toBe(1);
    harness.socket().write(frame({ type: 'authentication_failed' }));

    await expect(connection).rejects.toThrow(/authentication/i);
  });

  it('rejects when authentication times out', async () => {
    const harness = await listen();
    const connection = CdpIpcTransport.connect({ endpoint: harness.endpoint, credential: CREDENTIAL, timeoutMs: 10 });
    await expect(connection).rejects.toThrow(/timeout/i);
  });

  it('rejects connection errors', async () => {
    await expect(CdpIpcTransport.connect({ endpoint: join(tmpdir(), 'missing-slab-cdp.sock'), credential: CREDENTIAL, timeoutMs: 100 }))
      .rejects.toThrow();
  });

  it('notifies Playwright when the peer closes', async () => {
    const harness = await listen();
    const transport = await connectAuthenticated(harness);
    const close = closed(transport);
    harness.socket().destroy();

    await expect(close).resolves.toMatch(/closed/i);
  });

  it('closes locally only once', async () => {
    const harness = await listen();
    const transport = await connectAuthenticated(harness);
    const close = closed(transport);
    transport.close();
    transport.close();

    await expect(close).resolves.toMatch(/closed/i);
    await expect.poll(() => harness.socket().destroyed || harness.socket().readableEnded).toBe(true);
  });

  it('rejects sends before open and after close', async () => {
    const harness = await listen();
    const transport = await connectAuthenticated(harness);
    expect(() => transport.send({ id: 1 })).toThrow(/open/i);
    transport.open?.();
    transport.close();
    expect(() => transport.send({ id: 2 })).toThrow(/closed/i);
  });
});
