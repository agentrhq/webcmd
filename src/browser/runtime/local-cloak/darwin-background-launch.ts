import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { posix as path } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { buildLaunchOptions, humanizeBrowser } from 'cloakbrowser';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';

const execFileAsync = promisify(execFile);

type Dependencies = {
  buildLaunchOptions: typeof buildLaunchOptions;
  humanizeBrowser: typeof humanizeBrowser;
  openApplication: (appPath: string, args: string[]) => Promise<void>;
  activateApplication: (appPath: string) => Promise<void>;
  readPort: (portFile: string) => Promise<number>;
  connectOverCDP: (endpoint: string) => Promise<Browser>;
  terminateProfile: (userDataDir: string) => Promise<void>;
  removePortFile: (portFile: string) => Promise<void>;
};

async function openApplication(appPath: string, args: string[]): Promise<void> {
  await execFileAsync('/usr/bin/open', ['-g', '-n', appPath, '--args', ...args]);
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
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,command=']);
  const needle = `--user-data-dir=${userDataDir}`;
  for (const line of stdout.split('\n')) {
    if (!line.includes(needle)) continue;
    const pid = Number.parseInt(line.trim().split(/\s+/, 1)[0], 10);
    if (Number.isInteger(pid) && pid !== process.pid) process.kill(pid, 'SIGTERM');
  }
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
    await deps.openApplication(appPath, [
      ...(launchOptions.args ?? []),
      '--password-store=basic',
      '--use-mock-keychain',
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
