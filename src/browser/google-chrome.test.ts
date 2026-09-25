import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  chromeUserDataDir,
  ensureNativeProfileDirectory,
  exportCookiesToNativeChrome,
  findChromeCookieSource,
  findInstalledGoogleChrome,
  googleChromeCandidates,
  importChromeCookies,
  isProfileRegisteredInLocalState,
  listChromeCookieSources,
  setProfileDisplayName,
} from './google-chrome.js';

describe('Google Chrome discovery', () => {
  it('checks system and user application folders on macOS', () => {
    expect(googleChromeCandidates({ platform: 'darwin', homeDir: '/Users/test', env: {} })).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
  });

  it('checks Google Chrome installation locations on Windows', () => {
    expect(googleChromeCandidates({
      platform: 'win32',
      homeDir: 'C:\\Users\\test',
      env: {
        PROGRAMFILES: 'C:\\Program Files',
        'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
        LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
      },
    })).toEqual([
      path.win32.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.win32.join('C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.win32.join('C:\\Users\\test\\AppData\\Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
  });

  it('checks PATH and standard Google Chrome locations on Linux', () => {
    expect(googleChromeCandidates({
      platform: 'linux',
      homeDir: '/home/test',
      env: { PATH: '/custom/bin:/usr/local/bin' },
    })).toContain('/custom/bin/google-chrome');
    expect(googleChromeCandidates({ platform: 'linux', homeDir: '/home/test', env: {} }))
      .toContain('/opt/google/chrome/google-chrome');
  });

  it('reuses the first launchable Google Chrome installation', async () => {
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const userChrome = '/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const canonicalUserChrome = '/private/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const resolveRealpath = vi.fn(async (candidate: string) => {
      if (candidate === systemChrome) throw new Error('missing');
      if (candidate === userChrome) return canonicalUserChrome;
      throw new Error('unexpected candidate');
    });

    await expect(findInstalledGoogleChrome({
      platform: 'darwin',
      homeDir: '/Users/test',
      env: {},
      realpath: resolveRealpath as never,
      stat: (async () => ({ isFile: () => true })) as never,
      access: (async () => undefined) as never,
    })).resolves.toBe(canonicalUserChrome);
  });
});

describe('Chrome cookie import', () => {
  it('resolves the Chrome user-data dir per platform', () => {
    expect(chromeUserDataDir({ platform: 'darwin', homeDir: '/Users/test' }))
      .toBe('/Users/test/Library/Application Support/Google/Chrome');
    expect(chromeUserDataDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' } }))
      .toBe(path.win32.join('C:\\Users\\test\\AppData\\Local', 'Google', 'Chrome', 'User Data'));
    expect(chromeUserDataDir({ platform: 'win32', env: {} })).toBeUndefined();
    expect(chromeUserDataDir({ platform: 'linux', homeDir: '/home/test' })).toBe('/home/test/.config/google-chrome');
  });

  it('lists profiles found on disk with their display name and cookies path', () => {
    const userDataDir = '/Users/test/Library/Application Support/Google/Chrome';
    const sources = listChromeCookieSources({
      platform: 'darwin',
      homeDir: '/Users/test',
      existsSync: (candidate) => [
        userDataDir,
        path.posix.join(userDataDir, 'Default', 'Cookies'),
        path.posix.join(userDataDir, 'Profile 1', 'Network', 'Cookies'),
      ].includes(candidate as string),
      listProfileFolders: (dir) => {
        expect(dir).toBe(userDataDir);
        return ['Default', 'Profile 1', 'Profile 2', 'System Profile'];
      },
      readFileSync: () => JSON.stringify({
        profile: { info_cache: { Default: { name: 'Person 1' }, 'Profile 1': { name: 'Work' } } },
      }),
    });

    expect(sources).toEqual([
      { folder: 'Default', name: 'Person 1', cookiesPath: path.posix.join(userDataDir, 'Default', 'Cookies') },
      { folder: 'Profile 1', name: 'Work', cookiesPath: path.posix.join(userDataDir, 'Profile 1', 'Network', 'Cookies') },
      { folder: 'Profile 2', name: 'Profile 2', cookiesPath: undefined },
    ]);
  });

  it('uses Windows separators throughout profile discovery when targeting Windows', () => {
    const userDataDir = 'C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\User Data';
    const defaultCookies = path.win32.join(userDataDir, 'Default', 'Cookies');
    const localState = path.win32.join(userDataDir, 'Local State');
    const readFileSync = vi.fn((candidate: string) => {
      expect(candidate).toBe(localState);
      return JSON.stringify({ profile: { info_cache: { Default: { name: 'Personal' } } } });
    });

    const sources = listChromeCookieSources({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      existsSync: candidate => candidate === userDataDir || candidate === defaultCookies,
      listProfileFolders: dir => {
        expect(dir).toBe(userDataDir);
        return ['Default'];
      },
      readFileSync,
    });

    expect(sources).toEqual([
      { folder: 'Default', name: 'Personal', cookiesPath: defaultCookies },
    ]);
    expect(readFileSync).toHaveBeenCalledOnce();
  });

  it('returns an empty list when Chrome is not installed', () => {
    expect(listChromeCookieSources({ platform: 'darwin', homeDir: '/Users/test', existsSync: () => false }))
      .toEqual([]);
  });

  it('finds a source profile by folder name or display name', () => {
    const opts = {
      platform: 'darwin' as const,
      homeDir: '/Users/test',
      existsSync: () => true,
      listProfileFolders: () => ['Default'],
      readFileSync: () => JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } } }),
    };
    expect(findChromeCookieSource('Default', opts)?.cookiesPath).toContain('Default/Cookies');
    expect(findChromeCookieSource('Person 1', opts)?.cookiesPath).toContain('Default/Cookies');
    expect(findChromeCookieSource('Nope', opts)).toBeUndefined();
  });

  it('copies the cookies database and journal into the target profile', () => {
    const copyFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const result = importChromeCookies(
      { folder: 'Default', name: 'Default', cookiesPath: '/chrome/Default/Cookies' },
      '/webcmd/chrome/profiles/default',
      {
        mkdirSync,
        copyFileSync,
        existsSync: (candidate) => candidate === '/chrome/Default/Cookies-journal',
      },
    );

    expect(mkdirSync).toHaveBeenCalledWith(path.join('/webcmd/chrome/profiles/default', 'Default'), { recursive: true });
    expect(copyFileSync).toHaveBeenCalledWith(
      '/chrome/Default/Cookies',
      path.join('/webcmd/chrome/profiles/default', 'Default', 'Cookies'),
    );
    expect(copyFileSync).toHaveBeenCalledWith(
      '/chrome/Default/Cookies-journal',
      path.join('/webcmd/chrome/profiles/default', 'Default', 'Cookies-journal'),
    );
    expect(result).toEqual({ imported: true, destPath: path.join('/webcmd/chrome/profiles/default', 'Default', 'Cookies') });
  });

  it('does nothing when the source has no cookies database', () => {
    const copyFileSync = vi.fn();
    const result = importChromeCookies({ folder: 'Default', name: 'Default' }, '/webcmd/chrome/profiles/default', { copyFileSync });
    expect(copyFileSync).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: false });
  });
});

