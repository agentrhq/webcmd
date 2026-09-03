import { describe, expect, it, vi } from 'vitest';
import { dispatchSlabAction } from './actions.js';
import { SlabSessionManager } from './session-manager.js';
import { humanizePage } from '../../humanizer/page.js';

function fakeAttachedProfile() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const cdpListeners = new Map<string, Set<(...args: any[]) => void>>();
  const pageListeners = new WeakMap<object, Map<string, Set<(...args: unknown[]) => void>>>();
  const targetIds = new WeakMap<object, string>();
  const openerTargetIds = new WeakMap<object, string>();
  const windowIds = new Map<string, number>();
  let targetCounter = 0;
  let windowCounter = 0;
  let beforeTargetCreate: (() => void) | undefined;
  let emitCreatedPageEvents = true;
  const pageCdpSessions = new WeakMap<object, any[]>();
  let context: any;

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const makePage = (url = 'about:blank') => {
    let closed = false;
    const page: any = {
      url: vi.fn(() => url),
      title: vi.fn().mockResolvedValue('Page'),
      context: vi.fn(() => context),
      mainFrame: vi.fn(() => { throw new Error('no frames'); }),
      click: vi.fn(),
      dblclick: vi.fn(),
      hover: vi.fn(),
      type: vi.fn(),
      fill: vi.fn(),
      check: vi.fn(),
      uncheck: vi.fn(),
      selectOption: vi.fn(),
      press: vi.fn(),
      isChecked: vi.fn(),
      $: vi.fn(),
      $$: vi.fn(),
      waitForSelector: vi.fn(),
      mouse: {
        move: vi.fn().mockResolvedValue(undefined),
        click: vi.fn(),
        dblclick: vi.fn(),
        wheel: vi.fn(),
        down: vi.fn(),
        up: vi.fn(),
      },
      keyboard: {
        type: vi.fn(),
        down: vi.fn(),
        up: vi.fn(),
        press: vi.fn(),
        insertText: vi.fn(),
      },
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
      on(event: string, listener: (...args: unknown[]) => void) {
        const bucket = pageListeners.get(page) ?? new Map();
        const handlers = bucket.get(event) ?? new Set();
        handlers.add(listener);
        bucket.set(event, handlers);
        pageListeners.set(page, bucket);
      },
      off(event: string, listener: (...args: unknown[]) => void) {
        pageListeners.get(page)?.get(event)?.delete(listener);
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
      if (method === 'Target.getTargets') {
        return {
          targetInfos: pages.filter(page => !page.isClosed()).map(page => ({
            targetId: targetIds.get(page),
            type: 'page',
            title: 'Page',
            url: page.url(),
            openerId: openerTargetIds.get(page),
          })),
        };
      }
      if (method === 'Target.getTargetInfo') {
        const page = pages.find(candidate => targetIds.get(candidate) === params?.targetId);
        return { targetInfo: { targetId: params?.targetId, openerId: page ? openerTargetIds.get(page) : undefined } };
      }
      if (method === 'Target.createTarget') {
        if (!(params as any)?.hidden) beforeTargetCreate?.();
        const page = makePage();
        pages.push(page);
        if (emitCreatedPageEvents) queueMicrotask(() => emit('page', page));
        return { targetId: targetIds.get(page) };
      }
      if (method === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
      if (method === 'Target.closeTarget') return { success: true };
      return {};
    }),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      const bucket = cdpListeners.get(event) ?? new Set();
      bucket.add(listener);
      cdpListeners.set(event, bucket);
    }),
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
    newCDPSession: vi.fn(async (page: object) => {
      const session = {
      send: vi.fn(async (method: string, params?: { targetId?: string }) => {
        if (method === 'Target.getTargetInfo') {
          return { targetInfo: { targetId: targetIds.get(page), openerId: openerTargetIds.get(page) } };
        }
        if (method === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
        return {};
      }),
      detach: vi.fn().mockResolvedValue(undefined),
      };
      pageCdpSessions.set(page, [...(pageCdpSessions.get(page) ?? []), session]);
      return session;
    }),
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
    moveToWindow: (page: object, windowId: number) => windowIds.set(targetIds.get(page)!, windowId),
    windowIdFor: (page: object) => windowIds.get(targetIds.get(page)!),
    makeCdpOnlyPopup: (opener: object) => {
      const page = makePage();
      pages.push(page);
      openerTargetIds.set(page, targetIds.get(opener)!);
      windowIds.set(targetIds.get(page)!, windowIds.get(targetIds.get(opener)!)!);
      return page;
    },
    makeOpenerlessPage: (url = 'https://new.example/') => {
      const page = makePage(url);
      pages.push(page);
      return page;
    },
    setBeforeTargetCreate: (listener: (() => void) | undefined) => { beforeTargetCreate = listener; },
    setEmitCreatedPageEvents: (value: boolean) => { emitCreatedPageEvents = value; },
    cdpSessionsFor: (page: object) => pageCdpSessions.get(page) ?? [],
    emitPageOnly: (page: object) => emit('page', page),
    emitPage: (page: object) => {
      const targetInfo = {
        targetId: targetIds.get(page),
        type: 'page',
        url: (page as any).url(),
        openerId: openerTargetIds.get(page),
      };
      for (const listener of cdpListeners.get('Target.targetCreated') ?? []) listener({ targetInfo });
      emit('page', page);
    },
    emitClose: () => emit('close'),
  };
}

