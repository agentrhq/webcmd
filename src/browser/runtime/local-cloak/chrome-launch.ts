import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { buildLaunchOptions, humanizeBrowser } from 'cloakbrowser';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';
import {
  findExactChromeProcesses,
  listenerBelongsToProcess,
  terminateChromeProcessTree,
  type ChromeProcessIdentity,
} from './chrome-process.js';

const execFileAsync = promisify(execFile);
const MAX_LAUNCH_ATTEMPTS = 3;
const READINESS_TIMEOUT_MS = 10_000;

export interface ChromeLaunchDependencies {
  buildLaunchOptions: typeof buildLaunchOptions;
  humanizeBrowser: typeof humanizeBrowser;
  allocatePort(): Promise<number>;
  launch(executablePath: string, args: string[], platform: NodeJS.Platform): Promise<number | undefined>;
  findProcesses(identity: ChromeProcessIdentity, platform: NodeJS.Platform): Promise<number[]>;
  listenerOwnedBy(port: number, pid: number, platform: NodeJS.Platform): Promise<boolean>;
  endpointReady(endpoint: string): Promise<boolean>;
  connectOverCDP(endpoint: string): Promise<Browser>;
  terminate(pid: number, platform: NodeJS.Platform, force?: boolean): Promise<void>;
  activate(executablePath: string, platform: NodeJS.Platform): Promise<void>;
  delay(ms: number): Promise<void>;
  now(): number;
  platform: NodeJS.Platform;
}

const chromeContextActivators = new WeakMap<BrowserContext, () => Promise<void>>();

export async function activateChromeContext(context: BrowserContext): Promise<void> {
  await chromeContextActivators.get(context)?.();
}

export async function allocateNonzeroLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (!Number.isInteger(port) || port <= 0) throw new Error('Failed to allocate a nonzero Chrome CDP port');
  return port;
}

export function chromeLaunchArgs(baseArgs: readonly string[], userDataDir: string, port: number): string[] {
  const filtered = baseArgs.filter(arg => arg !== '--enable-automation'
    && !arg.startsWith('--headless')
    && arg !== '--remote-debugging-pipe'
    && !arg.startsWith('--remote-debugging-port=')
    && !arg.startsWith('--remote-debugging-address=')
    && !arg.startsWith('--user-data-dir='));
  return [
    ...filtered,
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    'about:blank',
  ];
}

async function launchProcess(executablePath: string, args: string[], platform: NodeJS.Platform): Promise<number | undefined> {
  if (platform === 'darwin') {
    const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
    const index = executablePath.lastIndexOf(marker);
    if (index < 0) throw new Error(`Configured Chrome executable is not inside a macOS app bundle: ${executablePath}`);
    await execFileAsync('/usr/bin/open', ['-g', '-n', executablePath.slice(0, index), '--args', ...args]);
    return undefined;
  }
  const child = spawn(executablePath, args, { detached: false, stdio: 'ignore', windowsHide: true });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
  const pid = child.pid;
  child.unref();
  return pid;
}

async function endpointReady(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return false;
    const body = await response.json() as { webSocketDebuggerUrl?: unknown };
    return typeof body.webSocketDebuggerUrl === 'string';
  } catch {
    return false;
  }
}

async function activate(executablePath: string, platform: NodeJS.Platform): Promise<void> {
  if (platform !== 'darwin') return;
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const index = executablePath.lastIndexOf(marker);
  if (index >= 0) await execFileAsync('/usr/bin/open', [executablePath.slice(0, index)]);
}

const defaultDependencies: ChromeLaunchDependencies = {
  buildLaunchOptions,
  humanizeBrowser,
  allocatePort: allocateNonzeroLoopbackPort,
  launch: launchProcess,
  findProcesses: findExactChromeProcesses,
  listenerOwnedBy: listenerBelongsToProcess,
  endpointReady,
  connectOverCDP: endpoint => chromium.connectOverCDP(endpoint),
  terminate: terminateChromeProcessTree,
  activate,
  delay: ms => delay(ms),
  now: Date.now,
  platform: process.platform,
};

export async function launchChromePersistentContext(
  options: LaunchPersistentContextOptions,
  deps: ChromeLaunchDependencies = defaultDependencies,
): Promise<BrowserContext> {
  const launchOptions = await deps.buildLaunchOptions(options);
  const executablePath = launchOptions.executablePath;
  if (!executablePath) throw new Error('Configured Chrome executable path is missing');
  if ((await deps.findProcesses({ executablePath, userDataDir: options.userDataDir }, deps.platform)).length > 0) {
    throw new Error('Opening in existing browser session. The Webcmd Chrome Profile is already in use.');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt += 1) {
    const port = await deps.allocatePort();
    const identity = { executablePath, userDataDir: options.userDataDir, port };
    let browser: Browser | undefined;
    let pids: number[] = [];
    let launchedPid: number | undefined;
    try {
      const args = chromeLaunchArgs(launchOptions.args ?? [], options.userDataDir, port);
      launchedPid = await deps.launch(executablePath, args, deps.platform);
      const endpoint = `http://127.0.0.1:${port}`;
      const deadline = deps.now() + READINESS_TIMEOUT_MS;
      while (deps.now() < deadline) {
        pids = await deps.findProcesses(identity, deps.platform);
        if (launchedPid && !pids.includes(launchedPid)) pids.push(launchedPid);
        if (pids.length === 1
          && await deps.endpointReady(endpoint)
          && await deps.listenerOwnedBy(port, pids[0], deps.platform)) break;
        await deps.delay(50);
      }
      if (pids.length !== 1
        || !await deps.endpointReady(endpoint)
        || !await deps.listenerOwnedBy(port, pids[0], deps.platform)) {
        throw new Error('Timed out verifying the Webcmd-owned Chrome CDP endpoint');
      }

      browser = await deps.connectOverCDP(endpoint);
      await deps.humanizeBrowser(browser, options);
      const context = browser.contexts()[0];
      if (!context) throw new Error('Chrome did not expose a persistent default context');
      chromeContextActivators.set(context, () => deps.activate(executablePath, deps.platform));
      context.close = async () => {
        try {
          await browser!.close();
        } finally {
          chromeContextActivators.delete(context);
          await terminateOwnedProcesses(deps, identity, pids);
        }
      };
      return context;
    } catch (error) {
      lastError = error;
      await browser?.close().catch(() => {});
      await terminateOwnedProcesses(deps, identity, launchedPid ? [...pids, launchedPid] : pids);
    }
  }
  throw new Error(`Failed to launch Webcmd-managed Chrome after ${MAX_LAUNCH_ATTEMPTS} attempts`, { cause: lastError });
}

async function terminateOwnedProcesses(
  deps: ChromeLaunchDependencies,
  identity: ChromeProcessIdentity,
  knownPids: number[],
): Promise<void> {
  const pids = [...new Set([...knownPids, ...await deps.findProcesses(identity, deps.platform)])];
  for (const pid of pids) await deps.terminate(pid, deps.platform, false);
  if (pids.length === 0) return;
  await deps.delay(250);
  const survivors = await deps.findProcesses(identity, deps.platform);
  for (const pid of survivors) await deps.terminate(pid, deps.platform, true);
}
