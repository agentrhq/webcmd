import * as net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createSafeProxy, isSafeAddress } from './safe-proxy.js';

describe('isSafeAddress', () => {
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', '::', 'fe80::1', '::ffff:127.0.0.1'])('rejects private address %s', address => {
    expect(isSafeAddress(address)).toBe(false);
  });
  it('allows public IPv4 addresses', () => expect(isSafeAddress('93.184.216.34')).toBe(true));
});

describe('createSafeProxy CONNECT tunnel', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())); });

  async function startOrigin(onSocket?: (socket: net.Socket) => void): Promise<{ port: number; server: net.Server }> {
    const server = net.createServer(socket => onSocket?.(socket));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    return { port: (server.address() as net.AddressInfo).port, server };
  }

  async function openTunnel(proxyUrl: string, originPort: number): Promise<net.Socket> {
    const url = new URL(proxyUrl);
    const client = net.connect(Number(url.port), url.hostname);
    cleanup.push(() => { client.destroy(); });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => client.write(`CONNECT 127.0.0.1:${originPort} HTTP/1.1\r\nHost: 127.0.0.1:${originPort}\r\n\r\n`));
      client.once('data', () => resolve());
      client.once('error', reject);
    });
    return client;
  }

  it('does not crash the process when the client resets mid-tunnel', async () => {
    const { port: originPort } = await startOrigin(socket => {
      const interval = setInterval(() => { if (!socket.destroyed) socket.write('x'.repeat(4096)); }, 5);
      socket.on('close', () => clearInterval(interval));
      cleanup.push(() => clearInterval(interval));
    });

    const proxy = await createSafeProxy({ allowPrivate: true });
    cleanup.push(() => proxy.close());
    const client = await openTunnel(proxy.url, originPort);

    const uncaught: unknown[] = [];
    const onUncaughtException = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaughtException);

    try {
      // Reset instead of a clean FIN so the proxy's next write to this socket fails
      // (reproduces the EPIPE from #283: writing to an already half-closed peer).
      client.resetAndDestroy ? client.resetAndDestroy() : client.destroy();
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(uncaught).toEqual([]);
    } finally {
      process.removeListener('uncaughtException', onUncaughtException);
    }
  });

  it('close() tears down in-flight tunnels instead of hanging', async () => {
    const { port: originPort } = await startOrigin(socket => socket.on('data', () => {}));
    const proxy = await createSafeProxy({ allowPrivate: true });
    await openTunnel(proxy.url, originPort);

    const closed = await Promise.race([
      proxy.close().then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1000)),
    ]);
    expect(closed).toBe(true);
  });
});
