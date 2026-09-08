import { constants } from 'node:fs';
import * as fs from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface GoogleChromeDiscoveryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  realpath?: typeof realpath;
  stat?: typeof stat;
  access?: typeof access;
}

export function googleChromeCandidates(opts: GoogleChromeDiscoveryOptions = {}): string[] {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const homeDir = opts.homeDir ?? os.homedir();

  if (platform === 'darwin') {
    const executable = ['Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'];
    return [
      path.posix.join('/Applications', ...executable),
      path.posix.join(homeDir, 'Applications', ...executable),
    ];
  }

  if (platform === 'win32') {
    return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
      .filter((root): root is string => Boolean(root))
      .map(root => path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  const pathCandidates = (env.PATH ?? '')
    .split(':')
    .filter(Boolean)
    .flatMap(directory => [
      path.posix.join(directory, 'google-chrome'),
      path.posix.join(directory, 'google-chrome-stable'),
    ]);
  return [...new Set([
    ...pathCandidates,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/google-chrome',
  ])];
}

export async function findInstalledGoogleChrome(
  opts: GoogleChromeDiscoveryOptions = {},
): Promise<string | undefined> {
  const resolveRealpath = opts.realpath ?? realpath;
  const inspect = opts.stat ?? stat;
  const checkAccess = opts.access ?? access;
  for (const candidate of googleChromeCandidates(opts)) {
    try {
      const executablePath = await resolveRealpath(candidate);
      if (!(await inspect(executablePath)).isFile()) continue;
      if ((opts.platform ?? process.platform) !== 'win32') {
        await checkAccess(executablePath, constants.X_OK);
      }
      return executablePath;
    } catch {
      // Try the next standard Google Chrome installation location.
    }
  }
  return undefined;
}

export interface ChromeCookieImportOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Returns the directory names directly under the Chrome user-data dir. Injectable for tests. */
  listProfileFolders?: (userDataDir: string) => string[];
  readFileSync?: (path: string, encoding: 'utf-8') => string;
  existsSync?: typeof fs.existsSync;
}

export interface ChromeCookieSource {
  /** Chrome's on-disk profile folder, e.g. "Default" or "Profile 1". */
  folder: string;
  /** Display name from Chrome's Local State, falls back to the folder name. */
  name: string;
  /** Absolute path to the profile's cookie database, if one was found. */
  cookiesPath?: string;
}

/** The root Chrome stores all its profile folders under, one level above "Default". */
export function chromeUserDataDir(opts: ChromeCookieImportOptions = {}): string | undefined {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const homeDir = opts.homeDir ?? os.homedir();
  const platformPath = pathForPlatform(platform);

  if (platform === 'darwin') return platformPath.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome');
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA;
    return base ? platformPath.join(base, 'Google', 'Chrome', 'User Data') : undefined;
  }
  if (platform === 'linux') return platformPath.join(homeDir, '.config', 'google-chrome');
  return undefined;
}

const PROFILE_FOLDER_PATTERN = /^(Default|Profile \d+)$/;

