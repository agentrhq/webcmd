import { lookup as dnsLookup } from 'node:dns';
import * as http from 'node:http';
import * as net from 'node:net';
import type { Duplex } from 'node:stream';

export interface SafeProxy { url: string; close(): Promise<void>; }
export interface SafeProxyOptions { allowPrivate?: boolean; lookup?: typeof dnsLookup; }

export function isSafeAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)
      && a < 224;
  }
  if (!net.isIPv6(address)) return false;
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isSafeAddress(mapped[1]!);
  if (normalized === '::' || normalized === '::1') return false;
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return !(first >= 0xfc00 && first <= 0xfdff) && !(first >= 0xfe80 && first <= 0xfebf) && !(first >= 0xff00);
}

async function resolve(host: string, lookup: typeof dnsLookup, allowPrivate: boolean): Promise<string> {
  if (net.isIP(host)) {
    if (!allowPrivate && !isSafeAddress(host)) throw new Error(`Unsafe fetch destination: ${host}`);
    return host;
  }
  const addresses = await new Promise<Array<{ address: string; family: number }>>((resolveLookup, reject) => {
    lookup(host, { all: true, verbatim: true }, (error, result) => error ? reject(error) : resolveLookup(result));
  });
  if (!addresses.length || (!allowPrivate && addresses.some(({ address }) => !isSafeAddress(address)))) {
    throw new Error(`Unsafe fetch destination: ${host}`);
  }
  return addresses[0]!.address;
}

export async function createSafeProxy(options: SafeProxyOptions = {}): Promise<SafeProxy> {
  const lookup = options.lookup ?? dnsLookup;
  const allowPrivate = options.allowPrivate === true;
  // Sockets opened through this proxy, including the upstream halves the HTTP
  // server never learns about. `close()` destroys them: a keep-alive CONNECT
  // tunnel otherwise keeps `server.close()` pending until the peer or the OS
  // gives up, which turns a bounded fetch budget into a minutes-long hang.
  const sockets = new Set<Duplex>();
  // Both request paths await DNS before connecting upstream, so a resolution that
  // lands after `close()` could otherwise open an untracked socket — outbound
  // traffic after the fetch budget expired, and one more handle holding the
  // process open. Once closing, nothing new is tracked or dialled.
  let closing = false;
  const track = <T extends Duplex>(socket: T): T => {
    if (closing) { socket.destroy(); return socket; }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    // A destroyed peer must not resurface as an unhandled 'error' event.
    socket.on('error', () => socket.destroy());
    return socket;
  };
  const server = http.createServer(async (request, response) => {
    try {
      const target = new URL(request.url ?? '');
      const address = await resolve(target.hostname, lookup, allowPrivate);
      if (closing) { response.destroy(); return; }
      const upstream = http.request({ host: address, port: Number(target.port) || 80, method: request.method, path: `${target.pathname}${target.search}`, headers: { ...request.headers, host: target.host } }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on('socket', track);
      upstream.on('error', error => response.destroy(error));
      request.pipe(upstream);
    } catch (error) { response.writeHead(403).end(error instanceof Error ? error.message : 'Unsafe fetch destination'); }
  });
  server.on('connection', track);
  server.on('connect', async (request, client, head) => {
    track(client);
    try {
      const [host, portText] = (request.url ?? '').replace(/^\[/, '').replace(']', '').split(':');
      if (!host) throw new Error('Invalid CONNECT target');
      const address = await resolve(host, lookup, allowPrivate);
      if (closing) { client.destroy(); return; }
      const upstream = track(net.connect({ host: address, port: Number(portText) || 443 }));
      upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); upstream.pipe(client); client.pipe(upstream); });
      upstream.once('error', error => client.destroy(error));
    } catch (error) { client.end(`HTTP/1.1 403 Forbidden\r\n\r\n${error instanceof Error ? error.message : ''}`); }
  });
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolveListen()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Safe proxy did not bind');
  let closed: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}`,
    // Idempotent: a second close() awaits the first rather than asking an
    // already-stopped server to close again.
    close: () => (closed ??= new Promise((resolveClose, reject) => {
      closing = true;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      server.close(error => error ? reject(error) : resolveClose());
    })),
  };
}
