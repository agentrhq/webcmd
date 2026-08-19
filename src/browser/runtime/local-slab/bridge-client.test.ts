import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLAB_SOCKET_PATH, SlabBridgeClient, SlabBridgeUnavailableError } from './bridge-client.js';

function fakeSocket() {
  const client = Object.assign(new EventEmitter(), {
    destroy() {},
    write(_data: string) { return true; },
  });
  const server = { write: (line: string) => client.emit('data', Buffer.from(line)) };
  return { client, server };
}

describe('SLAB bridge client', () => {
  it('uses the per-user SLAB bridge socket by default', () => {
    expect(DEFAULT_SLAB_SOCKET_PATH).toMatch(/\/\.slab\/bridge\.sock$/);
    expect(DEFAULT_SLAB_SOCKET_PATH).not.toBe('/tmp/slab-bridge.sock');
  });

  it('round-trips one request per newline-delimited response', async () => {
    const socket = fakeSocket();
    const client = new SlabBridgeClient({ connect: () => socket.client });
    const hello = client.hello('1.9.0');
    socket.server.write('{"id":"1","ok":true,"result":{"protocolVersion":1,"browserVersion":"1","browserPid":1234,"profiles":[]}}\n');

    await expect(hello).resolves.toMatchObject({ protocolVersion: 1 });
  });

  it('sends the v1 protocol compatibility range', async () => {
    const socket = fakeSocket();
    const write = vi.spyOn(socket.client, 'write');
    const client = new SlabBridgeClient({ connect: () => socket.client });
    const hello = client.hello('1.9.0');
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      params: { protocolVersion: 1, protocolMinVersion: 1, protocolMaxVersion: 1 },
    });
    socket.server.write('{"id":"1","ok":true,"result":{"protocolVersion":1,"browserVersion":"1","browserPid":1234,"profiles":[]}}\n');
    await expect(hello).resolves.toMatchObject({ protocolVersion: 1 });
  });

  it('rejects an incompatible endpoint without attaching', async () => {
    const socket = fakeSocket();
    const client = new SlabBridgeClient({ connect: () => socket.client });
    const hello = client.hello('1.9.0');
    socket.server.write('{"id":"1","ok":true,"result":{"protocolVersion":2,"browserVersion":"1","browserPid":1234,"profiles":[]}}\n');

    await expect(hello).rejects.toMatchObject({ code: 'SLAB_UPDATE_REQUIRED' });
  });

  it('reconnects after an unavailable endpoint', async () => {
    const first = fakeSocket();
    const second = fakeSocket();
    const connect = vi.fn().mockReturnValueOnce(first.client).mockReturnValueOnce(second.client);
    const client = new SlabBridgeClient({ connect });
    const unavailable = client.hello('1.9.0');
    first.client.emit('error', new Error('offline'));
    await expect(unavailable).rejects.toThrow('offline');

    const hello = client.hello('1.9.0');
    second.server.write('{"id":"2","ok":true,"result":{"protocolVersion":1,"browserVersion":"1","browserPid":1234,"profiles":[]}}\n');
    await expect(hello).resolves.toMatchObject({ protocolVersion: 1 });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('ignores stale socket data after reconnecting', async () => {
    const first = fakeSocket();
    const second = fakeSocket();
    const client = new SlabBridgeClient({ connect: vi.fn().mockReturnValueOnce(first.client).mockReturnValueOnce(second.client) });
    const unavailable = client.hello('1.9.0');
    first.client.emit('error', new Error('offline'));
    await expect(unavailable).rejects.toBeInstanceOf(SlabBridgeUnavailableError);

    const hello = client.hello('1.9.0');
    first.server.write('{"id":"2","ok":true,"result":{"protocolVersion":1,"browserVersion":"stale","browserPid":1234,"profiles":[]}}\n');
    second.server.write('{"id":"2","ok":true,"result":{"protocolVersion":1,"browserVersion":"1","browserPid":1234,"profiles":[]}}\n');
    await expect(hello).resolves.toMatchObject({ browserVersion: '1' });
  });

  it('rejects oversized responses', async () => {
    const socket = fakeSocket();
    const client = new SlabBridgeClient({ connect: () => socket.client });
    const hello = client.hello('1.9.0');
    socket.server.write(`${'x'.repeat(64 * 1024 + 1)}\n`);

    await expect(hello).rejects.toThrow('exceeds 64 KiB');
  });

  it('rejects duplicate response IDs', async () => {
    const socket = fakeSocket();
    const client = new SlabBridgeClient({ connect: () => socket.client });
    const hello = client.hello('1.9.0');
    const attachment = client.attach('profile-1');
    const response = '{"id":"1","ok":true,"result":{"protocolVersion":1,"browserVersion":"1","browserPid":1234,"profiles":[]}}\n';
    socket.server.write(response);
    socket.server.write(response);

    await expect(hello).resolves.toMatchObject({ protocolVersion: 1 });
    await expect(attachment).rejects.toThrow('duplicate response ID');
  });

  it('rejects invalid result shapes', async () => {
    const socket = fakeSocket();
    const client = new SlabBridgeClient({ connect: () => socket.client });
    const hello = client.hello('1.9.0');
    socket.server.write('{"id":"1","ok":true,"result":{"protocolVersion":1,"browserVersion":"1","profiles":[]}}\n');

    await expect(hello).rejects.toThrow('invalid hello result');
  });

  it('rejects endpoint errors', async () => {
    const socket = fakeSocket();
    const client = new SlabBridgeClient({ connect: () => socket.client });
    const hello = client.hello('1.9.0');
    socket.server.write('{"id":"1","ok":false,"error":{"message":"bridge denied request"}}\n');

    await expect(hello).rejects.toThrow('bridge denied request');
  });

  it('times out requests after five seconds', async () => {
    vi.useFakeTimers();
    const client = new SlabBridgeClient({ connect: () => fakeSocket().client });
    const hello = client.hello('1.9.0');
    const rejected = expect(hello).rejects.toBeInstanceOf(SlabBridgeUnavailableError);
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    vi.useRealTimers();
  });
});
