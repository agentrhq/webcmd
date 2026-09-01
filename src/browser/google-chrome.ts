import { constants } from 'node:fs';
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
