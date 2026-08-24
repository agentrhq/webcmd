import { lookup as dnsLookup } from 'node:dns';
import * as http from 'node:http';
import * as net from 'node:net';
import type { Duplex } from 'node:stream';

export interface SafeProxy { url: string; close(): Promise<void>; policyError(): Error | undefined; }
export interface SafeProxyOptions { allowPrivate?: boolean; lookup?: typeof dnsLookup; }

export function isSafeAddress(address: string): boolean {
  const unscoped = address.split('%', 1)[0]!;
  if (net.isIPv4(unscoped)) return isSafeIpv4(unscoped.split('.').map(Number));
  if (!net.isIPv6(unscoped)) return false;
  const words = parseIpv6Words(unscoped);
  if (!words) return false;

  const embedded = embeddedIpv4(words);
  if (embedded) return isSafeIpv4(embedded);

  // Server-side fetch is public-network-only. Global unicast is 2000::/3;
  // everything else (unspecified, loopback, link-local, ULA, multicast,
  // documentation, and future special-use space) fails closed.
  if (words[0]! < 0x2000 || words[0]! > 0x3fff) return false;
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false;

  // 6to4 carries an IPv4 destination in words 1-2. Do not let an alternate
  // IPv6 spelling turn a private/metadata IPv4 destination into public egress.
  if (words[0] === 0x2002 && !isSafeIpv4(wordsToIpv4(words[1]!, words[2]!))) return false;
  return true;
}

function isSafeIpv4(bytes: number[]): boolean {
  if (bytes.length !== 4 || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) return false;
  const [a, b, c] = bytes as [number, number, number, number];
  return a !== 0 && a !== 10 && a !== 127
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && b === 0 && (c === 0 || c === 2))
    && !(a === 192 && b === 88 && c === 99)
    && !(a === 192 && b === 168)
    && !(a === 198 && (b === 18 || b === 19))
    && !(a === 198 && b === 51 && c === 100)
    && !(a === 203 && b === 0 && c === 113)
    && a < 224;
}

function parseIpv6Words(address: string): number[] | undefined {
  let normalized = address.toLowerCase();
  const dotted = normalized.match(/(^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const bytes = dotted[2]!.split('.').map(Number);
    if (!isValidIpv4(bytes)) return undefined;
    normalized = `${normalized.slice(0, dotted.index! + dotted[1]!.length)}${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`;
  }
  if (normalized.split('::').length > 2) return undefined;
  const [leftText, rightText] = normalized.split('::');
  const left = leftText ? leftText.split(':').map(parseHexWord) : [];
  const right = rightText ? rightText.split(':').map(parseHexWord) : [];
  if ([...left, ...right].some(word => word === undefined)) return undefined;
  const missing = 8 - left.length - right.length;
  if ((normalized.includes('::') && missing < 1) || (!normalized.includes('::') && missing !== 0)) return undefined;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right] as number[];
}

function parseHexWord(value: string): number | undefined {
  if (!/^[0-9a-f]{1,4}$/.test(value)) return undefined;
  return Number.parseInt(value, 16);
}

function isValidIpv4(bytes: number[]): boolean {
  return bytes.length === 4 && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

function wordsToIpv4(high: number, low: number): number[] {
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff];
}

function embeddedIpv4(words: number[]): number[] | undefined {
  const last = wordsToIpv4(words[6]!, words[7]!);
  const zero = (end: number) => words.slice(0, end).every(word => word === 0);
  if (zero(6)) return last; // IPv4-compatible, including ::127.0.0.1
  if (zero(5) && words[5] === 0xffff) return last; // IPv4-mapped
  if (zero(4) && words[4] === 0xffff && words[5] === 0) return last; // IPv4-translated
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every(word => word === 0)) return last; // NAT64 well-known
  if (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 1) return last; // NAT64 local-use
  return undefined;
}

function unbracketHost(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
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
  let firstPolicyError: Error | undefined;
  const track = <T extends Duplex>(socket: T): T => {
    if (closing) { socket.destroy(); return socket; }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    // A destroyed peer must not resurface as an unhandled 'error' event.
    socket.on('error', () => socket.destroy());
    return socket;
  };
  const server = http.createServer(async (request, response) => {
    let upstream: http.ClientRequest | undefined;
    request.on('error', () => { upstream?.destroy(); response.destroy(); });
    response.on('error', () => { upstream?.destroy(); request.destroy(); });
    try {
      const target = new URL(request.url ?? '');
      const targetHost = unbracketHost(target.hostname);
      const address = await resolve(targetHost, lookup, allowPrivate);
      if (closing) { response.destroy(); return; }
      upstream = http.request({ host: address, port: Number(target.port) || 80, method: request.method, path: `${target.pathname}${target.search}`, headers: { ...request.headers, host: target.host } }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on('socket', track);
      upstream.on('error', error => response.destroy(error));
      request.pipe(upstream);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Unsafe fetch destination:')) firstPolicyError ??= error;
      response.writeHead(403).end(error instanceof Error ? error.message : 'Unsafe fetch destination');
    }
  });
  server.on('connection', track);
  server.on('connect', async (request, client, head) => {
    track(client);
    let upstream: net.Socket | undefined;
    client.on('error', () => upstream?.destroy());
    client.on('close', () => upstream?.destroy());
    try {
      const authority = new URL(`http://${request.url ?? ''}`);
      const host = unbracketHost(authority.hostname);
      const portText = authority.port;
      if (!host) throw new Error('Invalid CONNECT target');
      const address = await resolve(host, lookup, allowPrivate);
      if (closing) { client.destroy(); return; }
      const tunnel = track(net.connect({ host: address, port: Number(portText) || 443 }));
      upstream = tunnel;
      tunnel.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) tunnel.write(head); tunnel.pipe(client); client.pipe(tunnel); });
      tunnel.on('error', error => client.destroy(error));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Unsafe fetch destination:')) firstPolicyError ??= error;
      client.end(`HTTP/1.1 403 Forbidden\r\n\r\n${error instanceof Error ? error.message : ''}`);
    }
  });
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolveListen()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Safe proxy did not bind');
  let closed: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}`,
    policyError: () => firstPolicyError,
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
