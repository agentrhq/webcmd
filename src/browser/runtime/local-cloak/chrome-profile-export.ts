import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { isProfileRegisteredInLocalState } from '../../google-chrome.js';
import { findExactChromeProcesses, terminateChromeProcessTree } from './chrome-process.js';

const execFileAsync = promisify(execFile);
const REGISTRATION_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 500;

export interface RegisterNativeChromeProfileDeps {
  launch(executablePath: string, args: string[]): Promise<void>;
  isRegistered(userDataDir: string, profileDirectory: string): boolean;
  findProcesses: typeof findExactChromeProcesses;
  terminate: typeof terminateChromeProcessTree;
  delay(ms: number): Promise<void>;
  now(): number;
  platform: NodeJS.Platform;
}

async function launchViaOpen(executablePath: string, args: string[]): Promise<void> {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const index = executablePath.lastIndexOf(marker);
  if (index < 0) throw new Error(`Configured Chrome executable is not inside a macOS app bundle: ${executablePath}`);
  await execFileAsync('/usr/bin/open', ['-g', '-n', executablePath.slice(0, index), '--args', ...args]);
}

const defaultDeps: RegisterNativeChromeProfileDeps = {
  launch: launchViaOpen,
  isRegistered: isProfileRegisteredInLocalState,
  findProcesses: findExactChromeProcesses,
  terminate: terminateChromeProcessTree,
  delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: Date.now,
  platform: process.platform,
};

/**
 * Makes native Chrome notice a newly exported profile folder by launching it
 * with `--no-startup-window` — no CDP, no visible window, works whether
 * native Chrome is closed (spawns a separate invisible process) or already
 * running (the request is absorbed into the existing process; nothing new
 * to find or kill in that case). Polls `Local State` for registration,
 * bounded by REGISTRATION_TIMEOUT_MS, and always kills any process this
 * call itself spawned before returning — registration confirmed or not.
 */
export async function registerNativeChromeProfile(
  executablePath: string,
  userDataDir: string,
  profileDirectory: string,
  deps: RegisterNativeChromeProfileDeps = defaultDeps,
): Promise<{ registered: boolean }> {
  await deps.launch(executablePath, [
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDirectory}`,
    '--no-startup-window',
    '--no-first-run',
  ]);

  const identity = { executablePath, userDataDir, profileDirectory };
  const deadline = deps.now() + REGISTRATION_TIMEOUT_MS;
  let registered = deps.isRegistered(userDataDir, profileDirectory);
  while (!registered && deps.now() < deadline) {
    await deps.delay(POLL_INTERVAL_MS);
    registered = deps.isRegistered(userDataDir, profileDirectory);
  }

  for (const pid of await deps.findProcesses(identity, deps.platform)) {
    await deps.terminate(pid, deps.platform, false);
  }
  return { registered };
}
