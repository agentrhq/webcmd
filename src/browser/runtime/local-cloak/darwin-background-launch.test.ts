import { describe, expect, it, vi } from 'vitest';
import type { Browser, BrowserContext } from 'playwright-core';
import { activateDarwinBackgroundContext, launchDarwinBackgroundPersistentContext, waitForDevToolsPort } from './darwin-background-launch.js';

const options = {
  userDataDir: '/tmp/cloak profile',
  headless: false,
  humanize: true,
};

function fakeRuntime() {
  const context = { close: vi.fn() } as unknown as BrowserContext;
  const browser = {
    contexts: vi.fn(() => [context]),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Browser;
  return { browser, context };
}

function fakeDependencies(browser: Browser) {
  return {
    buildLaunchOptions: vi.fn().mockResolvedValue({
      executablePath: '/Applications/Cloak Chromium.app/Contents/MacOS/Chromium',
      args: ['--fingerprint=123'],
    }),
    humanizeBrowser: vi.fn().mockResolvedValue(undefined),
    openApplication: vi.fn().mockResolvedValue(undefined),
    activateApplication: vi.fn().mockResolvedValue(undefined),
    readPort: vi.fn().mockResolvedValue(43123),
    connectOverCDP: vi.fn().mockResolvedValue(browser),
    terminateProfile: vi.fn().mockResolvedValue(undefined),
    removePortFile: vi.fn().mockResolvedValue(undefined),
    registerBundle: vi.fn().mockResolvedValue(undefined),
  };
}

describe('launchDarwinBackgroundPersistentContext', () => {
  it('launches the Chromium app without activation and connects through loopback CDP', async () => {
    const { browser, context } = fakeRuntime();
    const deps = fakeDependencies(browser);

    const result = await launchDarwinBackgroundPersistentContext(options, deps);

    expect(deps.removePortFile).toHaveBeenCalledWith('/tmp/cloak profile/DevToolsActivePort');
    expect(deps.openApplication).toHaveBeenCalledWith('/Applications/Cloak Chromium.app', [
      '--fingerprint=123',
      '--password-store=basic',
      '--use-mock-keychain',
      '--disable-popup-blocking',
      '--disable-features=DestroyProfileOnBrowserClose',
      '--user-data-dir=/tmp/cloak profile',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      'about:blank',
    ]);
    expect(deps.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:43123');
    expect(deps.humanizeBrowser).toHaveBeenCalledWith(browser, expect.objectContaining({ humanize: true }));
    expect(result).toBe(context);

    await activateDarwinBackgroundContext(result);
    expect(deps.activateApplication).toHaveBeenCalledWith('/Applications/Cloak Chromium.app');

    await result.close();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(deps.terminateProfile).toHaveBeenCalledWith(options.userDataDir);
  });

  it('fails immediately when the CDP port file misses its deadline', async () => {
    await expect(waitForDevToolsPort('/missing/DevToolsActivePort', 0)).rejects.toThrow(
      'Timed out waiting for background Chromium CDP endpoint',
    );
  });

  it('terminates the launched profile when CDP connection fails', async () => {
    const { browser } = fakeRuntime();
    const deps = fakeDependencies(browser);
    deps.connectOverCDP.mockRejectedValueOnce(new Error('connect failed'));

    await expect(launchDarwinBackgroundPersistentContext(options, deps)).rejects.toThrow('connect failed');

    expect(deps.terminateProfile).toHaveBeenCalledWith(options.userDataDir);
  });

  it('re-registers a stale LaunchServices bundle and retries once on kLSNoExecutableErr', async () => {
    const { browser, context } = fakeRuntime();
    const deps = fakeDependencies(browser);
    const lsError = new Error(
      'Command failed: /usr/bin/open -g -n /Applications/Cloak Chromium.app --args ...\n' +
      'The application cannot be opened for an unexpected reason, error=Error Domain=NSOSStatusErrorDomain ' +
      'Code=-10827 "kLSNoExecutableErr: The executable is missing"',
    );
    deps.openApplication.mockRejectedValueOnce(lsError).mockResolvedValueOnce(undefined);

    const result = await launchDarwinBackgroundPersistentContext(options, deps);

    expect(deps.registerBundle).toHaveBeenCalledWith('/Applications/Cloak Chromium.app');
    expect(deps.openApplication).toHaveBeenCalledTimes(2);
    expect(result).toBe(context);
  });

  it('surfaces a remediation error when re-registering does not fix kLSNoExecutableErr', async () => {
    const { browser } = fakeRuntime();
    const deps = fakeDependencies(browser);
    const lsError = new Error('kLSNoExecutableErr: The executable is missing');
    deps.openApplication
      .mockRejectedValueOnce(lsError)
      .mockRejectedValueOnce(new Error('retry failed: bundle executable is invalid'));

    await expect(launchDarwinBackgroundPersistentContext(options, deps)).rejects.toThrow(
      /retry failed: bundle executable is invalid[\s\S]*lsregister -f "\/Applications\/Cloak Chromium\.app"/,
    );

    expect(deps.registerBundle).toHaveBeenCalledWith('/Applications/Cloak Chromium.app');
    expect(deps.openApplication).toHaveBeenCalledTimes(2);
    // Never "launched" (both attempts failed before the app came up), so no
    // stray terminateProfile call for a process that never started.
    expect(deps.terminateProfile).not.toHaveBeenCalled();
  });

  it('does not attempt lsregister remediation for unrelated open failures', async () => {
    const { browser } = fakeRuntime();
    const deps = fakeDependencies(browser);
    deps.openApplication.mockRejectedValue(new Error('some other launch failure'));

    await expect(launchDarwinBackgroundPersistentContext(options, deps)).rejects.toThrow('some other launch failure');

    expect(deps.registerBundle).not.toHaveBeenCalled();
    expect(deps.openApplication).toHaveBeenCalledTimes(1);
  });
});
