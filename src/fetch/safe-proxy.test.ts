import * as net from 'node:net';
import { describe, expect, it } from 'vitest';
import { createSafeProxy, isSafeAddress } from './safe-proxy.js';

describe('isSafeAddress', () => {
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', '::', 'fe80::1', '::ffff:127.0.0.1'])('rejects private address %s', address => {
    expect(isSafeAddress(address)).toBe(false);
  });
  it('allows public IPv4 addresses', () => expect(isSafeAddress('93.184.216.34')).toBe(true));
});

describe('createSafeProxy close', () => {
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
});
