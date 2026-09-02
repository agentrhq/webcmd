import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { formatBytes } from '../download/progress.js';
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
  fetch(url: string): Promise<{
    ok: boolean;
    json?(): Promise<unknown>;
    arrayBuffer?(): Promise<ArrayBuffer>;
    body?: ReadableStream<Uint8Array> | null;
    headers?: { get(name: string): string | null | undefined };
  }>;
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
  write?(message: string): void | Promise<void>;
}

export interface SlabReplacementIo {
  rename(source: string, destination: string): Promise<void>;
  rm(path: string): Promise<void>;
}

export async function verifySlabApp(
  io: Pick<SlabInstallerIo, 'execFile' | 'bundleId'>,
  appPath: string,
): Promise<void> {
  await io.execFile('codesign', ['--verify', '--deep', '--strict', '--identifier', SLAB_BUNDLE_ID, appPath]);
  if (await io.bundleId(appPath) !== SLAB_BUNDLE_ID) throw new Error('SLAB installer bundle identifier mismatch');
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

function progressBucket(received: number, total?: number): string {
  return total && total > 0 ? String(Math.round((received / total) * 100)) : String(Math.floor(received / (1024 * 1024)));
}

async function writeProgress(io: SlabInstallerIo, received: number, total?: number, done: boolean = false, lastBucket?: string): Promise<string | undefined> {
  if (!io.write) return lastBucket;
  const bucket = progressBucket(received, total);
  if (!done && bucket === lastBucket) return lastBucket;
  const summary = total && total > 0
    ? `${Math.round((received / total) * 100)}% ${formatBytes(received)} / ${formatBytes(total)}`
    : formatBytes(received);
  await io.write(`\rDownloading SLAB DMG: ${summary}${done ? '\n' : ''}`);
  return bucket;
}

async function responseBytes(response: {
  ok: boolean;
  arrayBuffer?(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array> | null;
  headers?: { get(name: string): string | null | undefined };
}, io: SlabInstallerIo): Promise<Buffer> {
  if (!response.ok) throw new Error('SLAB installer download failed');
  const total = Number(response.headers?.get('content-length') ?? '');
  const expectedBytes = Number.isFinite(total) && total > 0 ? total : undefined;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastBucket: string | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.byteLength;
      lastBucket = await writeProgress(io, received, expectedBytes, false, lastBucket);
    }
    await writeProgress(io, received, expectedBytes, true);
    return Buffer.concat(chunks.map(chunk => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
  }
  if (!response.arrayBuffer) throw new Error('SLAB installer download failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeProgress(io, bytes.byteLength, expectedBytes ?? bytes.byteLength, true);
  return bytes;
}

async function clearQuarantine(io: SlabInstallerIo, appPath: string): Promise<void> {
  try {
    await io.execFile('xattr', ['-dr', 'com.apple.quarantine', appPath]);
  } catch (error) {
    const details = [
      error instanceof Error ? error.message : String(error),
      typeof error === 'object' && error && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '',
    ].join('\n');
    if (details.includes('No such xattr') && details.includes('com.apple.quarantine')) return;
    throw error;
  }
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

  const tempPath = await io.mkdtemp(posix.join(io.tempDir, 'webcmd-slab-'));
  const dmgPath = posix.join(tempPath, 'SLAB.dmg');
  const mountPath = posix.join(tempPath, 'mount');
  let stagingPath: string | undefined;
  let mounted = false;

  try {
    const bytes = await responseBytes(await io.fetch(manifest.url), io);
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
      applicationsDir = posix.join(io.homeDir, 'Applications');
      await io.mkdir(applicationsDir);
    }
    const appPath = posix.join(applicationsDir, 'SLAB.app');
    stagingPath = posix.join(applicationsDir, '.SLAB.app.webcmd-staging');
    await io.rm(stagingPath);
    await io.execFile('ditto', [posix.join(mountPath, 'SLAB.app'), stagingPath]);
    await verifySlabApp(io, stagingPath);
    await clearQuarantine(io, stagingPath);
    await io.replaceApp(stagingPath, appPath);
    stagingPath = undefined;
    if (options.launchAfterInstall) await io.execFile('open', [appPath]);
    return { platform: 'darwin', appPath, executablePath: posix.join(appPath, 'Contents', 'MacOS', 'SLAB') };
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
      const result = await execFile('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', posix.join(appPath, 'Contents', 'Info.plist')]);
      return result.stdout.trim();
    },
    replaceApp: (source, destination) => replaceSlabAppAtomically({ rename, rm: async path => { await rm(path, { recursive: true, force: true }); } }, source, destination),
    verifyManifest: verifySlabReleaseManifest,
    write: async message => { process.stderr.write(message); },
  };
}
