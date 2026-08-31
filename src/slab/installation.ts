import { execFile as execFileCallback } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

export interface SlabInstallation {
  platform: NodeJS.Platform;
  appPath: string;
  executablePath: string;
  version?: string;
}

export interface SlabInstallationIo {
  platform: NodeJS.Platform;
  homeDir: string;
  existsSync(path: string): boolean;
}

export interface SlabInstallationValidationIo {
  access(path: string, mode: number): Promise<void>;
  bundleId(appPath: string): Promise<string>;
  execFile(command: string, args: string[]): Promise<unknown>;
}

const execFile = promisify(execFileCallback);
const SLAB_BUNDLE_ID = 'dev.webcmd.slab';

export function findSlabInstallation(io: SlabInstallationIo): SlabInstallation | null {
  if (io.platform !== 'darwin') return null;

  for (const appPath of [
    '/Applications/SLAB.app',
    join(io.homeDir, 'Applications', 'SLAB.app'),
  ]) {
    const executablePath = join(appPath, 'Contents', 'MacOS', 'SLAB');
    if (io.existsSync(executablePath)) return { platform: io.platform, appPath, executablePath };
  }

  return null;
}

export function isSlabInstalled(io: SlabInstallationIo): boolean {
  return findSlabInstallation(io) !== null;
}

export function slabControlEndpoint(homeDir: string): string {
  return join(homeDir, '.slab', 'run', 'slab-bridge.sock');
}

export async function validateSlabInstallation(
  installation: SlabInstallation,
  io: SlabInstallationValidationIo = createSlabInstallationValidationIo(),
): Promise<boolean> {
  try {
    await io.access(installation.executablePath, constants.X_OK);
    if (await io.bundleId(installation.appPath) !== SLAB_BUNDLE_ID) return false;
    await io.execFile('codesign', ['--verify', '--deep', '--strict', '--identifier', SLAB_BUNDLE_ID, installation.appPath]);
    return true;
  } catch {
    return false;
  }
}

export function createSlabInstallationValidationIo(): SlabInstallationValidationIo {
  return {
    access,
    bundleId: async appPath => {
      const result = await execFile('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(appPath, 'Contents', 'Info.plist')]);
      return result.stdout.trim();
    },
    execFile: async (command, args) => execFile(command, args),
  };
}
