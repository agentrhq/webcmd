import { describe, expect, it } from 'vitest';
import { matchSlabProfileCommand } from './process-matcher.js';

describe('matchSlabProfileCommand', () => {
  it('matches only exact SLAB user-data-dir arguments', () => {
    const slab = '/Applications/SLAB.app/Contents/MacOS/SLAB --user-data-dir=/profiles/work';
    const slabSeparate = '/Users/me/.slabbrowser/chromium-146.0.7680.177.4/chrome --user-data-dir /profiles/work';
    const slabQuoted = '"/Users/me/Applications/SLAB.app/Contents/MacOS/SLAB" "--user-data-dir=/profiles/work"';
    const slabWork2 = '/Applications/SLAB.app/Contents/MacOS/SLAB --user-data-dir=/profiles/work-2';
    const chromeWork = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/profiles/work';

    expect(matchSlabProfileCommand(slab, '/profiles/work')).toBe(true);
    expect(matchSlabProfileCommand(slabSeparate, '/profiles/work')).toBe(true);
    expect(matchSlabProfileCommand(slabQuoted, '/profiles/work')).toBe(true);
    expect(matchSlabProfileCommand(slabWork2, '/profiles/work')).toBe(false);
    expect(matchSlabProfileCommand(chromeWork, '/profiles/work')).toBe(false);
    expect(matchSlabProfileCommand('/tmp/slab --user-data-dir=/profiles/work', '/profiles/work')).toBe(false);
    expect(matchSlabProfileCommand('/tmp/SLAB/slab --user-data-dir=/profiles/work', '/profiles/work')).toBe(false);
    expect(matchSlabProfileCommand('node tool.js --user-data-dir=/profiles/work', '/profiles/work')).toBe(false);
    expect(matchSlabProfileCommand('node /tmp/.slabbrowser/tool.js --user-data-dir=/profiles/work', '/profiles/work')).toBe(false);
    expect(matchSlabProfileCommand('/tmp/.slabbrowser/helper --user-data-dir=/profiles/work', '/profiles/work')).toBe(false);
  });

  it('accepts quotes around a separate or equals-form profile value', () => {
    const executable = '/Applications/SLAB.app/Contents/MacOS/SLAB';
    expect(matchSlabProfileCommand(`${executable} --user-data-dir "/profiles/work space"`, '/profiles/work space')).toBe(true);
    expect(matchSlabProfileCommand(`${executable} --user-data-dir='/profiles/work space'`, '/profiles/work space')).toBe(true);
  });
});
