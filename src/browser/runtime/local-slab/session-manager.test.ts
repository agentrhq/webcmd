import { describe, expect, it, vi } from 'vitest';
import { dispatchSlabAction } from './actions.js';
import { SlabSessionManager } from './session-manager.js';

function fakeAttachedProfile() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const pageListeners = new WeakMap<object, Map<string, Set<(...args: unknown[]) => void>>>();
  const targetIds = new WeakMap<object, string>();
  const windowIds = new Map<string, number>();
  let targetCounter = 0;
  let windowCounter = 0;
  let context: any;

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const makePage = (url = 'about:blank') => {
    let closed = false;
    const page: any = {
      url: vi.fn(() => url),
      title: vi.fn().mockResolvedValue('Page'),
      goto: vi.fn().mockResolvedValue(undefined),
      bringToFront: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn(() => closed),
      opener: vi.fn().mockResolvedValue(null),
      close: vi.fn(async () => {
        closed = true;
        for (const listener of pageListeners.get(page)?.get('close') ?? []) listener();
      }),
      once(event: string, listener: (...args: unknown[]) => void) {
        const bucket = pageListeners.get(page) ?? new Map();
        const once = (...args: unknown[]) => {
          bucket.get(event)?.delete(once);
          listener(...args);
        };
        const handlers = bucket.get(event) ?? new Set();
        handlers.add(once);
        bucket.set(event, handlers);
        pageListeners.set(page, bucket);
      },
    };
    const targetId = `target-${++targetCounter}`;
    targetIds.set(page, targetId);
    windowIds.set(targetId, ++windowCounter);
    return page;
  };

  const humanBlank = makePage();
  const humanPage = makePage('https://human.example/');
  const pages = [humanBlank, humanPage];
  const cdp = {
    send: vi.fn(async (method: string, params?: { targetId?: string }) => {
      if (method === 'Target.createTarget') {
        const page = makePage();
        pages.push(page);
        queueMicrotask(() => emit('page', page));
        return { targetId: targetIds.get(page) };
      }
      if (method === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
      if (method === 'Target.closeTarget') return { success: true };
      return {};
    }),
    on: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    newBrowserCDPSession: vi.fn().mockResolvedValue(cdp),
  };
  context = {
    pages: vi.fn(() => pages.filter(page => !page.isClosed())),
    newPage: vi.fn(async () => {
      const page = makePage();
      pages.push(page);
      return page;
    }),
    newCDPSession: vi.fn(async (page: object) => ({
      send: vi.fn(async (method: string, params?: { targetId?: string }) => {
        if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: targetIds.get(page) } };
        if (method === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
        return {};
      }),
      detach: vi.fn().mockResolvedValue(undefined),
    })),
    browser: vi.fn(() => browser),
    on(event: string, listener: (...args: unknown[]) => void) {
      const bucket = listeners.get(event) ?? new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
  };
  return {
    attachment: {
      profileId: 'default',
      browserVersion: '152.0',
      context,
      browser,
      closeTransport: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
    },
    browser,
    context,
    humanBlank,
    humanPage,
    targetIdFor: (page: object) => targetIds.get(page),
    emitPage: (page: object) => emit('page', page),
    emitClose: () => emit('close'),
  };
}

async function flushPageEvent(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

describe('SlabSessionManager ownership', () => {
  it('creates and releases only an agent-owned page', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };

    const lease = await manager.getPage(input);

    expect(lease.page).not.toBe(attached.humanBlank);
    expect(lease.page).not.toBe(attached.humanPage);
    expect(manager.pageIdFor(attached.humanBlank)).toBeUndefined();
    expect(manager.pageIdFor(attached.humanPage)).toBeUndefined();
    expect(manager.pageIdFor(lease.page)).toBe(lease.pageId);

    await manager.shutdown();
    await manager.shutdown();

    expect(attached.humanBlank.close).not.toHaveBeenCalled();
    expect(attached.humanPage.close).not.toHaveBeenCalled();
    expect(attached.browser.close).not.toHaveBeenCalled();
    expect(attached.attachment.release).toHaveBeenCalledOnce();
  });

  it('registers only an explicitly acquired observed target', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    await manager.getPage(input);

    attached.emitPage(attached.humanPage);
    await flushPageEvent();
    const lease = await manager.bindPage({ ...input, targetId: attached.targetIdFor(attached.humanPage) });

    expect(lease?.page).toBe(attached.humanPage);
    expect(manager.pageIdFor(attached.humanBlank)).toBeUndefined();
    expect(manager.pageIdFor(attached.humanPage)).toBe(lease?.pageId);
  });

  it('reports a detached lease without reopening or closing SLAB', async () => {
    const attached = fakeAttachedProfile();
    const attachProfile = vi.fn().mockResolvedValue(attached.attachment);
    const manager = new SlabSessionManager({ attachProfile });
    const command = {
      id: 'navigate-after-loss',
      action: 'navigate' as const,
      profileId: 'default',
      session: 'agent',
      sessionId: 'agent',
      surface: 'browser' as const,
      url: 'https://example.com/',
    };
    await manager.getPage(command);

    attached.emitClose();
    await flushPageEvent();
    const result = await dispatchSlabAction(manager, command);

    expect(result).toMatchObject({ ok: false, errorCode: 'slab_attachment_lost' });
    expect(attachProfile).toHaveBeenCalledOnce();
    expect(attached.browser.close).not.toHaveBeenCalled();
    expect(attached.attachment.closeTransport).toHaveBeenCalledOnce();
    expect(attached.attachment.release).not.toHaveBeenCalled();

    await expect(manager.getPage({ ...command, session: 'replacement', sessionId: 'replacement' }))
      .resolves.toMatchObject({ profileId: 'default' });
    expect(attachProfile).toHaveBeenCalledTimes(2);
  });
});
