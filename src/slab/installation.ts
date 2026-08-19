export interface SlabInstallation {
  platform: NodeJS.Platform;
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

  for (const executablePath of [
    '/Applications/SLAB.app/Contents/MacOS/SLAB',
    `${io.homeDir}/Applications/SLAB.app/Contents/MacOS/SLAB`,
  ]) {
    if (io.existsSync(executablePath)) return { platform: io.platform, executablePath };
  }

  return null;
}

export function isSlabInstalled(io: SlabInstallationIo): boolean {
  return findSlabInstallation(io) !== null;
}
