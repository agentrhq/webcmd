import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { SlabBridgeClient } from './bridge-client.js';

function fakeSocket() {
  const client = Object.assign(new EventEmitter(), {
    destroy() {},
    write() { return true; },
  });
  const server = { write: (line: string) => client.emit('data', Buffer.from(line)) };
  return { client, server };
}

describe('SLAB bridge client', () => {
  it('round-trips one request per newline-delimited response', async () => {
    const socket = fakeSocket();
    const client = new SlabBridgeClient({ connect: () => socket.client });
    const hello = client.hello('1.9.0');
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
});
