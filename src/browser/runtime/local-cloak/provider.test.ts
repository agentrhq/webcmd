import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalCloakRuntimeProvider } from './provider.js';
import { LocalBrowserSessionStore } from '../../sessions.js';
import { BrowserRunError } from '../../run/types.js';

const runBrowserProgram = vi.hoisted(() => vi.fn());

vi.mock('../../run/runner.js', () => ({
  runBrowserProgram,
}));

function runOutput(result: unknown) {
  return {
    ok: true as const,
    result,
    logs: [],
    page: { id: 'page-1', url: '', title: '' },
    artifacts: [],
    warnings: [],
    limits: { outputTruncated: false, snapshotTruncated: false },
  };
}

function fakePage(url: string, initialViewport: { width: number; height: number } | null = { width: 1280, height: 720 }, opener: object | null = null) {
  let closed = false;
  let viewportSize = initialViewport;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const page = {
    isClosed: vi.fn(() => closed),
    goto: vi.fn(async (nextUrl: string) => {
      url = nextUrl;
    }),
    evaluate: vi.fn().mockResolvedValue({ ok: true }),
    frames: vi.fn((): unknown[] => []),
    title: vi.fn().mockResolvedValue('Example'),
    url: vi.fn(() => url),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('image')),
    viewportSize: vi.fn(() => viewportSize),
    setViewportSize: vi.fn(async (size: { width: number; height: number }) => {
      viewportSize = size;
    }),
    locator: vi.fn(),
    waitForEvent: vi.fn(),
    opener: vi.fn().mockResolvedValue(opener),
    on(event: string, listener: (...args: unknown[]) => void) {
      const bucket = listeners.get(event) ?? new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      const once = (...args: unknown[]) => {
        page.off(event, once);
        listener(...args);
      };
      page.on(event, once);
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
    bringToFront: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockImplementation(async () => {
      closed = true;
      for (const listener of listeners.get('close') ?? []) listener();
    }),
  };
  return page;
}