// Chrome moved cookies into a Network/ subfolder for a few releases before
// reverting; check both so this works across the versions users actually have.
function pathForPlatform(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

function findCookiesFile(
  profileDir: string,
  existsSync: typeof fs.existsSync,
  platformPath: typeof path.posix,
): string | undefined {
  return [platformPath.join(profileDir, 'Cookies'), platformPath.join(profileDir, 'Network', 'Cookies')]
    .find(candidate => existsSync(candidate));
}

function readProfileDisplayNames(
  userDataDir: string,
  readFileSync: (path: string, encoding: 'utf-8') => string,
  platformPath: typeof path.posix,
): Record<string, string> {
  try {
    const raw = readFileSync(platformPath.join(userDataDir, 'Local State'), 'utf-8');
    const cache = (JSON.parse(raw) as { profile?: { info_cache?: Record<string, { name?: unknown }> } })
      .profile?.info_cache ?? {};
    const names: Record<string, string> = {};
    for (const [folder, info] of Object.entries(cache)) {
      if (typeof info?.name === 'string' && info.name.trim()) names[folder] = info.name.trim();
    }
    return names;
  } catch {
    return {};
  }
}

/**
 * List the Chrome profiles found on disk, each annotated with whether it has
 * a cookies database to import. Never throws — an unreadable or absent
 * Chrome install just yields an empty list.
 */
export function listChromeCookieSources(opts: ChromeCookieImportOptions = {}): ChromeCookieSource[] {
  const platform = opts.platform ?? process.platform;
  const platformPath = pathForPlatform(platform);
  const userDataDir = chromeUserDataDir(opts);
  const existsSync = opts.existsSync ?? fs.existsSync;
  const readFileSync = opts.readFileSync ?? fs.readFileSync;
  const listProfileFolders = opts.listProfileFolders ?? ((dir: string) => fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name));
  if (!userDataDir || !existsSync(userDataDir)) return [];

  let folders: string[];
  try {
    folders = listProfileFolders(userDataDir).filter(name => PROFILE_FOLDER_PATTERN.test(name)).sort();
  } catch {
    return [];
  }
  const names = readProfileDisplayNames(userDataDir, readFileSync, platformPath);
  return folders.map(folder => ({
    folder,
    name: names[folder] ?? folder,
    cookiesPath: findCookiesFile(platformPath.join(userDataDir, folder), existsSync, platformPath),
  }));
}

/** Find a Chrome profile by its folder name (e.g. "Profile 1") or display name (e.g. "Work"). */
export function findChromeCookieSource(
  source: string,
  opts: ChromeCookieImportOptions = {},
): ChromeCookieSource | undefined {
  const target = source.trim();
  return listChromeCookieSources(opts).find(profile => profile.folder === target || profile.name === target);
}

export interface ImportChromeCookiesIo {
  mkdirSync?: typeof fs.mkdirSync;
  copyFileSync?: typeof fs.copyFileSync;
  existsSync?: typeof fs.existsSync;
}

/**
 * Copy a Chrome profile's cookie database into the "Default" profile
 * Chromium creates inside a webcmd-managed --user-data-dir. Cookies only —
 * no cache, history, extensions, or saved passwords — and no decryption:
 * Chromium decrypts its own Cookies file via the OS keychain at launch time,
 * so this is a plain file copy.
 */
export function importChromeCookies(
  source: ChromeCookieSource,
  targetUserDataDir: string,
  io: ImportChromeCookiesIo = {},
): { imported: boolean; destPath?: string } {
  if (!source.cookiesPath) return { imported: false };
  const mkdirSync = io.mkdirSync ?? fs.mkdirSync;
  const copyFileSync = io.copyFileSync ?? fs.copyFileSync;
  const existsSync = io.existsSync ?? fs.existsSync;

  const destDir = path.join(targetUserDataDir, 'Default');
  mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, 'Cookies');
  copyFileSync(source.cookiesPath, destPath);

  const journalSource = `${source.cookiesPath}-journal`;
  if (existsSync(journalSource)) copyFileSync(journalSource, `${destPath}-journal`);
  return { imported: true, destPath };
}

export interface NativeProfileDirectoryOptions {
  existsSync?: typeof fs.existsSync;
  mkdirSync?: typeof fs.mkdirSync;
  writeFileSync?: typeof fs.writeFileSync;
}

export const NATIVE_PROFILE_SENTINEL_FILE = '.webcmd-exported-profile';

/**
 * Ensures `<userDataDir>/<profileDirectory>` is safe for webcmd to export a
 * profile into: either it doesn't exist yet (webcmd creates it and marks it
 * as its own, reporting `created: true`), or it already carries webcmd's
 * sentinel from a prior export of this same profile (`created: false`).
 * Throws if the directory exists without the sentinel, since that means the
 * name collides with a real native Chrome profile webcmd did not create.
 */
