import type { Browser, BrowserContext, ConnectOverCDPTransport } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
import { SlabCredential } from '../../../slab/protocol.js';
import { attachSlabProfile } from './attachment.js';

function attachment() {
  return {
    connectionId: 'connection-1',
    profile: { id: 'default', displayName: 'Default' },
    transport: {
      kind: 'cdp-ipc' as const,
      endpoint: '/tmp/slab-attachment.sock',
      credential: new SlabCredential('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    },
  };
}

function transport(): ConnectOverCDPTransport {
  return { open: vi.fn(), send: vi.fn(), close: vi.fn() };
}

describe('attachSlabProfile', () => {
  it('connects Playwright through the authenticated IPC transport', async () => {
    const lease = attachment();
    const cdpTransport = transport();
    const context = {} as any;
    const browser = { contexts: vi.fn(() => [context]), version: vi.fn(() => '152.0') } as any;
    const bridge = { attach: vi.fn().mockResolvedValue(lease), release: vi.fn().mockResolvedValue(null), close: vi.fn().mockResolvedValue(null) };
    const connectTransport = vi.fn().mockResolvedValue(cdpTransport);
    const connectOverCDP = vi.fn().mockResolvedValue(browser);

    const result = await attachSlabProfile('default', {
      bridge,
      connectTransport,
      connectOverCDP,
      attachTimeoutMs: 123,
    });

    expect(connectTransport).toHaveBeenCalledWith({ ...lease.transport, timeoutMs: 123 });
    expect(connectOverCDP).toHaveBeenCalledWith(cdpTransport, { timeout: 123 });
    expect(result.context).toBe(context);
  });

  it('creates a launch-aware control bridge when a caller does not provide one', async () => {
    const lease = attachment();
    const bridge = {
      attach: vi.fn().mockResolvedValue(lease),
      release: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const connectBridge = vi.fn().mockResolvedValue(bridge);
    const context = {} as BrowserContext;
    const browser = { contexts: () => [context], version: () => '1' } as unknown as Browser;

    await attachSlabProfile('default', {
      connectBridge,
      connectTransport: vi.fn().mockResolvedValue({ close: vi.fn() }),
      connectOverCDP: vi.fn().mockResolvedValue(browser),
    });

    expect(connectBridge).toHaveBeenCalledOnce();
    expect(bridge.attach).toHaveBeenCalledWith('default');
  });

  it('closes the transport and releases the lease when Playwright setup fails', async () => {
    const lease = attachment();
    const cdpTransport = transport();
    const bridge = { attach: vi.fn().mockResolvedValue(lease), release: vi.fn().mockResolvedValue(null), close: vi.fn().mockResolvedValue(null) };
    const connectTransport = vi.fn().mockResolvedValue(cdpTransport);
    const connectOverCDP = vi.fn().mockRejectedValue(new Error('Playwright refused the connection'));

    await expect(attachSlabProfile('default', { bridge, connectTransport, connectOverCDP })).rejects.toThrow('Playwright refused');
    expect(cdpTransport.close).toHaveBeenCalledOnce();
    expect(bridge.release).toHaveBeenCalledWith('connection-1');
    expect(bridge.close).toHaveBeenCalledOnce();
  });

  it('closes the bridge when native attach fails before a lease exists', async () => {
    const bridge = {
      attach: vi.fn().mockRejectedValue(new Error('profile missing')),
      release: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(null),
    };

    await expect(attachSlabProfile('default', { bridge })).rejects.toThrow('profile missing');
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(bridge.release).not.toHaveBeenCalled();
  });

  it('closes its local transport before releasing the native lease', async () => {
    const lease = attachment();
    const cdpTransport = transport();
    const context = {} as any;
    const browser = { contexts: vi.fn(() => [context]), version: vi.fn(() => '152.0') } as any;
    const bridge = { attach: vi.fn().mockResolvedValue(lease), release: vi.fn().mockResolvedValue(null), close: vi.fn().mockResolvedValue(null) };
    const result = await attachSlabProfile('default', {
      bridge,
      connectTransport: vi.fn().mockResolvedValue(cdpTransport),
      connectOverCDP: vi.fn().mockResolvedValue(browser),
    });

    await result.release();

    expect(cdpTransport.close).toHaveBeenCalledOnce();
    expect(bridge.release).toHaveBeenCalledWith('connection-1');
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(vi.mocked(cdpTransport.close).mock.invocationCallOrder[0]).toBeLessThan(bridge.release.mock.invocationCallOrder[0]!);
  });
});
