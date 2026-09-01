import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findInstalledGoogleChrome, googleChromeCandidates } from './google-chrome.js';

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
