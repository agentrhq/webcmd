import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  chromeUserDataDir,
  findChromeCookieSource,
  findInstalledGoogleChrome,
  googleChromeCandidates,
  importChromeCookies,
  listChromeCookieSources,
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
        path.join(userDataDir, 'Default', 'Cookies'),
        path.join(userDataDir, 'Profile 1', 'Network', 'Cookies'),
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
      { folder: 'Default', name: 'Person 1', cookiesPath: path.join(userDataDir, 'Default', 'Cookies') },
      { folder: 'Profile 1', name: 'Work', cookiesPath: path.join(userDataDir, 'Profile 1', 'Network', 'Cookies') },
      { folder: 'Profile 2', name: 'Profile 2', cookiesPath: undefined },
    ]);
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
