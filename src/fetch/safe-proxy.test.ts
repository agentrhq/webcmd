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
});
