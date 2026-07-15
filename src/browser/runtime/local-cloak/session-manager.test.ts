import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import { CloakSessionManager } from './session-manager.js';
import { dispatchCloakAction } from './actions.js';

function fakeContext() {
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
