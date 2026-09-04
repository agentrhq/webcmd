import * as net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { describe, expect, it } from 'vitest';
import { createSafeProxy, isSafeAddress } from './safe-proxy.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

describe('isSafeAddress', () => {
  it.each([
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0',
    '::1', '::', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1', '::127.0.0.1', '::ffff:0:7f00:1',
    '64:ff9b::7f00:1',
  ])('rejects private address %s', address => {
    expect(isSafeAddress(address)).toBe(false);
  });
  it.each(['93.184.216.34', '192.0.3.1', '198.51.1.1', '203.0.114.1'])('allows public IPv4 address %s', address => {
    expect(isSafeAddress(address)).toBe(true);
  });
  it.each(['::ffff:5db8:d822', '2001:4860:4860::8888'])('allows public IPv6 address %s', address => {
    expect(isSafeAddress(address)).toBe(true);
  });
});

describe('createSafeProxy close', () => {
  it('does not crash the process when a tunnel client resets', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'webcmd-safe-proxy-rst-'));
    const scriptPath = path.join(dir, 'repro.mjs');
    const safeProxyUrl = pathToFileURL(path.join(moduleDir, 'safe-proxy.ts')).href;
    await writeFile(scriptPath, [
      "import * as net from 'node:net';",
      `import { createSafeProxy } from ${JSON.stringify(safeProxyUrl)};`,
      "const upstream = net.createServer(socket => socket.resume());",
      "await new Promise(done => upstream.listen(0, '127.0.0.1', done));",
      'const proxy = await createSafeProxy({ allowPrivate: true });',
      'const client = net.connect({ host: "127.0.0.1", port: Number(new URL(proxy.url).port) });',
      'await new Promise((resolve, reject) => {',
      '  client.once("error", reject);',
      '  client.once("data", resolve);',
      '  client.write(`CONNECT 127.0.0.1:${upstream.address().port} HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\n\\r\\n`);',
      '});',
      'client.resetAndDestroy();',
      'await new Promise(done => setTimeout(done, 100));',
      'await proxy.close();',
      'await new Promise(done => upstream.close(done));',
    ].join('\n'));

    try {
      const result = await new Promise<{ status: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', scriptPath], { stdio: ['ignore', 'ignore', 'pipe'] });
        const stderr: Buffer[] = [];
        child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
        child.once('error', reject);
        child.once('close', status => resolve({ status, stderr: Buffer.concat(stderr).toString('utf8') }));
      });
      expect(result.stderr).not.toContain('ECONNRESET');
      expect(result.status).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it('destroys the upstream tunnel when the client leg resets', async () => {
    let upstreamSocket: net.Socket | undefined;
    const upstream = net.createServer(socket => { upstreamSocket = socket; socket.resume(); });
    await new Promise<void>(done => upstream.listen(0, '127.0.0.1', () => done()));
    const upstreamPort = (upstream.address() as net.AddressInfo).port;
    const proxy = await createSafeProxy({ allowPrivate: true });

    const client = net.connect({ host: '127.0.0.1', port: Number(new URL(proxy.url).port) });
    client.on('error', () => {});
    await new Promise<void>(done => {
      client.once('data', () => done());
      client.write(`CONNECT 127.0.0.1:${upstreamPort} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
    });
    expect(upstreamSocket).toBeDefined();

    const upstreamClosed = new Promise<boolean>(resolve => {
      upstreamSocket!.once('close', () => resolve(true));
      setTimeout(() => resolve(false), 250);
    });
    client.resetAndDestroy();

    expect(await upstreamClosed).toBe(true);
    await proxy.close();
    await new Promise<void>(done => upstream.close(() => done()));
  });

  it('does not wait for an idle CONNECT tunnel to drain', async () => {
    // Stands in for the upstream host: accepts and then never says anything,
    // exactly like the keep-alive tunnels impit leaves behind.
    const upstream = net.createServer(() => {});
    await new Promise<void>(done => upstream.listen(0, '127.0.0.1', () => done()));
    const upstreamPort = (upstream.address() as net.AddressInfo).port;
    const proxy = await createSafeProxy({ allowPrivate: true });
    const proxyPort = Number(new URL(proxy.url).port);

    const client = net.connect({ host: '127.0.0.1', port: proxyPort });
    client.on('error', () => {});
    await new Promise<void>(done => {
      client.once('data', () => done());
      client.write(`CONNECT 127.0.0.1:${upstreamPort} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
    });

    const started = Date.now();
    await proxy.close();
    expect(Date.now() - started).toBeLessThan(1000);
    await new Promise<void>(done => client.once('close', () => done()));
    await new Promise<void>(done => upstream.close(() => done()));
  });

  it('does not open an upstream tunnel from a DNS lookup that finishes after close()', async () => {
    // Counts every accepted connection: the proxy must not dial us at all once
    // close() has begun, however late the lookup that was already in flight.
    let accepted = 0;
    const upstream = net.createServer(socket => { accepted += 1; socket.destroy(); });
    await new Promise<void>(done => upstream.listen(0, '127.0.0.1', () => done()));
    const upstreamPort = (upstream.address() as net.AddressInfo).port;

    // A lookup that only resolves when we say so, so the CONNECT handler is
    // parked mid-await exactly when close() starts.
    let releaseLookup: (() => void) | undefined;
    let onLookup: () => void;
    const lookupCalled = new Promise<void>(done => { onLookup = done; });
    const proxy = await createSafeProxy({
      allowPrivate: true,
      lookup: ((_host: string, _options: unknown, callback: (error: Error | null, result: unknown) => void) => {
        releaseLookup = () => callback(null, [{ address: '127.0.0.1', family: 4 }]);
        onLookup();
      }) as never,
    });

    const client = net.connect({ host: '127.0.0.1', port: Number(new URL(proxy.url).port) });
    client.on('error', () => {});
    client.write(`CONNECT example.test:${upstreamPort} HTTP/1.1\r\nHost: example.test\r\n\r\n`);
    await lookupCalled;

    const started = Date.now();
    const closePromise = proxy.close();
    releaseLookup?.();
    await closePromise;
    await proxy.close(); // repeated close is safe
    expect(Date.now() - started).toBeLessThan(1000);
    await new Promise(done => setTimeout(done, 50));
    expect(accepted).toBe(0);

    client.destroy();
    await new Promise<void>(done => upstream.close(() => done()));
  });
});

