import { describe, expect, it } from 'vitest';
import { matchCloakProfileCommand } from './process-matcher.js';

describe('matchCloakProfileCommand', () => {
  it('matches only exact Cloak user-data-dir arguments', () => {
    const cloak = '/Users/me/.cloakbrowser/chromium --user-data-dir=/profiles/work';
    const cloakSeparate = '/Users/me/.cloakbrowser/chromium --user-data-dir /profiles/work';
    const cloakQuoted = '"/Users/me/.cloakbrowser/Cloak Chromium" "--user-data-dir=/profiles/work"';
    const cloakWork2 = '/Users/me/.cloakbrowser/chromium --user-data-dir=/profiles/work-2';
    const chromeWork = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/profiles/work';

    expect(matchCloakProfileCommand(cloak, '/profiles/work')).toBe(true);
    expect(matchCloakProfileCommand(cloakSeparate, '/profiles/work')).toBe(true);
    expect(matchCloakProfileCommand(cloakQuoted, '/profiles/work')).toBe(true);
    expect(matchCloakProfileCommand(cloakWork2, '/profiles/work')).toBe(false);
    expect(matchCloakProfileCommand(chromeWork, '/profiles/work')).toBe(false);
    expect(matchCloakProfileCommand('node tool.js --user-data-dir=/profiles/work', '/profiles/work')).toBe(false);
    expect(matchCloakProfileCommand('node /tmp/.cloakbrowser/tool.js --user-data-dir=/profiles/work', '/profiles/work')).toBe(false);
  });

  it('accepts quotes around a separate or equals-form profile value', () => {
    const executable = '/Users/me/.cloakbrowser/chromium';
    expect(matchCloakProfileCommand(`${executable} --user-data-dir "/profiles/work space"`, '/profiles/work space')).toBe(true);
    expect(matchCloakProfileCommand(`${executable} --user-data-dir='/profiles/work space'`, '/profiles/work space')).toBe(true);
  });
});
