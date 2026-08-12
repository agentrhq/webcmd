import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { BrowserContext, Page as PlaywrightPage } from 'playwright-core';
import { CloakSessionManager, resolveLeaseKey } from './session-manager.js';
import { log } from '../../../logger.js';
import { dispatchCloakAction } from './actions.js';

function fakeContext() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const cdpListeners = new Map<string, Set<(...args: any[]) => void>>();
  const pageListeners = new WeakMap<object, Map<string, Set<(...args: unknown[]) => void>>>();
  const targetIds = new WeakMap<object, string>();
  const windowIds = new Map<string, number>();
  let targetCounter = 0;
  let windowCounter = 0;
  let context: any;
  const emitPageEvent = (page: any, event: string, ...args: unknown[]) => {
    for (const listener of pageListeners.get(page)?.get(event) ?? []) listener(...args);
  };
  const fakePage = (opener?: any, windowId = ++windowCounter) => {
    let closed = false;
    const page: any = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (fn: unknown) => {
        if (typeof fn !== 'function' || !String(fn).includes('window.open')) return 'ok';
        const popup = fakePage(page, windowId);
        allPages.push(popup);
        queueMicrotask(() => {
          emitPageEvent(page, 'popup', popup);
          emit('page', popup);
        });
        return null;
      }),
      title: vi.fn().mockResolvedValue('Title'),
      url: vi.fn().mockReturnValue('https://example.com/'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
      bringToFront: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn(() => closed),
      close: vi.fn(async () => {
        closed = true;
        emitPageEvent(page, 'close');
      }),
      opener: vi.fn().mockResolvedValue(opener ?? null),
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
      waitForEvent(event: string) {
        return new Promise((resolve, reject) => {
          page.once(event, resolve);
          setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), 0);
        });
      },
    };
    const targetId = `target-${++targetCounter}`;
    targetIds.set(page, targetId);
    windowIds.set(targetId, windowId);
    return page;
  };
  const page = fakePage();
  const allPages = [page];
  const backgroundPages: ReturnType<typeof fakePage>[] = [];
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const cdp = {
    send: vi.fn(async (command: string, params?: { targetId?: string; hidden?: boolean }) => {
      if (command === 'Target.createTarget') {
        const backgroundPage = params?.hidden ? fakePage() : await context.newPage();
        if (params?.hidden) allPages.push(backgroundPage);
        backgroundPages.push(backgroundPage);
        queueMicrotask(() => emit('page', backgroundPage));
        return { targetId: targetIds.get(backgroundPage) };
      }
      if (command === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
      if (command === 'Target.closeTarget') return { success: true };
      return {};
    }),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      const bucket = cdpListeners.get(event) ?? new Set();
      bucket.add(listener);
      cdpListeners.set(event, bucket);
    }),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  return {
    context: context = {
      on(event: string, listener: (...args: unknown[]) => void) {
        const bucket = listeners.get(event) ?? new Set();
        bucket.add(listener);
        listeners.set(event, bucket);
      },
      emit,
      waitForEvent(event: string) {
        return new Promise((resolve) => this.on(event, resolve));
      },
      pages: vi.fn(() => allPages.filter((page) => !page.isClosed())),
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
      browser: vi.fn().mockReturnValue({ newBrowserCDPSession: vi.fn().mockResolvedValue(cdp) }),
      cookies: vi.fn().mockResolvedValue([{ name: 'sid', value: '1', domain: 'example.com', path: '/' }]),
      close: vi.fn().mockResolvedValue(undefined),
    },
    page,
    backgroundPages,
    cdp,
    targetIdFor: (target: object) => targetIds.get(target),
    windowIdFor: (target: object) => windowIds.get(targetIds.get(target) ?? ''),
    moveToWindow: (target: object, windowId: number) => windowIds.set(targetIds.get(target)!, windowId),
    emitPage: (target: object) => emit('page', target),
    emitCdp: (event: string, payload: unknown) => {
      for (const listener of cdpListeners.get(event) ?? []) listener(payload);
    },
    pageListenerCount: (target: object, event: string) => pageListeners.get(target)?.get(event)?.size ?? 0,
    makePage: fakePage,
  };
}

function expectedProfileDir(profileId: string): string {
  return path.join('/tmp/webcmd-test', 'cloak', 'profiles', profileId);
}