describe('createSafeProxy policy errors', () => {
  it('records the first rejected private destination', async () => {
    const proxy = await createSafeProxy({ allowPrivate: false });
    const client = net.connect({ host: '127.0.0.1', port: Number(new URL(proxy.url).port) });
    const reply = await new Promise<string>(done => {
      let data = '';
      client.on('data', chunk => { data += chunk; });
      client.on('end', () => done(data));
      client.write('CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    });
    expect(reply).toContain('403 Forbidden');
    expect(proxy.policyError()?.message).toContain('Unsafe fetch destination');
    await proxy.close();
  });

  it('leaves the policy slot empty when private addresses are allowed', async () => {
    const proxy = await createSafeProxy({ allowPrivate: true });
    expect(proxy.policyError()).toBeUndefined();
    await proxy.close();
  });

  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:a9fe:a9fe',
  ])('rejects a private or metadata DNS answer %s', async address => {
    const proxy = await createSafeProxy({
      lookup: ((_host: string, _options: unknown, callback: (error: Error | null, result: unknown) => void) => {
        callback(null, [{ address, family: 6 }]);
      }) as never,
    });
    await expect(undiciFetch('http://example.test/', { dispatcher: new ProxyAgent(proxy.url) } as never))
      .rejects.toThrow('fetch failed');
    expect(proxy.policyError()?.message).toBe('Unsafe fetch destination: example.test');
    await proxy.close();
  });
});
