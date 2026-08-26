import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { verifySlabReleaseManifest, type SlabReleaseManifest } from './release-key.js';
import type { SlabInstallation } from './installation.js';

const execFile = promisify(execFileCallback);

export const SLAB_BUNDLE_ID = 'dev.webcmd.slab';
export const SLAB_RELEASE_MANIFEST_URL = 'https://downloads.webcmd.dev/slab/macos-arm64.json';

export interface InstallSlabOptions {
  launchAfterInstall?: boolean;
  manifestUrl?: string;
}

export interface SlabInstallerIo {
  homeDir: string;
  tempDir: string;
  fetch(url: string): Promise<{ ok: boolean; json?(): Promise<unknown>; arrayBuffer?(): Promise<ArrayBuffer> }>;
  execFile(command: string, args: string[]): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  sha256?(bytes: Uint8Array): Promise<string>;
  mkdir(path: string): Promise<void>;
  rm(path: string): Promise<void>;
  access(path: string, mode: number): Promise<void>;
  bundleId(appPath: string): Promise<string>;
  replaceApp(source: string, destination: string): Promise<void>;
  verifyManifest(manifest: SlabReleaseManifest): boolean | Promise<boolean>;
}

export interface SlabReplacementIo {
  rename(source: string, destination: string): Promise<void>;
  rm(path: string): Promise<void>;
}

function parseManifest(value: unknown): SlabReleaseManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SLAB installer release manifest is invalid');
  const manifest = value as Partial<SlabReleaseManifest>;
  if (typeof manifest.url !== 'string' || typeof manifest.sha256 !== 'string' || typeof manifest.signature !== 'string') {
    throw new Error('SLAB installer release manifest is invalid');
  }
  return { url: manifest.url, sha256: manifest.sha256, signature: manifest.signature };
}

async function responseJson(response: { ok: boolean; json?(): Promise<unknown> }): Promise<unknown> {
  if (!response.ok || !response.json) throw new Error('SLAB installer release manifest download failed');
  return response.json();
}

async function responseBytes(response: { ok: boolean; arrayBuffer?(): Promise<ArrayBuffer> }): Promise<Buffer> {
  if (!response.ok || !response.arrayBuffer) throw new Error('SLAB installer download failed');
  return Buffer.from(await response.arrayBuffer());
}

export async function replaceSlabAppAtomically(io: SlabReplacementIo, source: string, destination: string): Promise<void> {
  const previous = `${destination}.previous`;
  await io.rm(previous);
  try {
    await io.rename(destination, previous);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await io.rename(source, destination);
  } catch (error) {
    await io.rename(previous, destination).catch(() => undefined);
    throw error;
  }
  await io.rm(previous);
}

export async function installSlabMacos(io: SlabInstallerIo = createSlabInstallerIo(), options: InstallSlabOptions = {}): Promise<SlabInstallation> {
  const manifestResponse = await io.fetch(options.manifestUrl ?? SLAB_RELEASE_MANIFEST_URL);
  const manifest = parseManifest(await responseJson(manifestResponse));
  if (!await io.verifyManifest(manifest)) throw new Error('SLAB installer release signature verification failed');

  const tempPath = await io.mkdtemp(join(io.tempDir, 'webcmd-slab-'));
  const dmgPath = join(tempPath, 'SLAB.dmg');
  const mountPath = join(tempPath, 'mount');
  let stagingPath: string | undefined;
  let mounted = false;

  try {
    const bytes = await responseBytes(await io.fetch(manifest.url));
    await io.writeFile(dmgPath, bytes);
    const checksum = await (io.sha256?.(bytes) ?? Promise.resolve(createHash('sha256').update(bytes).digest('hex')));
    if (checksum.toLowerCase() !== manifest.sha256.toLowerCase()) throw new Error('SLAB installer checksum mismatch');

    await io.mkdir(mountPath);
    await io.execFile('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPath, dmgPath]);
    mounted = true;

    let applicationsDir = '/Applications';
    try {
      await io.access(applicationsDir, constants.W_OK);
    } catch {
      applicationsDir = join(io.homeDir, 'Applications');
      await io.mkdir(applicationsDir);
    }
    const appPath = join(applicationsDir, 'SLAB.app');
    stagingPath = join(applicationsDir, '.SLAB.app.webcmd-staging');
    await io.rm(stagingPath);
    await io.execFile('ditto', [join(mountPath, 'SLAB.app'), stagingPath]);
    await io.execFile('codesign', ['--verify', '--deep', '--strict', '--identifier', SLAB_BUNDLE_ID, stagingPath]);
    if (await io.bundleId(stagingPath) !== SLAB_BUNDLE_ID) throw new Error('SLAB installer bundle identifier mismatch');
    await io.execFile('spctl', ['--assess', '--type', 'execute', '--verbose=4', stagingPath]);
    await io.replaceApp(stagingPath, appPath);
    stagingPath = undefined;
    if (options.launchAfterInstall) await io.execFile('open', [appPath]);
    return { platform: 'darwin', appPath, executablePath: join(appPath, 'Contents', 'MacOS', 'SLAB') };
  } finally {
    try {
      if (mounted) await io.execFile('hdiutil', ['detach', mountPath]);
    } finally {
      if (stagingPath) await io.rm(stagingPath);
      await io.rm(tempPath);
    }
  }
}

export function createSlabInstallerIo(): SlabInstallerIo {
  return {
    homeDir: homedir(),
    tempDir: tmpdir(),
    fetch: globalThis.fetch,
    execFile: async (command, args) => execFile(command, args),
    mkdtemp,
    writeFile,
    mkdir: async path => { await mkdir(path, { recursive: true }); },
    rm: async path => { await rm(path, { recursive: true, force: true }); },
    access,
    bundleId: async appPath => {
      const result = await execFile('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(appPath, 'Contents', 'Info.plist')]);
      return result.stdout.trim();
    },
    replaceApp: (source, destination) => replaceSlabAppAtomically({ rename, rm: async path => { await rm(path, { recursive: true, force: true }); } }, source, destination),
    verifyManifest: verifySlabReleaseManifest,
  };
}
