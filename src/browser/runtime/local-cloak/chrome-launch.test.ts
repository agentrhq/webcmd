import { describe, expect, it, vi } from 'vitest';
import type { Browser, BrowserContext } from 'playwright-core';
import {
  chromeLaunchArgs,
  launchChromePersistentContext,
  type ChromeLaunchDependencies,
} from './chrome-launch.js';

function runtime() {
  const context = { close: vi.fn() } as unknown as BrowserContext;
  const browser = {
    contexts: vi.fn(() => [context]),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Browser;
  return { browser, context };
}

function dependencies(browser: Browser): ChromeLaunchDependencies {
  let now = 0;
  return {
    buildLaunchOptions: vi.fn().mockResolvedValue({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--fingerprint=123', '--enable-automation', '--remote-debugging-pipe'],
    }),
    humanizeBrowser: vi.fn().mockResolvedValue(undefined),
    allocatePort: vi.fn().mockResolvedValue(43123),
    launch: vi.fn().mockResolvedValue(undefined),
    findProcesses: vi.fn().mockImplementation(async identity => identity.port === undefined ? [] : [987]),
    listenerOwnedBy: vi.fn().mockResolvedValue(true),
    endpointReady: vi.fn().mockResolvedValue(true),
    connectOverCDP: vi.fn().mockResolvedValue(browser),
    terminate: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockImplementation(async (ms: number) => { now += ms; }),
    now: vi.fn(() => now),
    platform: 'darwin',
  };
}

describe('chromeLaunchArgs', () => {
  it('uses an explicit nonzero loopback port without automation transports', () => {
    const args = chromeLaunchArgs([
      '--fingerprint=123', '--enable-automation', '--remote-debugging-pipe', '--remote-debugging-port=0', '--headless',
      '--remote-debugging-address=0.0.0.0', '--headless=old',
    ], '/profiles/work', 43123);
    expect(args).toContain('--remote-debugging-address=127.0.0.1');
    expect(args).toContain('--remote-debugging-port=43123');
    expect(args).toContain('--user-data-dir=/profiles/work');
    expect(args).not.toContain('--remote-debugging-port=0');
    expect(args).not.toContain('--remote-debugging-pipe');
    expect(args).not.toContain('--enable-automation');
    expect(args).not.toContain('--headless');
    expect(args).not.toContain('--headless=old');
    expect(args).not.toContain('--remote-debugging-address=0.0.0.0');
  });
});

describe('launchChromePersistentContext', () => {
  it('verifies listener ownership before attaching and cleans up on close', async () => {
    const { browser, context } = runtime();
    const deps = dependencies(browser);
    const result = await launchChromePersistentContext({ userDataDir: '/profiles/work', headless: false }, deps);

    expect(deps.launch).toHaveBeenCalledWith(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      expect.arrayContaining(['--remote-debugging-port=43123', '--user-data-dir=/profiles/work']),
      'darwin',
    );
    expect(deps.listenerOwnedBy).toHaveBeenCalledWith(43123, 987, 'darwin');
    expect(deps.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:43123');
    expect(result).toBe(context);

    await result.close();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(deps.terminate).toHaveBeenCalledWith(987, 'darwin', false);
  });

  it('fails closed and retries when a valid endpoint belongs to another process', async () => {
    const { browser } = runtime();
    const deps = dependencies(browser);
    vi.mocked(deps.allocatePort).mockResolvedValueOnce(43123).mockResolvedValueOnce(43124).mockResolvedValueOnce(43125);
    vi.mocked(deps.listenerOwnedBy).mockResolvedValue(false);

    await expect(launchChromePersistentContext({ userDataDir: '/profiles/work', headless: false }, deps))
      .rejects.toThrow('Failed to launch Webcmd-managed Chrome after 3 attempts');
    expect(deps.connectOverCDP).not.toHaveBeenCalled();
    expect(deps.launch).toHaveBeenCalledTimes(3);
  });

  it('reports a locked Webcmd Chrome Profile before launching another process', async () => {
    const { browser } = runtime();
    const deps = dependencies(browser);
    vi.mocked(deps.findProcesses).mockResolvedValue([444]);

    await expect(launchChromePersistentContext({ userDataDir: '/profiles/work', headless: false }, deps))
      .rejects.toThrow('Opening in existing browser session');
    expect(deps.launch).not.toHaveBeenCalled();
  });

  it('uses the directly launched pid when a platform wrapper changes the process command', async () => {
    const { browser, context } = runtime();
    const deps = dependencies(browser);
    vi.mocked(deps.launch).mockResolvedValue(987);
    vi.mocked(deps.findProcesses).mockResolvedValue([]);

    const result = await launchChromePersistentContext({ userDataDir: '/profiles/work', headless: false }, deps);

    expect(result).toBe(context);
    expect(deps.listenerOwnedBy).toHaveBeenCalledWith(43123, 987, 'darwin');
    await result.close();
    expect(deps.terminate).toHaveBeenCalledWith(987, 'darwin', false);
  });
});