export function ensureNativeProfileDirectory(
  userDataDir: string,
  profileDirectory: string,
  opts: NativeProfileDirectoryOptions = {},
): { created: boolean } {
  const existsSync = opts.existsSync ?? fs.existsSync;
  const mkdirSync = opts.mkdirSync ?? fs.mkdirSync;
  const writeFileSync = opts.writeFileSync ?? fs.writeFileSync;
  const dir = path.join(userDataDir, profileDirectory);
  const sentinelPath = path.join(dir, NATIVE_PROFILE_SENTINEL_FILE);
  if (existsSync(dir)) {
    if (existsSync(sentinelPath)) return { created: false };
    throw new Error(
      `Chrome profile directory "${profileDirectory}" already exists under ${userDataDir} and was not created by webcmd. `
      + 'Choose a different profile name so an existing native Chrome profile is never reused.',
    );
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(sentinelPath, `Created by webcmd Chrome profile export on ${new Date().toISOString()}\n`, 'utf-8');
  return { created: true };
}

export interface ExportCookiesIo {
  existsSync?: typeof fs.existsSync;
  copyFileSync?: typeof fs.copyFileSync;
}

/**
 * Copies a webcmd-managed Chrome profile's cookies into a native Chrome
 * profile folder — the reverse direction of `importChromeCookies`. Cookies
 * only, same scope as import: no cache, history, extensions, or passwords.
 */
export function exportCookiesToNativeChrome(
  source: { cookiesPath: string },
  nativeProfileDir: string,
  io: ExportCookiesIo = {},
): { exported: boolean } {
  const existsSync = io.existsSync ?? fs.existsSync;
  const copyFileSync = io.copyFileSync ?? fs.copyFileSync;
  if (!existsSync(source.cookiesPath)) return { exported: false };
  copyFileSync(source.cookiesPath, path.join(nativeProfileDir, 'Cookies'));
  const journalSource = `${source.cookiesPath}-journal`;
  if (existsSync(journalSource)) copyFileSync(journalSource, path.join(nativeProfileDir, 'Cookies-journal'));
  return { exported: true };
}

/** Checks whether Chrome has registered `profileDirectory` into `Local State`. */
export function isProfileRegisteredInLocalState(
  userDataDir: string,
  profileDirectory: string,
  opts: ChromeCookieImportOptions = {},
): boolean {
  const readFileSync = opts.readFileSync ?? fs.readFileSync;
  try {
    const raw = readFileSync(path.join(userDataDir, 'Local State'), 'utf-8');
    const cache = (JSON.parse(raw) as { profile?: { info_cache?: Record<string, unknown> } }).profile?.info_cache ?? {};
    return Object.prototype.hasOwnProperty.call(cache, profileDirectory);
  } catch {
    return false;
  }
}

export interface SetProfileDisplayNameOptions {
  readFileSync?: typeof fs.readFileSync;
  writeFileSync?: typeof fs.writeFileSync;
}

/**
 * Sets a native Chrome profile's display name in Local State to exactly
 * `name`. Best-effort and silent on any failure — this is cosmetic only;
 * the profile still works correctly with Chrome's own generic name if this
 * fails or never runs.
 */
export function setProfileDisplayName(
  userDataDir: string,
  profileDirectory: string,
  name: string,
  opts: SetProfileDisplayNameOptions = {},
): void {
  const readFileSync = opts.readFileSync ?? fs.readFileSync;
  const writeFileSync = opts.writeFileSync ?? fs.writeFileSync;
  try {
    const localStatePath = path.join(userDataDir, 'Local State');
    const raw = readFileSync(localStatePath, 'utf-8');
    const parsed = JSON.parse(raw) as { profile?: { info_cache?: Record<string, { name?: unknown }> } };
    const entry = parsed.profile?.info_cache?.[profileDirectory];
    if (!entry) return;
    entry.name = name;
    writeFileSync(localStatePath, JSON.stringify(parsed), 'utf-8');
  } catch {
    // Missing/unreadable/malformed Local State: leave the generic name in place.
  }
}
