import { describe, expect, it, vi } from 'vitest';
import { connectSlabControlBridge } from './control-bridge.js';

describe('SLAB control bridge', () => {
  it('probes or opens SLAB before creating the lease-owning control client', async () => {
    const calls: string[] = [];
    const client = {
      hello: vi.fn(async () => ({ protocolVersion: 2 })),
      attach: vi.fn(async () => ({ connectionId: 'connection-1' })),
      release: vi.fn(async () => null),
      close: vi.fn(async () => { calls.push('close'); }),
    };
    const bridge = await connectSlabControlBridge({
      ensureLaunched: async () => { calls.push('launch'); },
      connect: async () => {
        calls.push('connect');
        return client as never;
      },
    });

    await bridge.attach('default');
    await bridge.release('connection-1');

    expect(calls).toEqual(['launch', 'connect', 'close']);
    expect(client.hello).toHaveBeenCalledOnce();
    expect(client.attach).toHaveBeenCalledWith('default');
    expect(client.release).toHaveBeenCalledWith('connection-1');
  });

  it('can close the control client before a lease exists', async () => {
    const client = {
      hello: vi.fn(async () => ({ protocolVersion: 1 })),
      attach: vi.fn(),
      release: vi.fn(),
      close: vi.fn(async () => null),
    };
    const bridge = await connectSlabControlBridge({
      ensureLaunched: async () => undefined,
      connect: async () => client as never,
    });

    await bridge.close();

    expect(client.hello).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it.each([
    new Error('incompatible protocol'),
    new Error('malformed hello response'),
    new Error('connection closed during hello'),
  ])('closes the control client exactly once when required hello fails: %s', async (failure) => {
    const client = {
      hello: vi.fn().mockRejectedValue(failure),
      attach: vi.fn(),
      release: vi.fn(),
      close: vi.fn().mockRejectedValue(new Error('secondary close failure')),
    };
    await expect(connectSlabControlBridge({
      ensureLaunched: async () => undefined,
      connect: async () => client as never,
    })).rejects.toBe(failure);
    expect(client.hello).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
    expect(client.attach).not.toHaveBeenCalled();
  });
});