async function flushPageEvent(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

describe('SlabSessionManager ownership', () => {
  it('discovers unowned human tabs without creating, owning, or humanizing a page', async () => {
    const attached = fakeAttachedProfile();
    attached.moveToWindow(attached.humanBlank, attached.windowIdFor(attached.humanPage)!);
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };

    const tabs = await manager.listPages(input);

    expect(tabs).toHaveLength(2);
    expect(tabs.every(tab => tab.ownership === 'unowned')).toBe(true);
    expect(new Set(tabs.map(tab => tab.window))).toHaveLength(1);
    expect(attached.context.newPage).not.toHaveBeenCalled();
    expect(manager.pageIdFor(attached.humanBlank)).toBeUndefined();
    expect((attached.humanBlank as any)._original).toBeUndefined();
  });

  it('atomically binds every sibling in a human window and detaches without closing it', async () => {
    const attached = fakeAttachedProfile();
    attached.moveToWindow(attached.humanBlank, attached.windowIdFor(attached.humanPage)!);
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const discovered = await manager.listPages(input);

    const lease = await manager.bindPage({ ...input, pageId: discovered[1]!.page });

    expect(lease?.page).toBe(attached.humanPage);
    const bound = await manager.listPages(input);
    expect(bound).toHaveLength(2);
    expect(bound.every(tab => tab.ownership === 'session' && tab.provenance === 'human-adopted')).toBe(true);

    await manager.closeSession('default', 'agent');
    expect(attached.humanBlank.close).not.toHaveBeenCalled();
    expect(attached.humanPage.close).not.toHaveBeenCalled();
    expect((attached.humanBlank as any)._original).toBeUndefined();
    expect((attached.humanPage as any)._original).toBeUndefined();
  });

  it('keeps an adopted window claimed on ordinary lease release and foregrounds only when requested', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const [human] = await manager.listPages(input);
    const lease = await manager.bindPage({ ...input, pageId: human!.page });
    expect(attached.humanBlank.bringToFront).not.toHaveBeenCalled();

    await manager.release(input);
    expect(await manager.listPages(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: lease!.pageId, ownership: 'session', provenance: 'human-adopted' }),
    ]));

    await manager.bindPage({ ...input, pageId: lease!.pageId, windowMode: 'foreground' });
    expect(attached.humanBlank.bringToFront).toHaveBeenCalledOnce();
  });

  it('requires force to destructively close an adopted human tab', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const [human] = await manager.listPages(input);
    const lease = await manager.bindPage({ ...input, pageId: human!.page });

    await expect(manager.closePage({ ...input, pageId: lease!.pageId })).rejects.toMatchObject({
      code: 'ADOPTED_TAB_FORCE_REQUIRED',
    });
    expect(attached.humanBlank.close).not.toHaveBeenCalled();

    await manager.closePage({ ...input, pageId: lease!.pageId, force: true });
    expect(attached.humanBlank.close).toHaveBeenCalledOnce();
  });

  it('runs parallel Sessions in distinct windows and closes only the selected Session', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const a = { profileId: 'default', session: 'agent-a', sessionId: 'agent-a', surface: 'browser' as const };
    const b = { profileId: 'default', session: 'agent-b', sessionId: 'agent-b', surface: 'browser' as const };

    const [first, second] = await Promise.all([manager.getPage(a), manager.getPage(b)]);
    expect(attached.windowIdFor(first.page)).not.toBe(attached.windowIdFor(second.page));

    await manager.closeSession('default', 'agent-a');
    expect(first.page.close).toHaveBeenCalledOnce();
    expect(second.page.close).not.toHaveBeenCalled();
    expect(await manager.listPages(b)).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: second.pageId, ownership: 'session' }),
    ]));
  });

  it('claims a sole blank startup page for the first agent Session and closes it cleanly', async () => {
    const attached = fakeAttachedProfile();
    await attached.humanPage.close();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };

    const lease = await manager.getPage(input);

    expect(lease.page).toBe(attached.humanBlank);
    expect(await manager.listPages(input)).toEqual([
      expect.objectContaining({ page: lease.pageId, ownership: 'session', provenance: 'agent-created' }),
    ]);

    await manager.closeSession('default', 'agent');
    expect(attached.humanBlank.close).toHaveBeenCalledOnce();
    expect(await manager.listPages(input)).toEqual([]);
  });

  it('claims a created target that appears in context pages without a page event', async () => {
    const attached = fakeAttachedProfile();
    attached.setEmitCreatedPageEvents(false);
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };

    const lease = await manager.getPage(input);

    expect(manager.pageIdFor(lease.page)).toBe(lease.pageId);
    expect(await manager.listPages(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: lease.pageId, ownership: 'session' }),
    ]));
  });

  it('returns one discovered Session row per unowned human window', async () => {
    const attached = fakeAttachedProfile();
    attached.moveToWindow(attached.humanBlank, attached.windowIdFor(attached.humanPage)!);
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });

    await expect(manager.discoveredWindows('default')).resolves.toEqual([
      expect.objectContaining({
        rowKind: 'discovered',
        profileId: 'default',
        ownership: 'unowned',
        tabCount: 2,
      }),
    ]);
  });

  it('daemon shutdown detaches an adopted window without closing human tabs', async () => {
    const attached = fakeAttachedProfile();
    attached.moveToWindow(attached.humanBlank, attached.windowIdFor(attached.humanPage)!);
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const [, selected] = await manager.listPages(input);
    await manager.bindPage({ ...input, pageId: selected!.page });

    await manager.shutdown();

    expect(attached.humanBlank.close).not.toHaveBeenCalled();
    expect(attached.humanPage.close).not.toHaveBeenCalled();
    expect(attached.attachment.release).toHaveBeenCalledOnce();
  });

  it('rolls back every sibling and humanizer mutation when whole-window bind instrumentation fails', async () => {
    const attached = fakeAttachedProfile();
    attached.moveToWindow(attached.humanBlank, attached.windowIdFor(attached.humanPage)!);
    let calls = 0;
    const manager = new SlabSessionManager({
      attachProfile: vi.fn().mockResolvedValue(attached.attachment),
      humanize: page => {
        calls += 1;
        if (calls === 2) throw new Error('injected sibling instrumentation failure');
        return humanizePage(page);
      },
    });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const [, selected] = await manager.listPages(input);

    await expect(manager.bindPage({ ...input, pageId: selected!.page }))
      .rejects.toThrow('injected sibling instrumentation failure');

    expect(manager.pageIdFor(attached.humanBlank)).toBeUndefined();
    expect(manager.pageIdFor(attached.humanPage)).toBeUndefined();
    expect((attached.humanBlank as any)._original).toBeUndefined();
    expect((attached.humanPage as any)._original).toBeUndefined();
    expect(attached.humanBlank.close).not.toHaveBeenCalled();
    expect(attached.humanPage.close).not.toHaveBeenCalled();
  });

  it('rejects an already-owned window without creating a session, claim, or humanizer work', async () => {
    const attached = fakeAttachedProfile();
    const humanize = vi.fn(humanizePage);
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment), humanize });
    const a = { profileId: 'default', session: 'a', sessionId: 'a', surface: 'browser' as const };
    const b = { profileId: 'default', session: 'b', sessionId: 'b', surface: 'browser' as const };
    const [human] = await manager.listPages(a);
    await manager.bindPage({ ...a, pageId: human!.page });
    const calls = humanize.mock.calls.length;
    await expect(manager.bindPage({ ...b, targetId: attached.targetIdFor(attached.humanBlank) }))
      .rejects.toMatchObject({ code: 'SESSION_WINDOW_CONFLICT' });
    expect(humanize).toHaveBeenCalledTimes(calls);
    expect(manager.hasSession('default', 'b')).toBe(false);
    expect((await manager.listPages(a)).filter(row => row.ownership === 'session').every(row => row.sessionId === 'a')).toBe(true);
  });

  it('rolls back registered siblings when the selected tab disappears during adoption', async () => {
    const attached = fakeAttachedProfile();
    attached.moveToWindow(attached.humanBlank, attached.windowIdFor(attached.humanPage)!);
    const manager = new SlabSessionManager({
      attachProfile: vi.fn().mockResolvedValue(attached.attachment),
      humanize: page => {
        const humanized = humanizePage(page);
        if (page === attached.humanPage) void attached.humanPage.close();
        return humanized;
      },
    });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const discovered = await manager.listPages(input);
    await expect(manager.bindPage({ ...input, pageId: discovered.find(row => row.targetId === attached.targetIdFor(attached.humanPage))!.page }))
      .rejects.toThrow(/disappeared/);
    expect(manager.hasSession('default', 'agent')).toBe(false);
    expect((attached.humanBlank as any)._original).toBeUndefined();
    expect((await manager.listPages(input)).every(row => row.ownership === 'unowned')).toBe(true);
  });
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
    expect((lease.page as any)._original).toEqual(expect.any(Object));
    expect((attached.humanBlank as any)._original).toBeUndefined();
    expect((attached.humanPage as any)._original).toBeUndefined();

    await manager.shutdown();
    await manager.shutdown();

    expect(attached.humanBlank.close).not.toHaveBeenCalled();
    expect(attached.humanPage.close).not.toHaveBeenCalled();
    expect(attached.browser.close).not.toHaveBeenCalled();
    expect(attached.attachment.release).toHaveBeenCalledOnce();
  });

  it('registers only an explicitly acquired attachment-time target', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    await manager.listPages(input);

    const lease = await manager.bindPage({ ...input, targetId: attached.targetIdFor(attached.humanPage) });

    expect(lease?.page).toBe(attached.humanPage);
    expect(manager.pageIdFor(attached.humanBlank)).toBeUndefined();
    expect(manager.pageIdFor(attached.humanPage)).toBe(lease?.pageId);
    expect((attached.humanPage as any)._original).toEqual(expect.any(Object));
    expect((attached.humanBlank as any)._original).toBeUndefined();
  });

  it('registers a popup from CDP opener identity when Playwright opener is unavailable', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const lease = await manager.getPage(input);
    const scope = await manager.browserRunScope(input, lease.page);
    const seen: object[] = [];
    scope.onPage(page => seen.push(page));

    const popup = attached.makeCdpOnlyPopup(lease.page);
    attached.emitPage(popup);
    await flushPageEvent();

    expect(seen).toEqual([popup]);
    expect(manager.pageIdFor(popup)).toEqual(expect.any(String));
    expect(await manager.listPages(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: manager.pageIdFor(popup), provenance: 'agent-created' }),
    ]));
  });

  it('preserves agent-created provenance when rebinding an already-owned page', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const lease = await manager.getPage(input);

    await manager.bindPage({ ...input, targetId: attached.targetIdFor(lease.page) });

    expect(await manager.listPages(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: lease.pageId, provenance: 'agent-created' }),
    ]));
  });

  it('restores the canonical lease mapping when whole-window bind fails after moving it', async () => {
    const attached = fakeAttachedProfile();
    let failurePage: any;
    const manager = new SlabSessionManager({
      attachProfile: vi.fn().mockResolvedValue(attached.attachment),
      humanize: page => {
        if (page === failurePage) throw new Error('injected rebind failure');
        return humanizePage(page);
      },
    });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const, idleTimeout: 60_000 };
    const original = await manager.getPage(input);
    await (original.page as any)._stealth.getCdpSession();
    const runtime = (manager as any).profiles.get('default');
    const originalEntry = [...runtime.targetPages.values()].find((entry: any) => entry.page === original.page);
    const originalTimer = originalEntry.idleTimer;
    const stealthSession = attached.cdpSessionsFor(original.page).at(-1);
    const sibling = attached.makeOpenerlessPage('https://rebind.example/');
    attached.moveToWindow(sibling, attached.windowIdFor(original.page)!);
    failurePage = sibling;

    await expect(manager.bindPage({ ...input, targetId: attached.targetIdFor(sibling) }))
      .rejects.toThrow('injected rebind failure');

    await expect(manager.findPage(input)).resolves.toMatchObject({ page: original.page, pageId: original.pageId });
    expect(originalEntry.idleTimer).toBeDefined();
    expect(originalEntry.idleTimer).not.toBe(originalTimer);
    expect(stealthSession.detach).not.toHaveBeenCalled();
    expect(manager.pageIdFor(sibling)).toBeUndefined();
    expect((sibling as any)._original).toBeUndefined();
  });

  it('rolls back automatic popup inheritance when instrumentation fails', async () => {
    const attached = fakeAttachedProfile();
    let failurePage: any;
    const manager = new SlabSessionManager({
      attachProfile: vi.fn().mockResolvedValue(attached.attachment),
      humanize: page => {
        if (page === failurePage) throw new Error('popup instrumentation failed');
        return humanizePage(page);
      },
    });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const original = await manager.getPage(input);
    const popup = attached.makeCdpOnlyPopup(original.page);
    failurePage = popup;

    attached.emitPage(popup);
    await flushPageEvent();

    expect(manager.pageIdFor(popup)).toBeUndefined();
    expect((popup as any)._original).toBeUndefined();
    await expect(manager.findPage(input)).resolves.toMatchObject({ page: original.page, pageId: original.pageId });
    await popup.close();
    await expect(manager.findPage(input)).resolves.toMatchObject({ page: original.page, pageId: original.pageId });
  });

  it('inherits adopted Session provenance for an openerless tab in the owned window without observational page CDP', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const [human] = await manager.listPages(input);
    await manager.bindPage({ ...input, pageId: human!.page });
    attached.context.newCDPSession.mockClear();

    const tab = attached.makeOpenerlessPage();
    attached.moveToWindow(tab, attached.windowIdFor(attached.humanBlank)!);
    attached.emitPage(tab);
    await flushPageEvent();

    expect(manager.pageIdFor(tab)).toEqual(expect.any(String));
    expect(await manager.listPages(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: manager.pageIdFor(tab), provenance: 'human-adopted', sessionId: 'agent' }),
    ]));
    expect(attached.cdpSessionsFor(tab)[0].detach).toHaveBeenCalledOnce();
  });

  it('does not attach page CDP while observing an openerless tab in an unowned window', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    await manager.listPages({ profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' });
    attached.context.newCDPSession.mockClear();

    const tab = attached.makeOpenerlessPage('https://unowned.example/');
    attached.emitPage(tab);
    await flushPageEvent();

    expect(manager.pageIdFor(tab)).toBeUndefined();
    expect(attached.cdpSessionsFor(tab)[0].detach).toHaveBeenCalledOnce();
  });

  it('releases pending target page references after correlation and immediately on page close', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    await manager.listPages({ profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' });
    const runtime = (manager as any).profiles.get('default');
    const pending = (manager as any).pendingTargetPages.get(runtime) as Map<string, unknown>;

    const closed = attached.makeOpenerlessPage('https://closed.example/');
    attached.emitPageOnly(closed);
    for (let index = 0; index < 10 && !pending.has(attached.targetIdFor(closed)!); index += 1) {
      await Promise.resolve();
    }
    expect(pending.get(attached.targetIdFor(closed)!)).toBe(closed);
    await closed.close();
    expect(pending.has(attached.targetIdFor(closed)!)).toBe(false);

    const unclaimed = attached.makeOpenerlessPage('https://unclaimed.example/');
    attached.emitPageOnly(unclaimed);
    await flushPageEvent();
    await flushPageEvent();
    expect(pending.has(attached.targetIdFor(unclaimed)!)).toBe(false);
  });

  it('never registers an opener-derived page that opens in a second window for the Session', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const lease = await manager.getPage(input);
    const popup = attached.makeOpenerlessPage();
    popup.opener.mockResolvedValue(lease.page);

    attached.emitPage(popup);
    await flushPageEvent();

    expect(manager.pageIdFor(popup)).toBeUndefined();
    expect((popup as any)._original).toBeUndefined();
    expect((await manager.listPages(input)).filter(row => row.ownership === 'session')).toHaveLength(1);
  });

  it('uses direct target identity to distinguish reversed same-URL openerless page events by window ownership', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    const input = { profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' as const };
    const [human] = await manager.listPages(input);
    await manager.bindPage({ ...input, pageId: human!.page });
    attached.context.newCDPSession.mockClear();
    const owned = attached.makeOpenerlessPage('https://same.example/');
    const unowned = attached.makeOpenerlessPage('https://same.example/');
    attached.moveToWindow(owned, attached.windowIdFor(attached.humanBlank)!);

    attached.emitPageOnly(unowned);
    await Promise.resolve();
    attached.emitPageOnly(owned);
    await flushPageEvent();

    expect(manager.pageIdFor(owned)).toEqual(expect.any(String));
    expect(manager.pageIdFor(unowned)).toBeUndefined();
    expect(attached.cdpSessionsFor(owned)[0].detach).toHaveBeenCalledOnce();
    expect(attached.cdpSessionsFor(unowned)[0].detach).toHaveBeenCalledOnce();
  });

  it('detaches an unrelated human-page probe that arrives during agent target creation without losing its identity', async () => {
    const attached = fakeAttachedProfile();
    const manager = new SlabSessionManager({ attachProfile: vi.fn().mockResolvedValue(attached.attachment) });
    let unrelated: any;
    attached.setBeforeTargetCreate(() => {
      unrelated = attached.makeOpenerlessPage('https://during-create.example/');
      attached.emitPageOnly(unrelated);
      attached.setBeforeTargetCreate(undefined);
    });

    await manager.getPage({ profileId: 'default', session: 'agent', sessionId: 'agent', surface: 'browser' });
    await flushPageEvent();

    expect(manager.pageIdFor(unrelated)).toBeUndefined();
    expect(attached.cdpSessionsFor(unrelated)).toHaveLength(1);
    expect(attached.cdpSessionsFor(unrelated)[0].detach).toHaveBeenCalledOnce();
  });

  it('reports every detached session operation without reopening or closing SLAB', async () => {
    const attached = fakeAttachedProfile();
    const attachProfile = vi.fn().mockResolvedValue(attached.attachment);
    const manager = new SlabSessionManager({ attachProfile });
    const input = {
      profileId: 'default',
      session: 'agent',
      sessionId: 'agent',
      surface: 'browser' as const,
    };
    await manager.getPage(input);

    attached.emitClose();
    await flushPageEvent();
    for (const command of [
      { ...input, id: 'tabs-after-loss', action: 'tabs' as const, op: 'list' as const },
      { ...input, id: 'select-after-loss', action: 'tabs' as const, op: 'select' as const, index: 0 },
      { ...input, id: 'close-after-loss', action: 'tabs' as const, op: 'close' as const, index: 0 },
      { ...input, id: 'release-after-loss', action: 'close-window' as const },
    ]) {
      await expect(dispatchSlabAction(manager, command)).resolves.toMatchObject({
        ok: false,
        errorCode: 'slab_attachment_lost',
      });
    }

    expect(attachProfile).toHaveBeenCalledOnce();
    expect(attached.browser.close).not.toHaveBeenCalled();
    expect(attached.attachment.release).toHaveBeenCalledOnce();

    await expect(manager.getPage({ ...input, session: 'replacement', sessionId: 'replacement' }))
      .resolves.toMatchObject({ profileId: 'default' });
    expect(attachProfile).toHaveBeenCalledTimes(2);
  });
});
