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
  const sockets = new Set<net.Socket | Duplex>();
  const trackSocket = (socket: net.Socket | Duplex) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
  const server = http.createServer(async (request, response) => {
    try {
      const target = new URL(request.url ?? '');
      const address = await resolve(target.hostname, lookup, allowPrivate);
      const upstream = http.request({ host: address, port: Number(target.port) || 80, method: request.method, path: `${target.pathname}${target.search}`, headers: { ...request.headers, host: target.host } }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on('error', () => { upstream.destroy(); response.destroy(); });
      request.on('error', () => upstream.destroy());
      request.pipe(upstream);
    } catch (error) { response.writeHead(403).end(error instanceof Error ? error.message : 'Unsafe fetch destination'); }
  });
  server.on('connect', async (request, client, head) => {
    trackSocket(client);
    let upstream: net.Socket | undefined;
    // Persistent (not `once`) handlers: writes to an already half-closed peer keep emitting
    // 'error', and with no listener at all Node throws and kills the process (EPIPE crash).
    client.on('error', () => { client.destroy(); upstream?.destroy(); });
    try {
      const [host, portText] = (request.url ?? '').replace(/^\[/, '').replace(']', '').split(':');
      if (!host) throw new Error('Invalid CONNECT target');
      const address = await resolve(host, lookup, allowPrivate);
      upstream = net.connect({ host: address, port: Number(portText) || 443 });
      trackSocket(upstream);
      upstream.on('error', () => { upstream?.destroy(); client.destroy(); });
      upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream!.write(head); upstream!.pipe(client); client.pipe(upstream!); });
    } catch (error) { client.end(`HTTP/1.1 403 Forbidden\r\n\r\n${error instanceof Error ? error.message : ''}`); }
  });
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolveListen()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Safe proxy did not bind');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, reject) => {
      for (const socket of sockets) socket.destroy();
      server.close(error => error ? reject(error) : resolveClose());
    }),
  };
}
