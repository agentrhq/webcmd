import { posix } from 'node:path';

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

export function findSlabInstallation(io: SlabInstallationIo): SlabInstallation | null {
  if (io.platform !== 'darwin') return null;

  for (const appPath of [
    '/Applications/SLAB.app',
    posix.join(io.homeDir, 'Applications', 'SLAB.app'),
  ]) {
    const executablePath = posix.join(appPath, 'Contents', 'MacOS', 'SLAB');
    if (io.existsSync(executablePath)) return { platform: io.platform, appPath, executablePath };
  }

  return null;
}

export function isSlabInstalled(io: SlabInstallationIo): boolean {
  return findSlabInstallation(io) !== null;
}

export function slabControlEndpoint(homeDir: string): string {
  return posix.join(homeDir, '.slab', 'run', 'slab-bridge.sock');
}
