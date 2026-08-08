import { execFile } from 'node:child_process';
import fs from 'node:fs';

/**
 * Discovery and signalling of the Cloak Chromium processes that own a profile
 * directory.
 *
 * Shared by launch recovery (`session-manager.ts`) and background-profile
 * teardown (`darwin-background-launch.ts`) so both agree on which processes
 * belong to a profile. `session-manager.ts` already imports
 * `darwin-background-launch.ts`, so the matching cannot live in either of them
 * without a cycle.
 */

export async function findCloakProfileProcesses(userDataDir: string): Promise<number[]> {
  const profileDirs = profileDirAliases(userDataDir);
  const stdout = await psOutput();
  const pids: number[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    if (!isCloakBrowserCommand(command)) continue;
    if (!commandUsesProfileDir(command, profileDirs)) continue;
    pids.push(pid);
  }
  return [...new Set(pids)];
}

export function signalPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already exited or not signalable; the follow-up poll decides recovery.
    }
  }
}

export function commandUsesProfileDir(command: string, profileDirs: string[]): boolean {
  for (const dir of profileDirs) {
    const marker = `--user-data-dir=${dir}`;
    const index = command.indexOf(marker);
    if (index < 0) continue;
    // The flag value must end here: profile ids may share a prefix
    // (`work` / `work-2`), so a substring match would claim a sibling
    // profile's Chromium.
    const next = command[index + marker.length];
    if (next === undefined || /\s/.test(next)) return true;
  }
  return false;
}

export function profileDirAliases(userDataDir: string): string[] {
  const aliases = new Set([userDataDir]);
  try {
    aliases.add(fs.realpathSync.native(userDataDir));
  } catch {
    // The launch path is still useful even if realpath cannot resolve it.
  }
  return [...aliases];
}

export function isCloakBrowserCommand(command: string): boolean {
  return command.includes('/.cloakbrowser/') || command.includes('\\.cloakbrowser\\');
}

function psOutput(): Promise<string> {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 2000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}
