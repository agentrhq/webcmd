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

  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome');
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA;
    return base ? path.win32.join(base, 'Google', 'Chrome', 'User Data') : undefined;
  }
  if (platform === 'linux') return path.join(homeDir, '.config', 'google-chrome');
  return undefined;
}

const PROFILE_FOLDER_PATTERN = /^(Default|Profile \d+)$/;

// Chrome moved cookies into a Network/ subfolder for a few releases before
// reverting; check both so this works across the versions users actually have.
function findCookiesFile(profileDir: string, existsSync: typeof fs.existsSync): string | undefined {
  return [path.join(profileDir, 'Cookies'), path.join(profileDir, 'Network', 'Cookies')]
    .find(candidate => existsSync(candidate));
}

function readProfileDisplayNames(
  userDataDir: string,
  readFileSync: (path: string, encoding: 'utf-8') => string,
): Record<string, string> {
  try {
    const raw = readFileSync(path.join(userDataDir, 'Local State'), 'utf-8');
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
  const names = readProfileDisplayNames(userDataDir, readFileSync);
  return folders.map(folder => ({
    folder,
    name: names[folder] ?? folder,
    cookiesPath: findCookiesFile(path.join(userDataDir, folder), existsSync),
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
