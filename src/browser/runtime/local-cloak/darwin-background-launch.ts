import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { posix as path } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { buildLaunchOptions, humanizeBrowser } from 'cloakbrowser';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';
import { findExactCloakProfileProcesses } from './process-matcher.js';

const execFileAsync = promisify(execFile);

// macOS LaunchServices' registration database for `.app` bundles. A script-driven
// unzip of a new/updated Chromium bundle (rather than a Finder/.pkg install) can
// land outside the triggers that make LS pick it up, leaving `open` unable to
// resolve a bundle that runs fine when executed directly (kLSNoExecutableErr).
const LSREGISTER_PATH =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const LS_NO_EXECUTABLE_MARKER = 'kLSNoExecutableErr';

type Dependencies = {
  buildLaunchOptions: typeof buildLaunchOptions;
  humanizeBrowser: typeof humanizeBrowser;
  openApplication: (appPath: string, args: string[]) => Promise<void>;
  activateApplication: (appPath: string) => Promise<void>;
  readPort: (portFile: string) => Promise<number>;
  connectOverCDP: (endpoint: string) => Promise<Browser>;
  terminateProfile: (userDataDir: string) => Promise<void>;
  removePortFile: (portFile: string) => Promise<void>;
  /** Force LaunchServices to re-scan a bundle after a stale-cache `open` failure. */
  registerBundle: (appPath: string) => Promise<void>;
};

async function openApplication(appPath: string, args: string[]): Promise<void> {
  await execFileAsync('/usr/bin/open', ['-g', '-n', appPath, '--args', ...args]);
}

async function registerBundle(appPath: string): Promise<void> {
  await execFileAsync(LSREGISTER_PATH, ['-f', appPath]);
}

function isStaleLaunchServicesError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(LS_NO_EXECUTABLE_MARKER);
}

/**
 * Open the app, retrying once via `lsregister -f` when macOS reports the bundle
 * as missing due to a stale LaunchServices cache entry rather than an actually
 * missing executable (see #220).
 */
async function openApplicationWithLsRegisterRetry(
  deps: Dependencies,
  appPath: string,
  args: string[],
): Promise<void> {
  try {
    await deps.openApplication(appPath, args);
  } catch (err) {
    if (!isStaleLaunchServicesError(err)) throw err;
    try {
      await deps.registerBundle(appPath);
      await deps.openApplication(appPath, args);
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(
        `Cloak Chromium bundle exists but macOS LaunchServices has a stale record for it (${LS_NO_EXECUTABLE_MARKER}): ${appPath}\n` +
        `Automatic remediation failed: ${retryMessage}\n` +
        `Re-registering it automatically did not resolve the issue. Fix it manually with:\n` +
        `  ${LSREGISTER_PATH} -f "${appPath}"`,
        { cause: retryError },
      );
    }
  }
}

export async function waitForDevToolsPort(portFile: string, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const port = Number.parseInt((await readFile(portFile, 'utf8')).split('\n')[0], 10);
      if (Number.isInteger(port) && port > 0) return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await delay(50);
  }
  throw new Error('Timed out waiting for background Chromium CDP endpoint');
}

async function terminateProfile(userDataDir: string): Promise<void> {
  for (const pid of await findExactCloakProfileProcesses(userDataDir)) process.kill(pid, 'SIGTERM');
}

const defaultDependencies: Dependencies = {
  buildLaunchOptions,
  humanizeBrowser,
  openApplication,
  activateApplication: async appPath => {
    await execFileAsync('/usr/bin/open', [appPath]);
  },
  readPort: waitForDevToolsPort,
  connectOverCDP: endpoint => chromium.connectOverCDP(endpoint),
  terminateProfile,
  removePortFile: portFile => rm(portFile, { force: true }),
  registerBundle,
};

const contextActivators = new WeakMap<BrowserContext, () => Promise<void>>();

export async function activateDarwinBackgroundContext(context: BrowserContext): Promise<void> {
  await contextActivators.get(context)?.();
}

function appPathFor(executablePath: string): string {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const index = executablePath.lastIndexOf(marker);
  if (index < 0) throw new Error(`Cloak Chromium executable is not inside a macOS app bundle: ${executablePath}`);
  return executablePath.slice(0, index);
}

export async function launchDarwinBackgroundPersistentContext(
  options: LaunchPersistentContextOptions,
  deps: Dependencies = defaultDependencies,
): Promise<BrowserContext> {
  const portFile = path.join(options.userDataDir, 'DevToolsActivePort');
  await deps.removePortFile(portFile);
  const launchOptions = await deps.buildLaunchOptions(options);
  if (!launchOptions.executablePath) throw new Error('Cloak Chromium executable path is missing');
  const appPath = appPathFor(launchOptions.executablePath);

  let browser: Browser | undefined;
  let launched = false;
  try {
    await openApplicationWithLsRegisterRetry(deps, appPath, [
      ...(launchOptions.args ?? []),
      '--password-store=basic',
      '--use-mock-keychain',
      '--disable-popup-blocking',
      '--disable-features=DestroyProfileOnBrowserClose',
      `--user-data-dir=${options.userDataDir}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      'about:blank',
    ]);
    launched = true;
    const port = await deps.readPort(portFile);
    browser = await deps.connectOverCDP(`http://127.0.0.1:${port}`);
    await deps.humanizeBrowser(browser, options);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Background Chromium did not expose a persistent context');
    contextActivators.set(context, () => deps.activateApplication(appPath));
    context.close = async () => {
      try {
        await browser!.close();
      } finally {
        contextActivators.delete(context);
        await deps.terminateProfile(options.userDataDir);
      }
    };
    return context;
  } catch (error) {
    await browser?.close().catch(() => {});
    if (launched) await deps.terminateProfile(options.userDataDir).catch(() => {});
    throw error;
  }
}
