import { describe, expect, it, vi } from 'vitest';
import { connectSlabControlBridge } from './control-bridge.js';

describe('SLAB control bridge', () => {
  it('probes or opens SLAB before creating the lease-owning control client', async () => {
    const calls: string[] = [];
    const client = {
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
    expect(client.attach).toHaveBeenCalledWith('default');
    expect(client.release).toHaveBeenCalledWith('connection-1');
  });

  it('can close the control client before a lease exists', async () => {
    const client = {
      attach: vi.fn(),
      release: vi.fn(),
      close: vi.fn(async () => null),
    };
    const bridge = await connectSlabControlBridge({
      ensureLaunched: async () => undefined,
      connect: async () => client as never,
    });

    await bridge.close();

    expect(client.close).toHaveBeenCalledOnce();
  });
});