describe('CloakSessionManager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('launches one persistent context per profile and reuses named sessions', async () => {
    const launched = fakeContext();
    const launchPersistentContext = vi.fn().mockResolvedValue(launched.context);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext,
    });

    const first = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });
    const second = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });

    expect(first.page).toBe(second.page);
    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    expect(launchPersistentContext.mock.calls[0][0]).toMatchObject({ headless: false });
  });

  it('correlates created targets and isolates Sessions into owned windows', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    const first = await manager.getPage({ profileId: 'default', session: 'session_a', sessionId: 'session_a', surface: 'browser' });
    const second = await manager.getPage({ profileId: 'default', session: 'session_b', sessionId: 'session_b', surface: 'browser' });

    expect(launched.cdp.send.mock.calls.filter(([method, params]) => method === 'Target.createTarget' && !(params as { hidden?: boolean })?.hidden))
      .toHaveLength(2);
    expect(launched.windowIdFor(first.page)).not.toBe(launched.windowIdFor(second.page));
    expect((await manager.listPages({ profileId: 'default', session: 'session_a', sessionId: 'session_a' }))
      .map(tab => tab.sessionId)).toEqual(['session_a']);
  });

  it('matches Target.createTarget by target id instead of adopting the next context page', async () => {
    const launched = fakeContext();
    const unrelated = launched.makePage();
    const send = launched.cdp.send.getMockImplementation()!;
    launched.cdp.send.mockImplementationOnce(async (method: string, params: unknown) => {
      launched.emitPage(unrelated);
      return send(method, params as { targetId?: string } | undefined);
    });
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    const lease = await manager.getPage({ profileId: 'default', session: 'session_a', sessionId: 'session_a', surface: 'browser' });

    expect(lease.page).not.toBe(unrelated);
    expect(manager.pageIdFor(unrelated)).toBeUndefined();
    expect(launched.targetIdFor(lease.page)).toEqual(expect.stringMatching(/^target-/));
  });

  it('uses the noopener popup even though window.open returns null and falls back when no popup appears', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const key = { profileId: 'default', session: 'session_a', sessionId: 'session_a', surface: 'browser' as const };
    const first = await manager.getPage(key);

    await manager.newPage(key);
    const evaluate = vi.mocked(first.page.evaluate);
    expect(String(evaluate.mock.calls[0][0])).toContain('noopener');
    expect(launched.context.newCDPSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(launched.cdp.send.mock.calls.filter(([method, params]) => method === 'Target.createTarget' && !(params as { hidden?: boolean })?.hidden)).toHaveLength(1);

    evaluate.mockRejectedValueOnce(new Error('Execution context was destroyed'));
    const afterThrow = await manager.newPage(key);
    evaluate.mockResolvedValueOnce(null);
    const afterNull = await manager.newPage(key);

    expect(launched.cdp.send.mock.calls.filter(([method, params]) => method === 'Target.createTarget' && !(params as { hidden?: boolean })?.hidden)).toHaveLength(3);
    expect(launched.windowIdFor(afterThrow.page)).not.toBe(launched.windowIdFor(first.page));
    expect(launched.windowIdFor(afterNull.page)).not.toBe(launched.windowIdFor(first.page));
    expect((await manager.listPages(key)).every(tab => tab.session === 'session_a')).toBe(true);
  });

  it('times out target correlation and releases the profile creation lock', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const send = launched.cdp.send.getMockImplementation()!;
    launched.cdp.send.mockImplementation(async (method: string, params?: { hidden?: boolean }) => (
      method === 'Target.createTarget' && !params?.hidden
        ? { targetId: 'missing-target' }
        : send(method, params)
    ));
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const key = { profileId: 'default', session: 'session_a', sessionId: 'session_a', surface: 'browser' as const };

    const missing = manager.getPage(key);
    const missingExpectation = expect(missing).rejects.toThrow('Timed out waiting for Cloak target missing-target');
    await vi.waitFor(() => expect(launched.cdp.send).toHaveBeenCalledWith('Target.createTarget', expect.any(Object)));
    await vi.advanceTimersByTimeAsync(1_000);
    await missingExpectation;

    launched.cdp.send.mockImplementation(send);
    const next = manager.getPage(key);
    await vi.runAllTimersAsync();
    await expect(next).resolves.toMatchObject({ pageId: expect.any(String) });
  });

  it('registers a child-window popup under its opener Session', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const key = { profileId: 'default', session: 'session_a', sessionId: 'session_a', surface: 'browser' as const };
    const first = await manager.getPage(key);
    const popup = launched.makePage(first.page, 999);

    launched.emitPage(popup);
    await vi.waitFor(() => expect(manager.pageIdFor(popup)).toEqual(expect.any(String)));

    expect((await manager.listPages(key)).map(tab => tab.session)).toEqual(['session_a', 'session_a']);
    expect(launched.windowIdFor(popup)).toBe(999);
  });

  it('rejects every operation after a Session page moves into another owned window', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const a = { profileId: 'default', session: 'session_a', sessionId: 'session_a', surface: 'browser' as const };
    const b = { profileId: 'default', session: 'session_b', sessionId: 'session_b', surface: 'browser' as const };
    const first = await manager.getPage(a);
    const second = await manager.getPage(b);
    launched.moveToWindow(first.page, launched.windowIdFor(second.page)!);

    await expect(manager.listPages(a)).rejects.toMatchObject({ code: 'SESSION_WINDOW_CONFLICT' });
    await expect(manager.selectPage({ ...a, pageId: first.pageId })).rejects.toMatchObject({ code: 'SESSION_WINDOW_CONFLICT' });
    await expect(manager.bindPage({ ...a, pageId: first.pageId })).rejects.toMatchObject({ code: 'SESSION_WINDOW_CONFLICT' });
    await expect(manager.closePage({ ...a, pageId: first.pageId })).rejects.toMatchObject({ code: 'SESSION_WINDOW_CONFLICT' });
    await expect(manager.closeSession(a.profileId, a.sessionId)).rejects.toMatchObject({ code: 'SESSION_WINDOW_CONFLICT' });
    expect(first.page.close).not.toHaveBeenCalled();
    expect(await manager.findPageById(second.pageId, a)).toBeNull();
  });

  it('does not let another Session bind an owned page moved to an unowned window', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const a = { profileId: 'default', session: 'session_a', sessionId: 'session_a', surface: 'browser' as const };
    const b = { profileId: 'default', session: 'session_b', sessionId: 'session_b', surface: 'browser' as const };
    const first = await manager.getPage(a);
    launched.moveToWindow(first.page, 999);

    await expect(manager.bindPage({ ...b, pageId: first.pageId }))
      .rejects.toMatchObject({ code: 'SESSION_WINDOW_CONFLICT' });
    expect(first.page.close).not.toHaveBeenCalled();
    expect(await manager.listPages(b)).toEqual([]);
    await expect(manager.listPages(a)).rejects.toMatchObject({ code: 'SESSION_WINDOW_CONFLICT' });
  });

  it('checks opener window ownership before calling window.open', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const key = { profileId: 'default', session: 'session_a', sessionId: 'session_a', surface: 'browser' as const };
    const first = await manager.getPage(key);
    launched.moveToWindow(first.page, 999);

    await expect(manager.newPage(key)).rejects.toMatchObject({ code: 'SESSION_WINDOW_CONFLICT' });
    expect(first.page.evaluate).not.toHaveBeenCalled();
    expect(first.page.close).not.toHaveBeenCalled();
  });

  it('binds an unowned context page without adopting another Session page', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    await manager.getPage({ profileId: 'default', session: 'session_a', surface: 'browser' });

    const bound = await manager.bindPage({
      profileId: 'default',
      session: 'session_b',
      surface: 'browser',
      index: 0,
    });

    expect(bound?.page).toBe(launched.page);
    expect((await manager.listPages({ profileId: 'default', session: 'session_b' })).map(tab => tab.id))
      .toEqual([bound?.pageId]);
    expect(await manager.listPages({ profileId: 'default', session: 'session_a' })).toHaveLength(1);
  });

  it.each([
    { platform: 'darwin', windowMode: 'background', backgroundCalls: 1, normalCalls: 0 },
    { platform: 'darwin', windowMode: 'foreground', backgroundCalls: 0, normalCalls: 1 },
    { platform: 'linux', windowMode: 'background', backgroundCalls: 0, normalCalls: 1 },
  ] as const)('routes a cold $platform $windowMode launch', async ({ platform, windowMode, backgroundCalls, normalCalls }) => {
    const launched = fakeContext();
    const launchPersistentContext = vi.fn().mockResolvedValue(launched.context);
    const launchBackgroundPersistentContext = vi.fn().mockResolvedValue(launched.context);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform,
      launchPersistentContext,
      launchBackgroundPersistentContext,
    });

    await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser', windowMode });

    expect(launchBackgroundPersistentContext).toHaveBeenCalledTimes(backgroundCalls);
    expect(launchPersistentContext).toHaveBeenCalledTimes(normalCalls);
  });

  it('reactivates a background-launched context for foreground tab selection', async () => {
    const launched = fakeContext();
    const activateBackgroundContext = vi.fn().mockResolvedValue(undefined);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchBackgroundPersistentContext: vi.fn().mockResolvedValue(launched.context),
      activateBackgroundContext,
    });
    const lease = await manager.getPage({
      profileId: 'default',
      session: 'work',
      surface: 'browser',
      windowMode: 'background',
    });

    await manager.selectPage({ profileId: 'default', session: 'work', surface: 'browser', pageId: lease.pageId, windowMode: 'foreground' });

    expect(activateBackgroundContext).toHaveBeenCalledWith(launched.context);
  });

  it('foregrounds only the selected Session window during handoff', async () => {
    const launched = fakeContext();
    const activateBackgroundContext = vi.fn().mockResolvedValue(undefined);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
      activateBackgroundContext,
    });
    const first = await manager.getPage({ profileId: 'work', session: 'session_a', sessionId: 'session_a', surface: 'adapter' });
    const sibling = await manager.getPage({ profileId: 'work', session: 'session_b', sessionId: 'session_b', surface: 'adapter' });

    await manager.foregroundSession('work', 'session_a');

    expect(first.page.bringToFront).toHaveBeenCalledOnce();
    expect(sibling.page.bringToFront).not.toHaveBeenCalled();
    expect(activateBackgroundContext).toHaveBeenCalledWith(launched.context);
  });

  it('creates a warm background lease tab without focusing Chromium', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    await manager.getPage({ profileId: 'default', session: 'first', surface: 'adapter' });
    await manager.getPage({
      profileId: 'default',
      session: 'second',
      surface: 'adapter',
      windowMode: 'background',
    });

    expect(launched.cdp.send).toHaveBeenCalledWith('Target.createTarget', {
      url: 'about:blank',
      newWindow: true,
      background: true,
      focus: false,
    });
  });

  it('creates an explicit background tab without focusing Chromium', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    await manager.getPage({ profileId: 'default', session: 'first', surface: 'browser' });
    await manager.newPage({
      profileId: 'default',
      session: 'background',
      surface: 'browser',
      windowMode: 'background',
    });

    expect(launched.cdp.send).toHaveBeenCalledWith('Target.createTarget', {
      url: 'about:blank',
      newWindow: true,
      background: true,
      focus: false,
    });
  });

  it('creates an explicit foreground tab in a new CDP window', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    await manager.newPage({
      profileId: 'default',
      session: 'foreground',
      surface: 'browser',
      windowMode: 'foreground',
    });

    expect(launched.cdp.send).toHaveBeenCalledWith('Target.createTarget', {
      url: 'about:blank',
      newWindow: true,
      background: false,
      focus: true,
    });
  });

  it('gives concurrent background tabs distinct pages', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    await manager.getPage({ profileId: 'default', session: 'warm', surface: 'browser' });
    const firstRequest = manager.newPage({
      profileId: 'default',
      session: 'first',
      surface: 'browser',
      windowMode: 'background',
    });
    const secondRequest = manager.newPage({
      profileId: 'default',
      session: 'second',
      surface: 'browser',
      windowMode: 'background',
    });
    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    expect(first.page).not.toBe(second.page);
    expect(launched.backgroundPages.slice(-2)).toEqual([first.page, second.page]);
  });

  it('coalesces concurrent same-lease page acquisition', async () => {
    const launched = fakeContext();
    launched.context.newPage.mockResolvedValue(fakeContext().page);
    let resolveLaunch!: (context: BrowserContext) => void;
    const launchPersistentContext = vi.fn(() => new Promise<BrowserContext>((resolve) => {
      resolveLaunch = resolve;
    }));
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext,
    });

    const firstPage = manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });
    const secondPage = manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });
    await Promise.resolve();

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    resolveLaunch(launched.context as unknown as BrowserContext);
    const [first, second] = await Promise.all([firstPage, secondPage]);

    expect(first.context).toBe(launched.context);
    expect(second.context).toBe(launched.context);
    expect(first.page).toBe(second.page);
    expect(first.pageId).toBe(second.pageId);
    expect(launched.context.newPage).toHaveBeenCalledOnce();
    expect(launched.cdp.send).toHaveBeenCalledWith('Target.createTarget', expect.objectContaining({ newWindow: true }));
  });

  it('evicts a closed runtime and clears every tracked page resource', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const stopCapture = vi.spyOn(manager.networkCapture, 'stop');

    const first = await manager.getPage({ profileId: 'default', session: 'one', surface: 'browser', idleTimeout: 25 });
    const second = await manager.newPage({ profileId: 'default', session: 'two', surface: 'browser', idleTimeout: 25 });
    expect(manager.activeProfileIds()).toEqual(['default']);
    expect(vi.getTimerCount()).toBe(2);

    launched.context.emit('close');

    expect(manager.activeProfileIds()).toEqual([]);
    expect(manager.profileStatuses()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(stopCapture).toHaveBeenCalledTimes(2);
    expect(stopCapture).toHaveBeenCalledWith(first.page);
    expect(stopCapture).toHaveBeenCalledWith(second.page);
    await vi.advanceTimersByTimeAsync(25);
    expect(first.page.close).not.toHaveBeenCalled();
    expect(second.page.close).not.toHaveBeenCalled();
  });

  it('does not let a late close from an old runtime evict its replacement', async () => {
    const first = fakeContext();
    const replacement = fakeContext();
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(replacement.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    await manager.getPage({ profileId: 'default', session: 'first', surface: 'browser' });
    first.context.emit('close');
    const replacementLease = await manager.getPage({ profileId: 'default', session: 'replacement', surface: 'browser' });

    first.context.emit('close');

    expect(manager.activeProfileIds()).toEqual(['default']);
    expect(manager.profileStatuses()).toHaveLength(1);
    expect((await manager.getPage({ profileId: 'default', session: 'replacement', surface: 'browser' })).context)
      .toBe(replacementLease.context);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous replacement launches after a context closes', async () => {
    const first = fakeContext();
    const replacement = fakeContext();
    let resolveReplacement!: (context: BrowserContext) => void;
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockImplementationOnce(() => new Promise<BrowserContext>((resolve) => {
        resolveReplacement = resolve;
      }));
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });
    await manager.getPage({ profileId: 'default', session: 'first', surface: 'browser' });
    first.context.emit('close');

    const one = manager.getPage({ profileId: 'default', session: 'one', surface: 'browser' });
    const two = manager.getPage({ profileId: 'default', session: 'two', surface: 'browser' });
    await Promise.resolve();

    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
    resolveReplacement(replacement.context as unknown as BrowserContext);
    const leases = await Promise.all([one, two]);
    expect(leases[0].context).toBe(replacement.context);
    expect(leases[1].context).toBe(replacement.context);
  });

  it('discards a page created after its runtime closes and defers recovery to the next command', async () => {
    const first = fakeContext();
    first.context.pages.mockReturnValue([]);
    let resolveFirstPage!: (page: typeof first.page) => void;
    let markPageCreationStarted!: () => void;
    const pageCreationStarted = new Promise<void>((resolve) => {
      markPageCreationStarted = resolve;
    });
    first.context.newPage.mockImplementation(() => {
      markPageCreationStarted();
      return new Promise<typeof first.page>((resolve) => {
        resolveFirstPage = resolve;
      });
    });
    const replacement = fakeContext();
    replacement.context.pages.mockReturnValue([]);
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(replacement.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    const pendingLease = manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });
    await pageCreationStarted;
    first.context.emit('close');
    resolveFirstPage(first.page);

    await expect(pendingLease).rejects.toThrow('Target page, context or browser has been closed');
    expect(first.page.close).toHaveBeenCalled();
    expect(manager.activeProfileIds()).toEqual([]);
    expect(launchPersistentContext).toHaveBeenCalledTimes(1);

    const lease = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });
    expect(lease.context).toBe(replacement.context);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('does not publish an orphaned page after acquisition validation', async () => {
    vi.useFakeTimers();
    const first = fakeContext();
    first.context.pages.mockReturnValue([]);
    first.context.newPage.mockImplementation(() => {
      queueMicrotask(() => first.context.emit('close'));
      return Promise.resolve(first.page);
    });
    const replacement = fakeContext();
    replacement.context.pages.mockReturnValue([]);
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(replacement.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    await expect(manager.getPage({ profileId: 'default', session: 'first', surface: 'browser', idleTimeout: 25 }))
      .rejects.toThrow('Target page, context or browser has been closed');

    expect(manager.activeProfileIds()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    const lease = await manager.getPage({ profileId: 'default', session: 'replacement', surface: 'browser' });
    expect(lease.context).toBe(replacement.context);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('retries getPage page creation once after a closed-context failure', async () => {
    const closed = new Error('Target page, context or browser has been closed');
    const first = fakeContext();
    first.context.pages.mockReturnValue([]);
    first.context.newPage.mockRejectedValue(closed);
    const replacement = fakeContext();
    replacement.context.pages.mockReturnValue([]);
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(replacement.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    const lease = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });

    expect(lease.context).toBe(replacement.context);
    expect(first.context.newPage).toHaveBeenCalledTimes(1);
    expect(replacement.context.newPage).toHaveBeenCalledTimes(1);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('retries explicit newPage page creation once after a closed-context failure', async () => {
    const closed = new Error('browserContext.newPage: Target page, context or browser has been closed');
    const first = fakeContext();
    first.context.newPage.mockRejectedValue(closed);
    const replacement = fakeContext();
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(replacement.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    const lease = await manager.newPage({ profileId: 'default', session: 'work', surface: 'browser' });

    expect(lease.context).toBe(replacement.context);
    expect(first.context.newPage).toHaveBeenCalledTimes(1);
    expect(replacement.context.newPage).toHaveBeenCalledTimes(1);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('returns the second closed-context page creation failure without looping', async () => {
    const firstFailure = new Error('Target page, context or browser has been closed');
    const secondFailure = new Error('Target page, context or browser has been closed again');
    const first = fakeContext();
    first.context.newPage.mockRejectedValue(firstFailure);
    const replacement = fakeContext();
    replacement.context.newPage.mockRejectedValue(secondFailure);
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(replacement.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    await expect(manager.newPage({ profileId: 'default', session: 'work', surface: 'browser' }))
      .rejects.toBe(secondFailure);
    expect(first.context.newPage).toHaveBeenCalledTimes(1);
    expect(replacement.context.newPage).toHaveBeenCalledTimes(1);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('keeps an explicitly navigated page untracked until navigation succeeds', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    let resolveNavigation!: () => void;
    let markNavigationStarted!: () => void;
    const navigationStarted = new Promise<void>((resolve) => {
      markNavigationStarted = resolve;
    });
    launched.page.goto.mockImplementation(() => {
      markNavigationStarted();
      return new Promise<void>((resolve) => {
        resolveNavigation = resolve;
      });
    });
    launched.context.newPage.mockResolvedValue(launched.page);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    const pendingLease = manager.newPage({
      profileId: 'default',
      session: 'work',
      surface: 'browser',
      idleTimeout: 25,
      url: 'https://example.com/',
    });
    await navigationStarted;
    const pagesDuringNavigation = await manager.listPages({ profileId: 'default', session: 'work' });
    const pageIdDuringNavigation = manager.pageIdFor(launched.page as unknown as PlaywrightPage);
    const timersDuringNavigation = vi.getTimerCount();
    resolveNavigation();
    const lease = await pendingLease;

    expect(pagesDuringNavigation).toEqual([]);
    expect(pageIdDuringNavigation).toBeUndefined();
    expect(timersDuringNavigation).toBe(0);
    expect(manager.pageIdFor(launched.page as unknown as PlaywrightPage)).toBe(lease.pageId);
    expect(await manager.listPages({ profileId: 'default', session: 'work' })).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not retry or retain a page when navigation fails after creation', async () => {
    const navigationFailure = new Error('Target page, context or browser has been closed');
    const launched = fakeContext();
    launched.page.goto.mockRejectedValue(navigationFailure);
    launched.context.newPage.mockResolvedValue(launched.page);
    const launchPersistentContext = vi.fn().mockResolvedValue(launched.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    await expect(manager.newPage({
      profileId: 'default',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/',
    })).rejects.toBe(navigationFailure);

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    expect(launched.page.goto).toHaveBeenCalledTimes(1);
    expect(launched.page.close).toHaveBeenCalledTimes(1);
    expect(await manager.listPages({ profileId: 'default', session: 'work' })).toEqual([]);
  });

  it('clears a stale Cloak profile owner and retries when Chromium reports an existing session', async () => {
    const launched = fakeContext();
    const launchPersistentContext = vi.fn()
      .mockRejectedValueOnce(new Error('browserType.launchPersistentContext: Opening in existing browser session.'))
      .mockResolvedValueOnce(launched.context);
    const recoverLockedProfile = vi.fn().mockResolvedValue(true);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext,
      recoverLockedProfile,
    });

    const lease = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });

    expect(lease.context).toBe(launched.context);
    expect(recoverLockedProfile).toHaveBeenCalledWith(expectedProfileDir('default'));
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('freshPage closes the existing persistent lease page and creates a new one', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const key = { profileId: 'default', session: 'site:district', surface: 'adapter' as const, siteSession: 'persistent' as const };

    const first = await manager.getPage(key);
    expect((await manager.getPage(key)).page).toBe(first.page);

    const fresh = await manager.getPage({ ...key, freshPage: true });
    expect(first.page.close).toHaveBeenCalled();
    expect(fresh.page).not.toBe(first.page);

    const reused = await manager.getPage(key);
    expect(reused.page).toBe(fresh.page);
  });

  it('keeps persistent adapter pages separate by Session and site', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const base = {
      profileId: 'default',
      session: 'session_a',
      sessionId: 'session_a',
      surface: 'adapter' as const,
      siteSession: 'persistent' as const,
    };

    const githubA = await manager.getPage({ ...base, adapterSite: 'github' });
    const linkedinA = await manager.getPage({ ...base, adapterSite: 'linkedin' });
    const githubB = await manager.getPage({ ...base, session: 'session_b', sessionId: 'session_b', adapterSite: 'github' });

    expect(linkedinA.page).not.toBe(githubA.page);
    expect(githubB.page).not.toBe(githubA.page);
    expect((await manager.getPage({ ...base, adapterSite: 'github' })).page).toBe(githubA.page);
  });

  it('keys ephemeral adapter pages by Session, site, and run', () => {
    const base = {
      session: 'session_a',
      sessionId: 'session_a',
      surface: 'adapter' as const,
      siteSession: 'ephemeral' as const,
    };

    expect(resolveLeaseKey({ ...base, adapterSite: 'github', runId: 'run_a' }))
      .toBe('session_a\0ephemeral:github:run_a');
    expect(resolveLeaseKey({ ...base, adapterSite: 'linkedin', runId: 'run_a' }))
      .not.toBe(resolveLeaseKey({ ...base, adapterSite: 'github', runId: 'run_a' }));
    expect(resolveLeaseKey({ ...base, adapterSite: 'github', runId: 'run_b' }))
      .not.toBe(resolveLeaseKey({ ...base, adapterSite: 'github', runId: 'run_a' }));
  });

  it('freshPage never adopts a leftover context tab', async () => {
    const launched = fakeContext();
    const leftover = launched.page;
    const created = fakeContext().page;
    launched.context.newPage.mockResolvedValue(created);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    const lease = await manager.getPage({ profileId: 'default', session: 'site:district', surface: 'adapter', siteSession: 'persistent', freshPage: true });
    expect(lease.page).toBe(created);
    expect(lease.page).not.toBe(leftover);
  });

  it('closes ephemeral adapter sessions when released', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const key = { profileId: 'default', session: 'session_default', sessionId: 'session_default', surface: 'adapter' as const, siteSession: 'ephemeral' as const, adapterSite: 'github', runId: 'run_a' };
    const lease = await manager.getPage(key);
    await manager.release(key);
    expect(lease.page.close).toHaveBeenCalled();
  });

  it('releases only the owning ephemeral adapter site and run', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const base = { profileId: 'default', session: 'session_default', sessionId: 'session_default', surface: 'adapter' as const, siteSession: 'ephemeral' as const };
    const github = { ...base, adapterSite: 'github', runId: 'run_a' };
    const linkedin = { ...base, adapterSite: 'linkedin', runId: 'run_b' };
    const githubLease = await manager.getPage(github);
    const linkedinLease = await manager.getPage(linkedin);

    await manager.release(github);

    expect(githubLease.page.close).toHaveBeenCalledOnce();
    expect(linkedinLease.page.close).not.toHaveBeenCalled();
    expect((await manager.getPage(linkedin)).page).toBe(linkedinLease.page);
  });

  it('keeps persistent adapter pages tracked when release is requested', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const key = { profileId: 'default', session: 'session_default', sessionId: 'session_default', surface: 'adapter' as const, siteSession: 'persistent' as const, adapterSite: 'github', runId: 'run_a' };
    const lease = await manager.getPage(key);

    await manager.release(key);

    expect(lease.page.close).not.toHaveBeenCalled();
    await expect(manager.listPages(key)).resolves.toHaveLength(1);
    expect((await manager.getPage(key)).page).toBe(lease.page);
  });

  it('closes non-persistent leases when their idle timeout expires', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const lease = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser', idleTimeout: 25 });

    await vi.advanceTimersByTimeAsync(24);
    expect(lease.page.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(lease.page.close).toHaveBeenCalled();
    expect(await manager.listPages({ profileId: 'default', session: 'work' })).toEqual([]);
  });

  it('refreshes an idle timeout when a lease is reused', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const first = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser', idleTimeout: 25 });

    await vi.advanceTimersByTimeAsync(20);
    const second = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser', idleTimeout: 25 });
    expect(second.page).toBe(first.page);
    await vi.advanceTimersByTimeAsync(20);
    expect(first.page.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5);
    expect(first.page.close).toHaveBeenCalled();
  });

  it('does not close persistent site sessions when their idle timeout expires', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const lease = await manager.getPage({ profileId: 'default', session: 'site:x:uuid', surface: 'adapter', siteSession: 'persistent', idleTimeout: 25 });

    await vi.advanceTimersByTimeAsync(25);

    expect(lease.page.close).not.toHaveBeenCalled();
    expect(await manager.listPages({ profileId: 'default', session: 'site:x:uuid' })).toHaveLength(1);
  });

  it('launches a preferred profile when no Cloak profile is active', async () => {
    const launched = fakeContext();
    const launchPersistentContext = vi.fn().mockResolvedValue(launched.context);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext,
    });

    await dispatchCloakAction(manager, {
      id: 'cmd-preferred',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/',
      preferredContextId: 'profile-default',
    });

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    expect(launchPersistentContext.mock.calls[0][0].userDataDir).toBe(expectedProfileDir('profile-default'));
  });

  it('falls back to the only active profile when the preferred profile is stale', async () => {
    const launched = fakeContext();
    const launchPersistentContext = vi.fn().mockResolvedValue(launched.context);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext,
    });

    await dispatchCloakAction(manager, {
      id: 'cmd-active',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/',
      contextId: 'active',
    });
    await dispatchCloakAction(manager, {
      id: 'cmd-stale-default',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/next',
      preferredContextId: 'stale-default',
    });

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    expect(launchPersistentContext.mock.calls[0][0].userDataDir).toBe(expectedProfileDir('active'));
  });

  it('asks for an explicit profile when a stale preferred profile meets multiple active profiles', async () => {
    const launched = fakeContext();
    const launchPersistentContext = vi.fn().mockResolvedValue(launched.context);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext,
    });

    await dispatchCloakAction(manager, {
      id: 'cmd-a',
      action: 'navigate',
      session: 'work-a',
      surface: 'browser',
      url: 'https://example.com/a',
      contextId: 'profile-a',
    });
    await dispatchCloakAction(manager, {
      id: 'cmd-b',
      action: 'navigate',
      session: 'work-b',
      surface: 'browser',
      url: 'https://example.com/b',
      contextId: 'profile-b',
    });

    const result = await dispatchCloakAction(manager, {
      id: 'cmd-stale',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/',
      preferredContextId: 'stale-default',
    });

    expect(result).toMatchObject({
      id: 'cmd-stale',
      ok: false,
      errorCode: 'profile_required',
    });
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('does not publish a runtime until its hidden keeper exists', async () => {
    const launched = fakeContext();
    const send = launched.cdp.send.getMockImplementation()!;
    let resolveAnchor!: () => void;
    launched.cdp.send.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAnchor = () => resolve({ targetId: 'anchor-target' });
    }));
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    const pending = manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    await vi.waitFor(() => expect(launched.cdp.send).toHaveBeenCalledWith('Target.createTarget', {
      url: 'about:blank',
      hidden: true,
      background: true,
    }));
    expect(manager.activeProfileIds()).toEqual([]);

    resolveAnchor();
    launched.cdp.send.mockImplementation(send);
    await pending;
    expect(manager.activeProfileIds()).toEqual(['work']);
  });

  it('keeps an empty profile warm for sixty seconds before closing it', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'linux',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    await manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    await manager.closeSession('work', 'session_a');

    await vi.advanceTimersByTimeAsync(59_999);
    expect(manager.activeProfileIds()).toEqual(['work']);
    expect(launched.context.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(manager.activeProfileIds()).toEqual([]);
    expect(launched.context.close).toHaveBeenCalledOnce();
  });

  it('fences a launch that finishes after shutdown starts', async () => {
    const launched = fakeContext();
    let resolveLaunch!: (context: BrowserContext) => void;
    const launchPersistentContext = vi.fn(() => new Promise<BrowserContext>((resolve) => {
      resolveLaunch = resolve;
    }));
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    const pending = manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    await vi.waitFor(() => expect(launchPersistentContext).toHaveBeenCalledOnce());
    const shutdown = manager.shutdown();
    resolveLaunch(launched.context as unknown as BrowserContext);

    await shutdown;
    await expect(pending).rejects.toMatchObject({ code: 'DAEMON_SHUTTING_DOWN' });
    expect(launched.context.close).toHaveBeenCalledOnce();
    expect(manager.activeProfileIds()).toEqual([]);
    await expect(manager.getPage({ profileId: 'work', session: 'session_b', surface: 'browser' }))
      .rejects.toMatchObject({ code: 'DAEMON_SHUTTING_DOWN' });
    expect(launchPersistentContext).toHaveBeenCalledOnce();
  });

  it('falls back to a parking keeper when macOS rejects the hidden target', async () => {
    const launched = fakeContext();
    const send = launched.cdp.send.getMockImplementation()!;
    launched.cdp.send.mockImplementation((method: string, params?: { hidden?: boolean }) => (
      method === 'Target.createTarget' && params?.hidden
        ? Promise.reject(new Error('hidden targets unsupported'))
        : send(method, params)
    ));
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    const lease = await manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    await manager.closeSession('work', 'session_a');

    expect(manager.activeProfileIds()).toEqual(['work']);
    expect(lease.page.goto).toHaveBeenLastCalledWith('about:blank', { waitUntil: 'load' });
    expect(lease.page.close).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(launched.cdp.detach).not.toHaveBeenCalled();
    await manager.shutdown();
    expect(launched.cdp.detach).toHaveBeenCalledOnce();
  });

  it('uses a parking keeper when the persistent context exposes no browser', async () => {
    const launched = fakeContext();
    launched.context.browser.mockReturnValue(null);
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });

    const lease = await manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    expect(lease.context).toBe(launched.context);
    expect(manager.activeProfileIds()).toEqual(['work']);
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each(['linux', 'win32'] as const)('reuses a warm %s profile and replaces its parking page on the next Session', async (platform) => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const launchPersistentContext = vi.fn().mockResolvedValue(launched.context);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform,
      launchPersistentContext,
    });
    const first = await manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    await manager.closeSession('work', 'session_a');
    await vi.advanceTimersByTimeAsync(59_999);

    const second = await manager.runWithProfileActivity('work', () => (
      manager.getPage({ profileId: 'work', session: 'session_b', surface: 'browser' })
    ));

    expect(second.context).toBe(first.context);
    expect(second.page).not.toBe(first.page);
    expect(first.page.close).toHaveBeenCalledOnce();
    expect(await manager.listPages({ profileId: 'work', session: 'session_a' })).toEqual([]);
    expect(await manager.listPages({ profileId: 'work', session: 'session_b' })).toHaveLength(1);
    expect(launchPersistentContext).toHaveBeenCalledOnce();
  });

  it('rechecks an empty profile after its active handoff expires', async () => {
    vi.useFakeTimers();
    let handoffActive = true;
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
      hasActiveHandoff: () => handoffActive,
    });
    await manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    await manager.closeSession('work', 'session_a');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(manager.activeProfileIds()).toEqual(['work']);
    handoffActive = false;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(manager.activeProfileIds()).toEqual(['work']);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(manager.activeProfileIds()).toEqual([]);
    expect(launched.context.close).toHaveBeenCalledOnce();
  });

  it('starts a fresh idle grace when handoff expiry is observed near a wakeup boundary', async () => {
    vi.useFakeTimers();
    let handoffActive = true;
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
      hasActiveHandoff: () => handoffActive,
    });
    await manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    await manager.closeSession('work', 'session_a');

    await vi.advanceTimersByTimeAsync(119_999);
    handoffActive = false;
    await vi.advanceTimersByTimeAsync(1);
    expect(manager.activeProfileIds()).toEqual(['work']);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(manager.activeProfileIds()).toEqual(['work']);
    await vi.advanceTimersByTimeAsync(1);

    expect(manager.activeProfileIds()).toEqual([]);
    expect(launched.context.close).toHaveBeenCalledOnce();
  });

  it('unrefs the profile idle timer', async () => {
    const timer = setTimeout(() => {}, 0);
    const unref = vi.spyOn(Object.getPrototypeOf(timer), 'unref');
    clearTimeout(timer);
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    await manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });

    await manager.closeSession('work', 'session_a');

    expect(unref).toHaveBeenCalled();
    await manager.shutdown();
  });

  it('repairs one anchor for duplicate destruction and page-close notifications', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'darwin',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    await manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    const anchor = launched.backgroundPages[0];
    const anchorTargetId = launched.targetIdFor(anchor)!;
    launched.emitPage(anchor);
    await vi.waitFor(() => expect(launched.pageListenerCount(anchor, 'close')).toBeGreaterThan(0));

    launched.emitCdp('Target.targetDestroyed', { targetId: anchorTargetId });
    await anchor.close();
    await vi.waitFor(() => expect(launched.cdp.send.mock.calls.filter(([, params]) => (
      (params as { hidden?: boolean })?.hidden
    ))).toHaveLength(2));
    await Promise.resolve();

    expect(launched.cdp.send.mock.calls.filter(([, params]) => (
      (params as { hidden?: boolean })?.hidden
    ))).toHaveLength(2);
  });

  it('recovers one timed-out idle close before launching one replacement', async () => {
    vi.useFakeTimers();
    const first = fakeContext();
    first.context.close.mockImplementation(() => new Promise(() => {}));
    const replacement = fakeContext();
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(replacement.context);
    const recoverLockedProfile = vi.fn().mockResolvedValue(true);
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      platform: 'linux',
      launchPersistentContext,
      recoverLockedProfile,
    });
    await manager.getPage({ profileId: 'work', session: 'session_a', surface: 'browser' });
    await manager.closeSession('work', 'session_a');
    await vi.advanceTimersByTimeAsync(60_000);

    const one = manager.getPage({ profileId: 'work', session: 'session_b', surface: 'browser' });
    const two = manager.getPage({ profileId: 'work', session: 'session_c', surface: 'browser' });
    await vi.advanceTimersByTimeAsync(3_000);
    const leases = await Promise.all([one, two]);

    expect(recoverLockedProfile).toHaveBeenCalledOnce();
    expect(leases[0].context).toBe(replacement.context);
    expect(leases[1].context).toBe(replacement.context);
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });
});
