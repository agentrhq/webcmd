import { describe, expect, it } from 'vitest';
import { matchChromeProcessCommand } from './chrome-process.js';

describe('matchChromeProcessCommand', () => {
  const identity = {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    userDataDir: '/profiles/work profile',
    port: 43123,
  };

  it('requires the configured executable, exact profile, and exact port', () => {
    const command = `${identity.executablePath} --user-data-dir=${identity.userDataDir} --remote-debugging-port=43123 about:blank`;
    expect(matchChromeProcessCommand(command, identity)).toBe(true);
    expect(matchChromeProcessCommand(command, { ...identity, userDataDir: '/profiles/work' })).toBe(false);
    expect(matchChromeProcessCommand(command, { ...identity, port: 43124 })).toBe(false);
    expect(matchChromeProcessCommand(command, { ...identity, executablePath: '/Applications/Chromium' })).toBe(false);
  });

  it('never matches by Chrome basename alone', () => {
    expect(matchChromeProcessCommand(
      'Google Chrome --user-data-dir=/profiles/work profile --remote-debugging-port=43123',
      identity,
    )).toBe(false);
  });

  it('requires an exact --profile-directory match when the identity specifies one', () => {
    const command = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/test/Chrome --profile-directory=webcmd-work --no-startup-window';
    expect(matchChromeProcessCommand(command, {
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      userDataDir: '/Users/test/Chrome',
      profileDirectory: 'webcmd-work',
    })).toBe(true);
    expect(matchChromeProcessCommand(command, {
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      userDataDir: '/Users/test/Chrome',
      profileDirectory: 'someone-else',
    })).toBe(false);
  });

  it('does not require --profile-directory when the identity omits it', () => {
    const command = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/test/Chrome';
    expect(matchChromeProcessCommand(command, {
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      userDataDir: '/Users/test/Chrome',
    })).toBe(true);
  });
});
