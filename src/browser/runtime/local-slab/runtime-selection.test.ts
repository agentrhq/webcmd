import { describe, expect, it, vi } from 'vitest';

function fakeAttachedProfile() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const pageListeners = new WeakMap<object, Map<string, Set<(...args: unknown[]) => void>>>();
  const targetIds = new WeakMap<object, string>();
  const windowIds = new Map<string, number>();
  let targetCounter = 0;
  let windowCounter = 0;
  let context: any;
  const fakePage = () => {
    let closed = false;
    const page: any = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue('ok'),
      title: vi.fn().mockResolvedValue('Title'),
      url: vi.fn(() => 'https://example.com/'),
      bringToFront: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn(() => closed),
      close: vi.fn(async () => {
        closed = true;
      }),
      opener: vi.fn().mockResolvedValue(null),
      on(event: string, listener: (...args: unknown[]) => void) {
        const events = pageListeners.get(page) ?? new Map();
        const bucket = events.get(event) ?? new Set();
        bucket.add(listener);
        events.set(event, bucket);
        pageListeners.set(page, events);
      },
      once(event: string, listener: (...args: unknown[]) => void) {
        const once = (...args: unknown[]) => {
          page.off(event, once);
          listener(...args);
        };
        page.on(event, once);
      },
      off(event: string, listener: (...args: unknown[]) => void) {
        pageListeners.get(page)?.get(event)?.delete(listener);
      },
    };
    targetIds.set(page, `target-${++targetCounter}`);
    windowIds.set(targetIds.get(page)!, ++windowCounter);
    return page;
  };
  const page = fakePage();
  const allPages = [page];
  const cdp = {
    send: vi.fn(async (command: string, params?: { targetId?: string; hidden?: boolean }) => {
      if (command === 'Target.createTarget') {
        const created = fakePage();
        allPages.push(created);
        queueMicrotask(() => {
          for (const listener of listeners.get('page') ?? []) listener(created);
        });
        return { targetId: targetIds.get(created) };
      }
      if (command === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
      if (command === 'Target.closeTarget') return { success: true };
      return {};
    }),
    on: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    newBrowserCDPSession: vi.fn().mockResolvedValue(cdp),
    contexts: vi.fn(() => [context]),
    version: vi.fn(() => '146.0'),
  };
  context = {
    on(event: string, listener: (...args: unknown[]) => void) {
      const bucket = listeners.get(event) ?? new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
    pages: vi.fn(() => allPages.filter((candidate) => !candidate.isClosed())),
    newPage: vi.fn(async () => {
      const created = fakePage();
      allPages.push(created);
      return created;
    }),
    newCDPSession: vi.fn(async (target: object) => ({
      send: vi.fn(async (command: string, params?: { targetId?: string }) => {
        if (command === 'Target.getTargetInfo') return { targetInfo: { targetId: targetIds.get(target) } };
        if (command === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
        return {};
      }),
      detach: vi.fn().mockResolvedValue(undefined),
    })),
    browser: vi.fn(() => browser),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    profileId: 'default',
    browserVersion: '146.0',
    context,
    browser,
    closeTransport: vi.fn(),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

describe('local browser runtime selection', () => {
  it('retains the SLAB provider factory', async () => {
    const { createLocalBrowserRuntimeProvider, LocalSlabRuntimeProvider } = await import('./provider.js');
    const provider = createLocalBrowserRuntimeProvider({
      attachProfile: vi.fn().mockResolvedValue(fakeAttachedProfile()),
    });
    expect(provider).toBeInstanceOf(LocalSlabRuntimeProvider);
    await provider.shutdown();
  });

  it('reports disconnected when the native SLAB control endpoint is unavailable', async () => {
    const { createLocalBrowserRuntimeProvider } = await import('./provider.js');
    const provider = createLocalBrowserRuntimeProvider({
      attachProfile: vi.fn().mockResolvedValue(fakeAttachedProfile()),
      statusBridge: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    });

    await expect(provider.status()).resolves.toMatchObject({
      runtimeConnected: false,
      profiles: [],
    });
  });

  it('reports ready from native SLAB hello before the first profile attachment', async () => {
    const { createLocalBrowserRuntimeProvider } = await import('./provider.js');
    const close = vi.fn().mockResolvedValue(undefined);
    const attachProfile = vi.fn().mockResolvedValue(fakeAttachedProfile());
    const provider = createLocalBrowserRuntimeProvider({
      attachProfile,
      statusBridge: vi.fn().mockResolvedValue({
        close,
        hello: vi.fn().mockResolvedValue({
          protocolVersion: 1,
          browserVersion: '152.0.7977.65',
          browserPid: 1234,
          profiles: [{ id: 'default', displayName: 'Default' }],
        }),
      }),
    });

    await expect(provider.status({ contextId: 'default' })).resolves.toMatchObject({
      runtimeConnected: true,
      runtimeVersion: '152.0.7977.65',
      profiles: [{ contextId: 'default', runtimeConnected: true, runtimeVersion: '152.0.7977.65', pending: 0 }],
    });
    expect(close).toHaveBeenCalledOnce();
    expect(attachProfile).not.toHaveBeenCalled();
  });

  it('reports a requested profile as disconnected when no active SLAB profile matches', async () => {
    const { createLocalBrowserRuntimeProvider } = await import('./provider.js');
    const provider = createLocalBrowserRuntimeProvider({
      attachProfile: vi.fn().mockResolvedValue(fakeAttachedProfile()),
      statusBridge: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    });

    await expect(provider.status({ contextId: 'work' })).resolves.toMatchObject({
      runtimeConnected: false,
      profileDisconnected: true,
      profiles: [],
    });
  });
});
