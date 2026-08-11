import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalCloakRuntimeProvider } from './provider.js';
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

function fakePage(url: string, initialViewport: { width: number; height: number } | null = { width: 1280, height: 720 }) {
  let closed = false;
  let viewportSize = initialViewport;
  return {
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
    bringToFront: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockImplementation(async () => {
      closed = true;
    }),
  };
}

function makeProviderWithFakePage(initialViewport: { width: number; height: number } | null = { width: 1280, height: 720 }) {
  const pages = [fakePage('https://example.com/', initialViewport)];
  const cdpSession = { send: vi.fn().mockResolvedValue(undefined), detach: vi.fn().mockResolvedValue(undefined) };
  const browser = { contexts: vi.fn(() => [context]) };
  const context = {
    browser: vi.fn(() => browser),
    on: vi.fn(),
    pages: vi.fn(() => pages.filter((page) => !page.isClosed())),
    newPage: vi.fn(async () => {
      const page = fakePage('about:blank');
      pages.push(page);
      return page;
    }),
    newCDPSession: vi.fn().mockResolvedValue(cdpSession),
    cookies: vi.fn().mockResolvedValue([{ name: 'sid', value: '1', domain: 'example.com', path: '/' }]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const provider = new LocalCloakRuntimeProvider({
    baseDir: '/tmp/webcmd-test',
    launchPersistentContext: vi.fn().mockResolvedValue(context),
  });
  return { provider, browser, page: pages[0], pages, context, cdpSession };
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
      pages: [page],
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
      pages: [pages[0]],
    }), expect.any(String), expect.any(Object));
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

  it('keeps popup pages under the originating session queue lock', async () => {
    const { provider, page, pages } = makeProviderWithFakePage();
    const popup = fakePage('https://popup.example/');
    pages.push(popup);
    page.waitForEvent.mockResolvedValue(popup);
    runBrowserProgram.mockImplementationOnce(async (input) => {
      const registeredPopup = await input.page.waitForEvent('popup');
      input.registerPage?.(registeredPopup);
      await new Promise(resolve => setTimeout(resolve, 30));
      return runOutput(null);
    });
    const nav = await provider.dispatch({
      id: 'nav',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com/',
      profileId: 'default',
    });
    const manager = (
      provider as unknown as {
        manager: { pageIdFor(target: unknown): string | undefined };
      }
    ).manager;

    const first = provider.dispatch({
      id: 'run',
      action: 'run',
      page: nav.page,
      session: 'work',
      surface: 'browser',
      source: `
        await page.waitForEvent("popup");
        await new Promise(resolve => setTimeout(resolve, 30));
        return null;
      `,
      profileId: 'default',
    });
    await vi.waitFor(() => {
      expect(manager.pageIdFor(popup)).toEqual(expect.any(String));
    }, { interval: 1, timeout: 100 });
    const popupPageId = manager.pageIdFor(popup)!;
    popup.evaluate.mockClear();

    const second = provider.dispatch({
      id: 'exec',
      action: 'exec',
      page: popupPageId,
      session: 'work',
      surface: 'browser',
      code: 'document.title',
      profileId: 'default',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(popup.evaluate).not.toHaveBeenCalled();
    await Promise.all([first, second]);
    expect(popup.evaluate).toHaveBeenCalledTimes(1);
  });

  it('holds the original page queue lock throughout a bind transition', async () => {
    const { provider, page } = makeProviderWithFakePage();
    const nav = await provider.dispatch({
      id: 'nav',
      action: 'navigate',
      session: 'before-bind',
      surface: 'browser',
      url: 'https://example.com/',
      profileId: 'default',
    });
    let markBindStarted!: () => void;
    let finishBind!: () => void;
    const bindStarted = new Promise<void>((resolve) => {
      markBindStarted = resolve;
    });
    page.bringToFront.mockImplementation(() => {
      markBindStarted();
      return new Promise<void>((resolve) => {
        finishBind = resolve;
      });
    });
    page.evaluate.mockClear();

    const bind = provider.dispatch({
      id: 'bind',
      action: 'bind',
      page: nav.page,
      session: 'after-bind',
      surface: 'browser',
      profileId: 'default',
    });
    await bindStarted;
    const exec = provider.dispatch({
      id: 'exec',
      action: 'exec',
      page: nav.page,
      session: 'after-bind',
      surface: 'browser',
      code: 'document.title',
      profileId: 'default',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(page.evaluate).not.toHaveBeenCalled();
    finishBind();
    await Promise.all([bind, exec]);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit page commands queued behind a bind transition', async () => {
    const { provider, page, pages, context } = makeProviderWithFakePage();
    const nav = await provider.dispatch({
      id: 'nav',
      action: 'navigate',
      session: 'source',
      surface: 'browser',
      url: 'https://example.com/',
      profileId: 'default',
    });

    const priorTargetPage = fakePage('https://prior-target.example/');
    pages.push(priorTargetPage);
    context.newPage.mockResolvedValueOnce(priorTargetPage);
    let releaseBlocker!: () => void;
    let markBlockerStarted!: () => void;
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    priorTargetPage.evaluate.mockImplementationOnce(() => {
      markBlockerStarted();
      return new Promise((resolve) => {
        releaseBlocker = () => resolve({ ok: true });
      });
    });
    const blocker = provider.dispatch({
      id: 'blocker',
      action: 'exec',
      session: 'target',
      surface: 'browser',
      code: 'document.title',
      profileId: 'default',
    });
    await blockerStarted;

    let finishBind!: () => void;
    let markBindStarted!: () => void;
    const bindStarted = new Promise<void>((resolve) => {
      markBindStarted = resolve;
    });
    page.bringToFront.mockImplementation(() => {
      markBindStarted();
      return new Promise<void>((resolve) => {
        finishBind = resolve;
      });
    });
    const bind = provider.dispatch({
      id: 'bind',
      action: 'bind',
      page: nav.page,
      session: 'target',
      surface: 'browser',
      profileId: 'default',
    });
    const beforeMapping = provider.dispatch({
      id: 'before-mapping',
      action: 'exec',
      page: nav.page,
      session: 'target',
      surface: 'browser',
      code: 'document.title',
      profileId: 'default',
    });

    releaseBlocker();
    await blocker;
    await bindStarted;

    let finishFirstTargetExec!: () => void;
    page.evaluate.mockImplementationOnce(() => (
      new Promise((resolve) => {
        finishFirstTargetExec = () => resolve({ ok: true });
      })
    ));
    const afterMapping = provider.dispatch({
      id: 'after-mapping',
      action: 'exec',
      session: 'target',
      surface: 'browser',
      code: 'document.title',
      profileId: 'default',
    });

    finishBind();
    await vi.waitFor(() => {
      expect(page.evaluate).toHaveBeenCalledTimes(1);
    }, { interval: 1, timeout: 100 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(page.evaluate).toHaveBeenCalledTimes(1);

    finishFirstTargetExec();
    await Promise.all([bind, beforeMapping, afterMapping]);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(priorTargetPage.evaluate).toHaveBeenCalledTimes(2);
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
    const { provider, page, cdpSession } = makeProviderWithFakePage(null);
    const nav = await provider.dispatch({ id: 'nav', action: 'navigate', session: 'work', surface: 'browser', url: 'https://example.com/', profileId: 'default' });

    await provider.dispatch({ id: 'shot', action: 'screenshot', session: 'work', surface: 'browser', page: nav.page, format: 'png', width: 375, height: 812, profileId: 'default' });

    // The override must not permanently pin the real window via setViewportSize (#120).
    expect(page.setViewportSize).not.toHaveBeenCalled();
    expect(cdpSession.send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({ width: 375, height: 812 }));
    // ...and it must be cleared afterward so the override is per-shot only.
    expect(cdpSession.send).toHaveBeenCalledWith('Emulation.clearDeviceMetricsOverride');
    expect(cdpSession.detach).toHaveBeenCalledTimes(1);
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

  it('binds a browser session to an existing Cloak tab by page id', async () => {
    const { provider, pages } = makeProviderWithFakePage();
    const created = await provider.dispatch({ id: 'new', action: 'tabs', op: 'new', session: 'manual', surface: 'browser', url: 'https://signed-in.example/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'bind', action: 'bind', session: 'work', surface: 'browser', page: created.page, profileId: 'default' }))
      .resolves.toMatchObject({
        id: 'bind',
        ok: true,
        page: created.page,
        data: { bound: true, session: 'work', page: created.page, url: 'https://signed-in.example/' },
      });

    await provider.dispatch({ id: 'exec', action: 'exec', session: 'work', surface: 'browser', code: 'window.__loggedIn', profileId: 'default' });
    expect(pages[1].evaluate).toHaveBeenCalledWith('window.__loggedIn');
    expect(pages[0].evaluate).not.toHaveBeenCalledWith('window.__loggedIn');
  });

  it('binds a browser session to an existing Cloak tab by index', async () => {
    const { provider, pages } = makeProviderWithFakePage();
    await provider.dispatch({ id: 'nav', action: 'navigate', session: 'first', surface: 'browser', url: 'https://first.example/', profileId: 'default' });
    await provider.dispatch({ id: 'new', action: 'tabs', op: 'new', session: 'manual', surface: 'browser', url: 'https://second.example/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'bind', action: 'bind', session: 'work', surface: 'browser', index: 1, profileId: 'default' }))
      .resolves.toMatchObject({
        id: 'bind',
        ok: true,
        data: { bound: true, session: 'work', url: 'https://second.example/' },
      });

    await provider.dispatch({ id: 'exec', action: 'exec', session: 'work', surface: 'browser', code: 'document.readyState', profileId: 'default' });
    expect(pages[1].evaluate).toHaveBeenCalledWith('document.readyState');
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
    expect(pages[1].goto).toHaveBeenCalledWith('https://second.example/', expect.objectContaining({ waitUntil: 'load' }));

    await expect(provider.dispatch({ id: 'select', action: 'tabs', op: 'select', session: 'work', surface: 'browser', page: created.page, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'select', ok: true, page: created.page, data: { selected: true } });
    expect(pages[1].bringToFront).toHaveBeenCalled();

    await expect(provider.dispatch({ id: 'close', action: 'tabs', op: 'close', session: 'work', surface: 'browser', page: created.page, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'close', ok: true, data: { closed: created.page } });
    expect(pages[1].close).toHaveBeenCalled();
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
    expect(pages[1].bringToFront).not.toHaveBeenCalled();
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
    })).resolves.toMatchObject({ id: 'bind', ok: true });
    expect(pages[1].bringToFront).not.toHaveBeenCalled();
  });

  it('brings bound tabs to front by default', async () => {
    const { provider, pages } = makeProviderWithFakePage();
    const created = await provider.dispatch({ id: 'new', action: 'tabs', op: 'new', session: 'source', surface: 'browser', url: 'https://second.example/', profileId: 'default' });

    await expect(provider.dispatch({ id: 'bind', action: 'bind', session: 'target', surface: 'browser', page: created.page, profileId: 'default' }))
      .resolves.toMatchObject({ id: 'bind', ok: true });
    expect(pages[1].bringToFront).toHaveBeenCalledOnce();
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
