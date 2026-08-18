import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SlabInstallation } from './installation.js';
import { type SlabReleaseManifest, verifySlabReleaseManifest } from './release-key.js';

const execFileAsync = promisify(execFileCallback);
export const SLAB_MACOS_MANIFEST_URL = 'https://downloads.webcmd.dev/slab/stable/macos.json';
const SLAB_BUNDLE_ID = 'dev.webcmd.slab';

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer | Uint8Array>;
};

export interface SlabInstallerIo {
  homeDir: string;
  tempDir: string;
  fetch(url: string): Promise<FetchResponse>;
  execFile(command: string, args: string[]): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  sha256?(bytes: Uint8Array): Promise<string>;
  mkdir(path: string): Promise<void>;
  rm(path: string): Promise<void>;
  access(path: string): Promise<void>;
  replaceApp(source: string, destination: string): Promise<void>;
  verifyManifest?(manifest: SlabReleaseManifest): Promise<boolean> | boolean;
  bundleId?(appPath: string): Promise<string>;
}

export interface InstallSlabOptions {
  launchAfterInstall?: boolean;
}

function manifestFrom(value: unknown): SlabReleaseManifest {
  if (!value || typeof value !== 'object') throw new Error('SLAB installer release manifest is invalid');
  const { url, sha256, signature } = value as Record<string, unknown>;
  if (typeof url !== 'string' || typeof sha256 !== 'string' || typeof signature !== 'string') {
    throw new Error('SLAB installer release manifest is invalid');
  }
  return { url, sha256, signature };
}

async function responseJson(response: FetchResponse): Promise<unknown> {
  if (!response.ok || !response.json) throw new Error(`SLAB installer download failed${response.status ? ` (${response.status})` : ''}`);
  return response.json();
}

async function responseBytes(response: FetchResponse): Promise<Uint8Array> {
  if (!response.ok || !response.arrayBuffer) throw new Error(`SLAB installer download failed${response.status ? ` (${response.status})` : ''}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function installSlabMacos(io: SlabInstallerIo, options: InstallSlabOptions = {}): Promise<SlabInstallation> {
  const manifest = manifestFrom(await responseJson(await io.fetch(SLAB_MACOS_MANIFEST_URL)));
  if (!await (io.verifyManifest?.(manifest) ?? verifySlabReleaseManifest(manifest))) {
    throw new Error('SLAB installer release signature verification failed');
  }

  const tempPath = await io.mkdtemp(join(io.tempDir, 'webcmd-slab-'));
  const dmgPath = join(tempPath, 'SLAB.dmg');
  const mountPath = join(tempPath, 'mount');
  const stagingPath = join(tempPath, 'SLAB.app');
  let mounted = false;

  try {
    const bytes = await responseBytes(await io.fetch(manifest.url));
    await io.writeFile(dmgPath, bytes);
    const checksum = await (io.sha256?.(bytes) ?? Promise.resolve(createHash('sha256').update(bytes).digest('hex')));
    if (checksum.toLowerCase() !== manifest.sha256.toLowerCase()) throw new Error('SLAB installer checksum mismatch');

    await io.mkdir(mountPath);
    await io.execFile('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPath, dmgPath]);
    mounted = true;
    await io.execFile('ditto', [join(mountPath, 'SLAB.app'), stagingPath]);
    await io.execFile('codesign', ['--verify', '--deep', '--strict', '--identifier', SLAB_BUNDLE_ID, stagingPath]);
    const bundleId = await io.bundleId?.(stagingPath);
    if (bundleId && bundleId !== SLAB_BUNDLE_ID) throw new Error('SLAB installer bundle identifier mismatch');
    await io.execFile('spctl', ['--assess', '--type', 'execute', '--verbose=4', stagingPath]);

    let applicationsDir = '/Applications';
    try {
      await io.access(applicationsDir);
    } catch {
      applicationsDir = join(io.homeDir, 'Applications');
      await io.mkdir(applicationsDir);
    }
    const appPath = join(applicationsDir, 'SLAB.app');
    await io.replaceApp(stagingPath, appPath);
    if (options.launchAfterInstall) await io.execFile('open', [appPath]);
    return { platform: 'darwin', executablePath: join(appPath, 'Contents/MacOS/SLAB') };
  } finally {
    try {
      if (mounted) await io.execFile('hdiutil', ['detach', mountPath]);
    } finally {
      await io.rm(tempPath);
    }
  }
}

export function createSlabInstallerIo(): SlabInstallerIo {
  return {
    homeDir: homedir(),
    tempDir: tmpdir(),
    fetch: globalThis.fetch,
    execFile: async (command, args) => { await execFileAsync(command, args); },
    mkdtemp,
    writeFile,
    mkdir: async (path) => { await mkdir(path, { recursive: true }); },
    rm: async (path) => { await rm(path, { recursive: true, force: true }); },
    access: async (path) => { await access(path); },
    replaceApp: async (source, destination) => {
      const previous = `${destination}.previous`;
      await rm(previous, { recursive: true, force: true });
      try { await rename(destination, previous); } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        await rename(source, destination);
      } catch (error) {
        await rename(previous, destination).catch(() => {});
        throw error;
      }
      await rm(previous, { recursive: true, force: true });
    },
  };
}
