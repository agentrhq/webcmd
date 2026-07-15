import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { BrowserContext, Page as PlaywrightPage } from 'playwright-core';
import { CloakSessionManager } from './session-manager.js';
import { dispatchCloakAction } from './actions.js';

function fakeContext() {
  const listeners = new Map<string, Set<() => void>>();
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue('ok'),
    title: vi.fn().mockResolvedValue('Title'),
    url: vi.fn().mockReturnValue('https://example.com/'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    isClosed: vi.fn().mockReturnValue(false),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    context: {
      on(event: string, listener: () => void) {
        const bucket = listeners.get(event) ?? new Set();
        bucket.add(listener);
        listeners.set(event, bucket);
      },
      emit(event: string) {
        for (const listener of listeners.get(event) ?? []) listener();
      },
      pages: vi.fn().mockReturnValue([page]),
      newPage: vi.fn().mockResolvedValue(page),
      cookies: vi.fn().mockResolvedValue([{ name: 'sid', value: '1', domain: 'example.com', path: '/' }]),
      close: vi.fn().mockResolvedValue(undefined),
    },
    page,
  };
}

function expectedProfileDir(profileId: string): string {
  return path.join('/tmp/webcmd-test', 'cloak', 'profiles', profileId);
}

describe('CloakSessionManager', () => {
  afterEach(() => {
    vi.useRealTimers();
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

    await manager.selectPage({ profileId: 'default', pageId: lease.pageId, windowMode: 'foreground' });

    expect(activateBackgroundContext).toHaveBeenCalledWith(launched.context);
  });

  it('coalesces concurrent persistent context launches for the same profile', async () => {
    const launched = fakeContext();
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
  });

  it('evicts a closed runtime and clears every tracked page resource', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const secondPage = fakeContext().page;
    launched.context.newPage.mockResolvedValue(secondPage);
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
    first.context.newPage.mockImplementation(() => ({
      then(resolve: (page: typeof first.page) => void) {
        resolve(first.page);
        queueMicrotask(() => first.context.emit('close'));
      },
    }));
    const replacement = fakeContext();
    replacement.context.pages.mockReturnValue([]);
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(replacement.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    await manager.getPage({ profileId: 'default', session: 'first', surface: 'browser', idleTimeout: 25 });

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
    const pagesDuringNavigation = await manager.listPages({ profileId: 'default' });
    const pageIdDuringNavigation = manager.pageIdFor(launched.page as unknown as PlaywrightPage);
    const timersDuringNavigation = vi.getTimerCount();
    resolveNavigation();
    const lease = await pendingLease;

    expect(pagesDuringNavigation).toEqual([]);
    expect(pageIdDuringNavigation).toBeUndefined();
    expect(timersDuringNavigation).toBe(0);
    expect(manager.pageIdFor(launched.page as unknown as PlaywrightPage)).toBe(lease.pageId);
    expect(await manager.listPages({ profileId: 'default' })).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not retry or retain a page when navigation fails after creation', async () => {
    const navigationFailure = new Error('Target page, context or browser has been closed');
    const launched = fakeContext();
    launched.page.goto.mockRejectedValue(navigationFailure);
    const launchPersistentContext = vi.fn().mockResolvedValue(launched.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-test', launchPersistentContext });

    await expect(manager.newPage({
      profileId: 'default',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/',
    })).rejects.toBe(navigationFailure);

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    expect(launched.context.newPage).toHaveBeenCalledTimes(1);
    expect(launched.page.goto).toHaveBeenCalledTimes(1);
    expect(launched.page.close).toHaveBeenCalledTimes(1);
    expect(await manager.listPages({ profileId: 'default' })).toEqual([]);
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
    const makePage = () => ({
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue('ok'),
      title: vi.fn().mockResolvedValue('Title'),
      url: vi.fn().mockReturnValue('about:blank'),
      isClosed: vi.fn().mockReturnValue(false),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const openPages: ReturnType<typeof makePage>[] = [];
    const context = {
      on: vi.fn(),
      pages: vi.fn(() => openPages),
      newPage: vi.fn(async () => {
        const page = makePage();
        openPages.push(page);
        return page;
      }),
      cookies: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(context),
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

  it('freshPage never adopts a leftover context tab', async () => {
    const leftover = {
      goto: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const created = {
      goto: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const context = {
      on: vi.fn(),
      pages: vi.fn().mockReturnValue([leftover]),
      newPage: vi.fn().mockResolvedValue(created),
      cookies: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(context),
    });

    const lease = await manager.getPage({ profileId: 'default', session: 'site:district', surface: 'adapter', siteSession: 'persistent', freshPage: true });
    expect(lease.page).toBe(created);
    expect(context.newPage).toHaveBeenCalled();
  });

  it('closes ephemeral adapter sessions when released', async () => {
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const lease = await manager.getPage({ profileId: 'default', session: 'site:x:uuid', surface: 'adapter', siteSession: 'ephemeral' });
    await manager.release({ profileId: 'default', session: 'site:x:uuid', surface: 'adapter' });
    expect(lease.page.close).toHaveBeenCalled();
  });

  it('closes non-persistent leases when their idle timeout expires', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
      launchPersistentContext: vi.fn().mockResolvedValue(launched.context),
    });
    const lease = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser', idleTimeout: 25 });

    await vi.advanceTimersByTimeAsync(24);
    expect(lease.page.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(lease.page.close).toHaveBeenCalled();
    expect(await manager.listPages({ profileId: 'default' })).toEqual([]);
  });

  it('refreshes an idle timeout when a lease is reused', async () => {
    vi.useFakeTimers();
    const launched = fakeContext();
    const manager = new CloakSessionManager({
      baseDir: '/tmp/webcmd-test',
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
    expect(await manager.listPages({ profileId: 'default' })).toHaveLength(1);
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
});