describe('ensureNativeProfileDirectory', () => {
  const chromeRoot = path.join('Users', 'test', 'Chrome');

  it('creates a fresh directory, marks it, and reports it created', () => {
    const written: Record<string, string> = {};
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn((filePath: string, content: string) => { written[filePath] = content; });

    const result = ensureNativeProfileDirectory(chromeRoot, 'webcmd-work', {
      existsSync: () => false,
      mkdirSync: mkdirSync as unknown as typeof import('node:fs').mkdirSync,
      writeFileSync: writeFileSync as unknown as typeof import('node:fs').writeFileSync,
    });

    expect(result).toEqual({ created: true });
    const dir = path.join(chromeRoot, 'webcmd-work');
    expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
    expect(Object.keys(written)).toEqual([path.join(dir, '.webcmd-exported-profile')]);
  });

  it('reports not created when reusing a directory it made before', () => {
    const dir = path.join(chromeRoot, 'webcmd-work');
    const sentinel = path.join(dir, '.webcmd-exported-profile');
    const mkdirSync = vi.fn();

    const result = ensureNativeProfileDirectory(chromeRoot, 'webcmd-work', {
      existsSync: candidate => candidate === dir || candidate === sentinel,
      mkdirSync: mkdirSync as unknown as typeof import('node:fs').mkdirSync,
    });

    expect(result).toEqual({ created: false });
    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it('refuses to reuse a directory it did not create', () => {
    const dir = path.join(chromeRoot, 'Default');
    expect(() => ensureNativeProfileDirectory(chromeRoot, 'Default', {
      existsSync: candidate => candidate === dir,
    })).toThrow(/already exists.*was not created by webcmd/s);
  });
});

describe('exportCookiesToNativeChrome', () => {
  it('copies the webcmd profile Cookies file and its journal into the native folder', () => {
    const written: Record<string, string> = {};
    const copyFileSync = vi.fn((from: string, to: string) => { written[to] = from; });
    const sourceCookies = path.join('Users', 'test', '.webcmd', 'chrome', 'profiles', 'work', 'Default', 'Cookies');
    const nativeProfileDir = path.join('Users', 'test', 'Chrome', 'webcmd-work');

    const result = exportCookiesToNativeChrome(
      { cookiesPath: sourceCookies },
      nativeProfileDir,
      {
        existsSync: candidate => candidate === sourceCookies || candidate === `${sourceCookies}-journal`,
        copyFileSync: copyFileSync as unknown as typeof import('node:fs').copyFileSync,
      },
    );

    expect(result).toEqual({ exported: true });
    expect(written[path.join(nativeProfileDir, 'Cookies')]).toBe(sourceCookies);
    expect(written[path.join(nativeProfileDir, 'Cookies-journal')]).toBe(`${sourceCookies}-journal`);
  });
});

describe('isProfileRegisteredInLocalState', () => {
  const chromeRoot = path.join('Users', 'test', 'Chrome');

  it('reports true once the profile-directory key appears in Local State', () => {
    const readFileSync = () => JSON.stringify({ profile: { info_cache: { 'webcmd-work': { name: 'Work' } } } });
    expect(isProfileRegisteredInLocalState(chromeRoot, 'webcmd-work', { readFileSync })).toBe(true);
    expect(isProfileRegisteredInLocalState(chromeRoot, 'someone-else', { readFileSync })).toBe(false);
  });

  it('reports false when Local State is missing or unreadable', () => {
    const readFileSync = () => { throw new Error('ENOENT'); };
    expect(isProfileRegisteredInLocalState(chromeRoot, 'webcmd-work', { readFileSync })).toBe(false);
  });
});

describe('setProfileDisplayName', () => {
  const chromeRoot = path.join('Users', 'test', 'Chrome');
  const localStatePath = path.join(chromeRoot, 'Local State');

  it('sets the name when the entry exists', () => {
    const writeFileSync = vi.fn();
    setProfileDisplayName(chromeRoot, 'test1', 'test1', {
      readFileSync: (() => JSON.stringify({ profile: { info_cache: { test1: { name: 'Person 2' } } } })) as unknown as typeof import('node:fs').readFileSync,
      writeFileSync: writeFileSync as unknown as typeof import('node:fs').writeFileSync,
    });
    expect(writeFileSync).toHaveBeenCalledOnce();
    expect(writeFileSync.mock.calls[0][0]).toBe(localStatePath);
    expect(JSON.parse(writeFileSync.mock.calls[0][1] as string).profile.info_cache.test1.name).toBe('test1');
  });

  it('leaves the file alone when the profileDirectory key is not in info_cache', () => {
    const writeFileSync = vi.fn();
    setProfileDisplayName(chromeRoot, 'test1', 'test1', {
      readFileSync: (() => JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } } })) as unknown as typeof import('node:fs').readFileSync,
      writeFileSync: writeFileSync as unknown as typeof import('node:fs').writeFileSync,
    });
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('does not throw when Local State is missing, unreadable, or malformed JSON', () => {
    expect(() => setProfileDisplayName(chromeRoot, 'test1', 'test1', {
      readFileSync: (() => { throw new Error('ENOENT'); }) as unknown as typeof import('node:fs').readFileSync,
    })).not.toThrow();
    expect(() => setProfileDisplayName(chromeRoot, 'test1', 'test1', {
      readFileSync: (() => '{not json') as unknown as typeof import('node:fs').readFileSync,
    })).not.toThrow();
  });
});