function makeProviderWithFakePage(initialViewport: { width: number; height: number } | null = { width: 1280, height: 720 }) {
  const pages = [fakePage('https://example.com/', initialViewport)];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const targetIds = new WeakMap<object, string>();
  const windowIds = new Map<string, number>();
  let targetCounter = 0;
  let windowCounter = 0;
  const assignTarget = (page: object) => {
    const targetId = `target-${++targetCounter}`;
    targetIds.set(page, targetId);
    windowIds.set(targetId, ++windowCounter);
    return targetId;
  };
  assignTarget(pages[0]);
  const cdpSession = { send: vi.fn(), detach: vi.fn().mockResolvedValue(undefined) };
  const pageCdpSessions: { send: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> }[] = [];
  const browser = { contexts: vi.fn(() => [context]), newBrowserCDPSession: vi.fn().mockResolvedValue(cdpSession) };
  const context = {
    browser: vi.fn(() => browser),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const bucket = listeners.get(event) ?? new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    waitForEvent: vi.fn((event: string) => new Promise((resolve) => context.on(event, resolve))),
    pages: vi.fn(() => pages.filter((page) => !page.isClosed())),
    newPage: vi.fn(async () => {
      const page = fakePage('about:blank');
      pages.push(page);
      assignTarget(page);
      return page;
    }),
    newCDPSession: vi.fn(async (target: object) => {
      const pageSession = {
        send: vi.fn(async (command: string, params?: unknown) => {
        if (params === undefined) cdpSession.send(command);
        else cdpSession.send(command, params);
        if (command === 'Target.getTargetInfo') return { targetInfo: { targetId: targetIds.get(target) } };
        return {};
        }),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      pageCdpSessions.push(pageSession);
      return pageSession;
    }),
    cookies: vi.fn().mockResolvedValue([{ name: 'sid', value: '1', domain: 'example.com', path: '/' }]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  let usedInitialPage = false;
  cdpSession.send.mockImplementation(async (command: string, params?: { targetId?: string; hidden?: boolean }) => {
    if (command === 'Target.createTarget') {
      const page = params?.hidden ? fakePage('about:blank') : usedInitialPage ? await context.newPage() : pages[0];
      if (params?.hidden) {
        pages.push(page);
        assignTarget(page);
      } else {
        usedInitialPage = true;
      }
      queueMicrotask(() => emit('page', page));
      return { targetId: targetIds.get(page) };
    }
    if (command === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
    if (command === 'Target.closeTarget') return { success: true };
    return {};
  });
  const provider = new LocalCloakRuntimeProvider({
    baseDir: '/tmp/webcmd-test',
    launchPersistentContext: vi.fn().mockResolvedValue(context),
    // Commands now default to background, which routes a darwin launch through
    // the background launcher; the fake context stands in for both.
    launchBackgroundPersistentContext: vi.fn().mockResolvedValue(context),
  });
  return { provider, browser, page: pages[0], pages, context, cdpSession, pageCdpSessions };
}

describe('LocalCloakRuntimeProvider', () => {
  beforeEach(() => {
    runBrowserProgram.mockReset();
  });

  it('reports a runtime-named connected status before any profile launches', async () => {
    const provider = new LocalCloakRuntimeProvider({ baseDir: '/tmp/webcmd-test' });
    await expect(provider.status()).resolves.toMatchObject({
      runtimeConnected: true,
      runtimeName: 'cloak',
      profiles: [],
      pending: 0,
    });
  });

  it('discards a temporary Session record after closing it', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-provider-session-'));
    try {
      const provider = new LocalCloakRuntimeProvider({ baseDir });
      const session = await provider.createSession({
        id: 'create-doctor-session',
        action: 'session-create',
        contextId: 'default',
        sessionName: 'doctor',
      });

      await provider.closeSession({
        id: 'close-doctor-session',
        action: 'session-close',
        contextId: 'default',
        session: session.id,
        surface: 'browser',
        force: true,
        discard: true,
      });

      await expect(provider.listSessions({ profileId: 'default' })).resolves.toEqual([]);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('passes a readable Session name to the profile-scoped store', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-provider-session-'));
    const create = vi.spyOn(LocalBrowserSessionStore.prototype, 'create');
    try {
      const provider = new LocalCloakRuntimeProvider({ baseDir });
      const session = await provider.createSession({
        id: 'create-work-project',
        action: 'session-create',
        contextId: 'profile-a',
        sessionName: 'Work Project',
      });

      expect(create).toHaveBeenCalledWith('profile-a', 'Work Project');
      expect(session).toMatchObject({ profileId: 'profile-a', id: expect.stringMatching(/^work-project-[23456789abcdefghijkmnpqrstuvwxyz]{2}$/) });
    } finally {
      create.mockRestore();
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('resolves an omitted adapter --session as adapter-default', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-provider-session-'));
    try {
      const provider = new LocalCloakRuntimeProvider({ baseDir });
      await expect(provider.resolveAdapterDefault({
        id: 'adapter-default',
        action: 'exec',
        contextId: 'profile-a',
        surface: 'adapter',
      })).resolves.toMatchObject({ id: 'adapter-default', profileId: 'profile-a', kind: 'adapter-default' });
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('does not discard a Session record unless close is forced', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-provider-session-'));
    try {
      const provider = new LocalCloakRuntimeProvider({ baseDir });
      const session = await provider.createSession({
        id: 'create-user-session',
        action: 'session-create',
        contextId: 'default',
        sessionName: 'user',
      });

      await provider.closeSession({
        id: 'close-user-session',
        action: 'session-close',
        contextId: 'default',
        session: session.id,
        surface: 'browser',
        discard: true,
      });

      await expect(provider.listSessions({ profileId: 'default' })).resolves.toMatchObject([
        { id: session.id, kind: 'explicit' },
      ]);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('navigates and returns page identity', async () => {
    const { provider, page } = makeProviderWithFakePage();
    const result = await provider.dispatch({
      id: 'cmd-1',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/',
      profileId: 'default',
    });
    expect(result).toMatchObject({ id: 'cmd-1', ok: true, page: expect.any(String) });
    expect(page.goto).toHaveBeenCalledWith('https://example.com/', expect.objectContaining({ waitUntil: 'load' }));
  });

  it.each([
    { label: 'omits windowMode', windowMode: undefined, background: true, focus: false },
    { label: 'asks for foreground', windowMode: 'foreground' as const, background: false, focus: true },
  ])('opens a window tab per the command that $label', async ({ windowMode, background, focus }) => {
    const { provider, cdpSession } = makeProviderWithFakePage();
    for (const session of ['first', 'second']) {
      await provider.dispatch({
        id: `nav-${session}`,
        action: 'navigate',
        session,
        surface: 'browser',
        url: `https://${session}.example/`,
        profileId: 'default',
        ...(windowMode ? { windowMode } : {}),
      });
    }

    const windowTargets = cdpSession.send.mock.calls
      .filter(([command, params]) => command === 'Target.createTarget' && !(params as { hidden?: boolean })?.hidden)
      .map(([, params]) => params as { background?: boolean; focus?: boolean });
    expect(windowTargets.length).toBeGreaterThan(0);
    for (const params of windowTargets) expect(params).toMatchObject({ background, focus });
  });

  it("maps waitUntil 'none' to a commit-only navigation wait", async () => {
    const { provider, page } = makeProviderWithFakePage();
    const result = await provider.dispatch({
      id: 'cmd-1',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/',
      waitUntil: 'none',
      profileId: 'default',
    });
    expect(result).toMatchObject({ id: 'cmd-1', ok: true, page: expect.any(String) });
    expect(page.goto).toHaveBeenCalledWith('https://example.com/', expect.objectContaining({ waitUntil: 'commit' }));
  });

  it('does not execute a queued command after its daemon deadline expires', async () => {
    const { provider, page } = makeProviderWithFakePage();
    let releaseFirst!: () => void;
    page.goto.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));
    const first = provider.dispatch({
      id: 'first',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://first.example/',
      profileId: 'default',
    });
    await vi.waitFor(() => expect(page.goto).toHaveBeenCalledTimes(1));
    const second = provider.dispatch({
      id: 'second',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://late.example/',
      profileId: 'default',
      deadlineAt: Date.now() - 1,
    });

    releaseFirst();

    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: false, errorCode: 'command_result_unknown' });
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it('evaluates JavaScript in the resolved page', async () => {
    const { provider } = makeProviderWithFakePage();
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });
    await expect(provider.dispatch({ id: 'exec', action: 'exec', session: 'work', surface: 'browser', page: nav.page, code: '1 + 1', profileId: 'default' }))
      .resolves.toMatchObject({ id: 'exec', ok: true, data: { ok: true }, page: nav.page });
  });

  it('runs Playwright-style source against the selected Cloak page', async () => {
    const { provider, browser, context, page } = makeProviderWithFakePage();
    runBrowserProgram.mockResolvedValue(runOutput('https://example.com/'));

    await expect(provider.dispatch({
      id: 'run',
      action: 'run',
      session: 'work',
      surface: 'browser',
      source: `
        return page.url();
      `,
      profileId: 'default',
    })).resolves.toMatchObject({
      id: 'run',
      ok: true,
      page: expect.any(String),
      data: {
        ok: true,
        result: 'https://example.com/',
      },
    });
    expect(runBrowserProgram).toHaveBeenCalledWith(expect.objectContaining({
      browser,
      context,
      page,
      pages: expect.any(Function),
    }), expect.stringContaining('return page.url()'), expect.objectContaining({
      snapshotDiff: undefined,
    }));
  });

  it('browser-run receives only pages from the selected session', async () => {
    const { provider, pages } = makeProviderWithFakePage();
    runBrowserProgram.mockResolvedValue(runOutput(null));
    await provider.dispatch({ id: 'first', action: 'navigate', session: 'first', surface: 'browser', url: 'https://first.example/', profileId: 'default' });
    await provider.dispatch({ id: 'second', action: 'tabs', op: 'new', session: 'second', surface: 'browser', url: 'https://second.example/', profileId: 'default' });

    await provider.dispatch({
      id: 'run',
      action: 'run',
      session: 'first',
      surface: 'browser',
      source: 'return context.pages().length;',
      profileId: 'default',
    });

    expect(runBrowserProgram).toHaveBeenCalledWith(expect.objectContaining({
      pages: expect.any(Function),
    }), expect.any(String), expect.any(Object));
    expect(runBrowserProgram.mock.calls[0][0].pages()).toEqual([pages[0]]);
  });

  it('preserves structured browser-run error details', async () => {
    const { provider } = makeProviderWithFakePage();
    runBrowserProgram.mockRejectedValue(new BrowserRunError(
      'BROWSER_RUN_TIMEOUT',
      'Timed out',
      undefined,
      {
        logs: [{ level: 'warn', args: ['started'] }],
        page: { id: 'page-1', url: 'https://example.com/', title: 'Example' },
        artifacts: [],
        warnings: [{
          code: 'BROWSER_RUN_SIDE_EFFECTS_MAY_HAVE_OCCURRED',
          message: 'Already-issued browser actions were not rolled back.',
        }],
        limits: { outputTruncated: false, snapshotTruncated: false },
      },
    ));

    await expect(provider.dispatch({
      id: 'run',
      action: 'run',
      session: 'work',
      surface: 'browser',
      source: 'return null;',
      profileId: 'default',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'BROWSER_RUN_TIMEOUT',
      details: {
        logs: [{ level: 'warn', args: ['started'] }],
        page: { id: 'page-1', url: 'https://example.com/', title: 'Example' },
      },
    });
  });

  it('rejects oversized run source even when the daemon is called directly', async () => {
    const { provider } = makeProviderWithFakePage();

    await expect(provider.dispatch({
      id: 'run-large',
      action: 'run',
      session: 'work',
      surface: 'browser',
      source: 'x'.repeat(256 * 1024 + 1),
      profileId: 'default',
    })).resolves.toMatchObject({
      id: 'run-large',
      ok: false,
      errorCode: 'BROWSER_RUN_SOURCE_LIMIT',
    });
  });

  it('does not route existing exec commands through the QuickJS runner', async () => {
    const { provider, page } = makeProviderWithFakePage();

    await provider.dispatch({
      id: 'exec',
      action: 'exec',
      session: 'work',
      surface: 'browser',
      code: 'document.title',
      profileId: 'default',
    });

    expect(page.evaluate).toHaveBeenCalledWith('document.title');
  });

  it('serializes run and primitive commands for the same local session', async () => {
    const { provider, page } = makeProviderWithFakePage();
    runBrowserProgram.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return runOutput(1);
    });
    const first = provider.dispatch({
      id: 'run',
      action: 'run',
      session: 'work',
      surface: 'browser',
      source: 'await new Promise(resolve => setTimeout(resolve, 30)); return 1;',
      profileId: 'default',
    });
    const second = provider.dispatch({
      id: 'exec',
      action: 'exec',
      session: 'work',
      surface: 'browser',
      code: 'document.title',
      profileId: 'default',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(page.evaluate).not.toHaveBeenCalled();
    await Promise.all([first, second]);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('serializes raw and adapter commands in the same explicit Session', async () => {
    const { provider } = makeProviderWithFakePage();
    const manager = (provider as unknown as { manager: {
      runWithProfileActivity<T>(profileId: string, operation: () => Promise<T>): Promise<T>;
    } }).manager;
    const runWithProfileActivity = manager.runWithProfileActivity.bind(manager);
    let active = 0;
    let maxActive = 0;
    vi.spyOn(manager, 'runWithProfileActivity').mockImplementation(async (profileId, operation) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await runWithProfileActivity(profileId, operation);
      } finally {
        active -= 1;
      }
    });
    let finishRun!: () => void;
    runBrowserProgram.mockImplementationOnce(() => new Promise((resolve) => {
      finishRun = () => resolve(runOutput(1));
    }));
    const raw = provider.dispatch({
      id: 'raw-run', action: 'run', session: 'session_a', sessionKind: 'explicit',
      surface: 'browser', source: 'return 1;', profileId: 'default',
    });
    await vi.waitFor(() => expect(runBrowserProgram).toHaveBeenCalledTimes(1));
    const adapter = provider.dispatch({
      id: 'adapter-exec', action: 'exec', session: 'session_a', sessionKind: 'explicit',
      surface: 'adapter', adapterSite: 'github', code: 'document.title', profileId: 'default',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runBrowserProgram).toHaveBeenCalledTimes(1);
    finishRun();
    await Promise.all([raw, adapter]);
    expect(maxActive).toBe(1);
  });

  it('partitions the local queue by adapter site only for adapter-default Sessions', () => {
    const { provider } = makeProviderWithFakePage();
    const queueKey = (provider as unknown as {
      commandQueueKey(command: Parameters<LocalCloakRuntimeProvider['dispatch']>[0]): string;
    }).commandQueueKey.bind(provider);

    expect(queueKey({
      id: 'github',
      action: 'exec',
      surface: 'adapter',
      session: 'session_default',
      sessionKind: 'adapter-default',
      adapterSite: 'github',
      profileId: 'default',
    })).not.toBe(queueKey({
      id: 'linkedin',
      action: 'exec',
      surface: 'adapter',
      session: 'session_default',
      sessionKind: 'adapter-default',
      adapterSite: 'linkedin',
      profileId: 'default',
    }));
    expect(queueKey({
      id: 'github-explicit',
      action: 'exec',
      surface: 'adapter',
      session: 'session_default',
      sessionKind: 'explicit',
      adapterSite: 'github',
      profileId: 'default',
    })).toBe(queueKey({
      id: 'linkedin-explicit',
      action: 'exec',
      surface: 'adapter',
      session: 'session_default',
      sessionKind: 'explicit',
      adapterSite: 'linkedin',
      profileId: 'default',
    }));
    expect(queueKey({
      id: 'github-explicit', action: 'exec', surface: 'adapter', session: 'session_a',
      sessionKind: 'explicit', adapterSite: 'github', profileId: 'default',
    })).toBe(queueKey({
      id: 'raw-explicit', action: 'exec', surface: 'browser', session: 'session_a',
      sessionKind: 'explicit', profileId: 'default',
    }));
  });

  it('keeps adapter-default page-scoped queue keys partitioned by site', async () => {
    const { provider } = makeProviderWithFakePage();
    const queueKey = (provider as unknown as {
      commandQueueKey(command: Parameters<LocalCloakRuntimeProvider['dispatch']>[0]): string;
    }).commandQueueKey.bind(provider);
    const github = await provider.dispatch({
      id: 'github-nav',
      action: 'navigate',
      surface: 'adapter',
      session: 'session_default',
      sessionId: 'session_default',
      sessionKind: 'adapter-default',
      siteSession: 'persistent',
      adapterSite: 'github',
      profileId: 'default',
      url: 'https://github.example/',
    });
    const linkedin = await provider.dispatch({
      id: 'linkedin-nav',
      action: 'navigate',
      surface: 'adapter',
      session: 'session_default',
      sessionId: 'session_default',
      sessionKind: 'adapter-default',
      siteSession: 'persistent',
      adapterSite: 'linkedin',
      profileId: 'default',
      url: 'https://linkedin.example/',
    });

    expect(queueKey({
      id: 'github-followup',
      action: 'exec',
      surface: 'adapter',
      session: 'session_default',
      page: github.page,
      profileId: 'default',
    })).not.toBe(queueKey({
      id: 'linkedin-followup',
      action: 'exec',
      surface: 'adapter',
      session: 'session_default',
      page: linkedin.page,
      profileId: 'default',
    }));
  });

  it('serializes commands by the resolved page lease when explicit page metadata differs', async () => {
    const { provider, page } = makeProviderWithFakePage();
    runBrowserProgram.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return runOutput(1);
    });
    const nav = await provider.dispatch({
      id: 'nav',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/',
      profileId: 'default',
    });
    page.evaluate.mockClear();

    const first = provider.dispatch({
      id: 'run',
      action: 'run',
      page: nav.page,
      session: 'work',
      surface: 'browser',
      source: 'await new Promise(resolve => setTimeout(resolve, 30)); return 1;',
      profileId: 'default',
    });
    const second = provider.dispatch({
      id: 'exec',
      action: 'exec',
      page: nav.page,
      session: 'work',
      surface: 'browser',
      code: 'document.title',
      profileId: 'default',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(page.evaluate).not.toHaveBeenCalled();
    await Promise.all([first, second]);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('does not adopt a sibling Session page created during browser-run', async () => {
    const { provider } = makeProviderWithFakePage();
    runBrowserProgram.mockImplementationOnce(async (input) => {
      await provider.dispatch({
        id: 'sibling',
        action: 'tabs',
        op: 'new',
        session: 'session_b',
        surface: 'browser',
        profileId: 'default',
      });
      expect(input.pages().map((candidate: { url(): string }) => candidate.url()))
        .toEqual(['https://example.com/']);
      return runOutput(null);
    });
    await provider.dispatch({
      id: 'nav-a',
      action: 'navigate',
      session: 'session_a',
      surface: 'browser',
      url: 'https://example.com/',
      profileId: 'default',
    });
    await provider.dispatch({
      id: 'run-a',
      action: 'run',
      session: 'session_a',
      surface: 'browser',
      source: 'return null;',
      profileId: 'default',
    });
  });

  it('denies misleading Session metadata for an owned page', async () => {
    const { provider, page } = makeProviderWithFakePage();
    const nav = await provider.dispatch({
      id: 'nav',
      action: 'navigate',
      session: 'session_a',
      surface: 'browser',
      url: 'https://example.com/',
      profileId: 'default',
    });
    await expect(provider.dispatch({
      id: 'bind',
      action: 'bind',
      page: nav.page,
      session: 'session_b',
      surface: 'browser',
      profileId: 'default',
    })).resolves.toMatchObject({ ok: false, errorCode: 'SESSION_WINDOW_CONFLICT' });
    expect(page.bringToFront).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('evaluates JavaScript in the requested iframe', async () => {
    const { provider, page } = makeProviderWithFakePage();
    const frame = { evaluate: vi.fn().mockResolvedValue('inside frame'), url: vi.fn(() => 'https://frame.example/'), name: vi.fn(() => 'frame') };
    page.frames.mockReturnValue([page, frame]);
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'exec', action: 'exec', session: 'work', surface: 'browser', page: nav.page, frameIndex: 0, code: 'document.body.textContent', profileId: 'default' }))
      .resolves.toMatchObject({ id: 'exec', ok: true, data: 'inside frame', page: nav.page });
    expect(frame.evaluate).toHaveBeenCalledWith('document.body.textContent');
    expect(page.evaluate).not.toHaveBeenCalledWith('document.body.textContent');
  });

  it('returns a typed error when the requested iframe is out of range', async () => {
    const { provider, page } = makeProviderWithFakePage();
    page.frames.mockReturnValue([page]);
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'exec', action: 'exec', session: 'work', surface: 'browser', page: nav.page, frameIndex: 0, code: '1 + 1', profileId: 'default' }))
      .resolves.toMatchObject({
        id: 'exec',
        ok: false,
        errorCode: 'frame_not_found',
        error: 'Frame not found: 0',
        page: nav.page,
      });
  });

  it('returns a typed stale page error instead of falling back when command.page is unknown', async () => {
    const { provider, page } = makeProviderWithFakePage();
    await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'exec', action: 'exec', session: 'work', surface: 'browser', page: 'page-stale', code: '1 + 1', profileId: 'default' }))
      .resolves.toMatchObject({
        id: 'exec',
        ok: false,
        errorCode: 'stale_page_identity',
        error: 'Page not found: page-stale — stale page identity',
      });
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('returns typed validation errors for missing navigate url and exec code', async () => {
    const { provider } = makeProviderWithFakePage();

    await expect(provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', profileId: 'default' }))
      .resolves.toMatchObject({ id: 'nav', ok: false, errorCode: 'invalid_request', error: 'Missing url' });
    await expect(provider.dispatch({ id: 'exec', action: 'exec', session: 'work', surface: 'browser', profileId: 'default' }))
      .resolves.toMatchObject({ id: 'exec', ok: false, errorCode: 'invalid_request', error: 'Missing code' });
  });

  it('returns filtered cookies from the resolved context', async () => {
    const { provider } = makeProviderWithFakePage();

    await expect(provider.dispatch({ id: 'cookies', action: 'cookies', session: 'work', surface: 'browser', domain: 'example.com', profileId: 'default' }))
      .resolves.toMatchObject({ id: 'cookies', ok: true, data: [{ name: 'sid', value: '1', domain: 'example.com', path: '/' }] });
  });

  it('captures screenshots as base64 and preserves page identity', async () => {
    const { provider } = makeProviderWithFakePage();
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'shot', action: 'screenshot', session: 'work', surface: 'browser', page: nav.page, format: 'png', fullPage: true, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'shot', ok: true, data: Buffer.from('image').toString('base64'), page: nav.page });
  });

  it('applies screenshot width overrides with the current viewport height', async () => {
    const { provider, page } = makeProviderWithFakePage();
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await provider.dispatch({ id: 'shot', action: 'screenshot', session: 'work', surface: 'browser', page: nav.page, format: 'png', width: 900, profileId: 'default' });

    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 900, height: 720 });
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ fullPage: undefined }));
  });

  it('applies screenshot height overrides with the current viewport width', async () => {
    const { provider, page } = makeProviderWithFakePage();
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await provider.dispatch({ id: 'shot', action: 'screenshot', session: 'work', surface: 'browser', page: nav.page, format: 'png', height: 480, profileId: 'default' });

    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 1280, height: 480 });
  });

  it('restores the previous viewport after screenshot overrides', async () => {
    const { provider, page } = makeProviderWithFakePage();
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await provider.dispatch({ id: 'shot', action: 'screenshot', session: 'work', surface: 'browser', page: nav.page, format: 'png', width: 900, height: 480, profileId: 'default' });

    expect(page.setViewportSize).toHaveBeenNthCalledWith(1, { width: 900, height: 480 });
    expect(page.setViewportSize).toHaveBeenNthCalledWith(2, { width: 1280, height: 720 });
    expect(page.screenshot).toHaveBeenCalledTimes(1);
  });

  it('reversibly overrides via CDP and never pins the viewport when the context has no fixed viewport', async () => {
    const { provider, page, cdpSession, pageCdpSessions } = makeProviderWithFakePage(null);
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await provider.dispatch({ id: 'shot', action: 'screenshot', session: 'work', surface: 'browser', page: nav.page, format: 'png', width: 375, height: 812, profileId: 'default' });

    // The override must not permanently pin the real window via setViewportSize (#120).
    expect(page.setViewportSize).not.toHaveBeenCalled();
    expect(cdpSession.send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({ width: 375, height: 812 }));
    // ...and it must be cleared afterward so the override is per-shot only.
    expect(cdpSession.send).toHaveBeenCalledWith('Emulation.clearDeviceMetricsOverride');
    expect(pageCdpSessions.some(session => session.detach.mock.calls.length > 0)).toBe(true);
    expect(page.screenshot).toHaveBeenCalledTimes(1);
  });

  it('ignores screenshot height overrides for full-page captures while applying width', async () => {
    const { provider, page } = makeProviderWithFakePage();
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await provider.dispatch({ id: 'shot', action: 'screenshot', session: 'work', surface: 'browser', page: nav.page, format: 'png', fullPage: true, width: 700, height: 480, profileId: 'default' });

    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 700, height: 720 });
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ fullPage: true }));
  });

  it('requires an explicit Cloak tab target for bind', async () => {
    const { provider } = makeProviderWithFakePage();
    await expect(provider.dispatch({ id: 'bind', action: 'bind', session: 'work', surface: 'browser', profileId: 'default' }))
      .resolves.toMatchObject({
        id: 'bind',
        ok: false,
        errorCode: 'invalid_request',
        error: 'Bind requires --page or --index for a Cloak runtime tab',
      });
  });

  it('rejects binding a page owned by another Session', async () => {
    const { provider, pages } = makeProviderWithFakePage();
    const created = await provider.dispatch({ id: 'new', action: 'tabs', op: 'new', session: 'manual', surface: 'browser', url: 'https://signed-in.example/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'bind', action: 'bind', session: 'work', surface: 'browser', page: created.page, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'bind', ok: false, errorCode: 'SESSION_WINDOW_CONFLICT' });
    expect(pages[0].bringToFront).not.toHaveBeenCalled();
  });

  it('does not enumerate another Session page by bind index', async () => {
    const { provider, pages } = makeProviderWithFakePage();
    await provider.dispatch({ id: 'nav', action: 'navigate', session: 'first', surface: 'browser', url: 'https://first.example/', profileId: 'default' });
    await provider.dispatch({ id: 'new', action: 'tabs', op: 'new', session: 'manual', surface: 'browser', url: 'https://second.example/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'bind', action: 'bind', session: 'work', surface: 'browser', index: 1, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'bind', ok: false, errorCode: 'SESSION_WINDOW_CONFLICT' });
    expect(pages[0].bringToFront).not.toHaveBeenCalled();
  });

  it('returns a typed bind error when the requested Cloak tab is missing', async () => {
    const { provider } = makeProviderWithFakePage();
    await provider.dispatch({ id: 'nav', action: 'navigate', session: 'first', surface: 'browser', url: 'https://first.example/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'bind', action: 'bind', session: 'work', surface: 'browser', page: 'missing-page', profileId: 'default' }))
      .resolves.toMatchObject({
        id: 'bind',
        ok: false,
        errorCode: 'bound_tab_not_found',
        error: 'Cloak tab not found for bind target',
      });
  });

  it('sets file input through the first matching locator', async () => {
    const { provider, page } = makeProviderWithFakePage();
    const setInputFiles = vi.fn().mockResolvedValue(undefined);
    page.locator = vi.fn().mockReturnValue({ first: () => ({ setInputFiles }) });
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });
    await expect(provider.dispatch({ id: 'upload', action: 'set-file-input', session: 'work', surface: 'browser', page: nav.page, files: ['/tmp/a.txt'], profileId: 'default' }))
      .resolves.toMatchObject({ id: 'upload', ok: true, data: { count: 1 } });
    expect(setInputFiles).toHaveBeenCalledWith(['/tmp/a.txt']);
  });

  it('lists current tabs with page identities', async () => {
    const { provider } = makeProviderWithFakePage();
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'tabs', action: 'tabs', op: 'list', session: 'work', surface: 'browser', profileId: 'default' }))
      .resolves.toMatchObject({
        id: 'tabs',
        ok: true,
        data: [expect.objectContaining({ id: nav.page, page: nav.page, index: 0, url: 'https://example.com/' })],
      });
  });

  it('creates, selects, and closes tabs by command op', async () => {
    const { provider, pages } = makeProviderWithFakePage();

    const created = await provider.dispatch({ id: 'new', action: 'tabs', op: 'new', session: 'work', surface: 'browser', url: 'https://second.example/', profileId: 'default' });
    expect(created).toMatchObject({ id: 'new', ok: true, page: expect.any(String), data: { url: 'https://second.example/' } });
    expect(pages[0].goto).toHaveBeenCalledWith('https://second.example/', expect.objectContaining({ waitUntil: 'load' }));

    await expect(provider.dispatch({ id: 'select', action: 'tabs', op: 'select', session: 'work', surface: 'browser', page: created.page, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'select', ok: true, page: created.page, data: { selected: true } });
    expect(pages[0].bringToFront).not.toHaveBeenCalled();

    await expect(provider.dispatch({ id: 'close', action: 'tabs', op: 'close', session: 'work', surface: 'browser', page: created.page, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'close', ok: true, data: { closed: created.page } });
    expect(pages[0].close.mock.calls.length + pages[0].goto.mock.calls.filter(([url]) => url === 'about:blank').length).toBeGreaterThan(0);
  });

  it('does not bring selected tabs to front in background window mode', async () => {
    const { provider, pages } = makeProviderWithFakePage();

    const created = await provider.dispatch({ id: 'new', action: 'tabs', op: 'new', session: 'work', surface: 'browser', url: 'https://second.example/', profileId: 'default' });

    await expect(provider.dispatch({
      id: 'select',
      action: 'tabs',
      op: 'select',
      session: 'work',
      surface: 'browser',
      page: created.page,
      profileId: 'default',
      windowMode: 'background',
    })).resolves.toMatchObject({ id: 'select', ok: true });
    expect(pages[0].bringToFront).not.toHaveBeenCalled();
  });

  it('does not bring bound tabs to front in background window mode', async () => {
    const { provider, pages } = makeProviderWithFakePage();
    const created = await provider.dispatch({ id: 'new', action: 'tabs', op: 'new', session: 'source', surface: 'browser', url: 'https://second.example/', profileId: 'default' });

    await expect(provider.dispatch({
      id: 'bind',
      action: 'bind',
      session: 'target',
      surface: 'browser',
      page: created.page,
      profileId: 'default',
      windowMode: 'background',
    })).resolves.toMatchObject({ id: 'bind', ok: false, errorCode: 'SESSION_WINDOW_CONFLICT' });
    expect(pages[0].bringToFront).not.toHaveBeenCalled();
  });

  it('does not bring bound tabs to front by default', async () => {
    const { provider, pages } = makeProviderWithFakePage();
    const created = await provider.dispatch({ id: 'new', action: 'tabs', op: 'new', session: 'source', surface: 'browser', url: 'https://second.example/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'bind', action: 'bind', session: 'target', surface: 'browser', page: created.page, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'bind', ok: false, errorCode: 'SESSION_WINDOW_CONFLICT' });
    expect(pages[0].bringToFront).not.toHaveBeenCalled();
  });

  it('rejects a page identity from a different session', async () => {
    const { provider, pages } = makeProviderWithFakePage();
    const first = await provider.dispatch({ id: 'first', action: 'navigate', session: 'first', surface: 'browser', url: 'https://first.example/', profileId: 'default' });
    const second = await provider.dispatch({ id: 'second', action: 'tabs', op: 'new', session: 'second', surface: 'browser', url: 'https://second.example/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'close-window', action: 'close-window', session: 'first', surface: 'browser', page: second.page, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'close-window', ok: true, data: { closed: false, page: second.page } });

    await expect(provider.dispatch({ id: 'exec', action: 'exec', session: 'first', surface: 'browser', page: second.page, code: 'document.title', profileId: 'default' }))
      .resolves.toMatchObject({ id: 'exec', ok: false, errorCode: 'stale_page_identity' });

    expect(pages[0].isClosed()).toBe(false);
    expect(pages[1].close).not.toHaveBeenCalled();
    expect(pages[1].evaluate).not.toHaveBeenCalled();
    expect(first.page).not.toBe(second.page);
  });
});
