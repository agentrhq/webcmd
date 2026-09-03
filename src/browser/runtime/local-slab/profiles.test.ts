import { describe, expect, it } from 'vitest';
import { normalizeProfileId, resolveSlabProfileDir } from './profiles.js';

describe('local SLAB profile ids', () => {
  it('accepts native Chromium profile ids with spaces', () => {
    expect(normalizeProfileId('Profile 1')).toBe('Profile 1');
    expect(resolveSlabProfileDir('Profile 1', { baseDir: '/tmp/webcmd-test' }))
      .toBe('/tmp/webcmd-test/slab/profiles/Profile 1');
  });

  it('still rejects path traversal and path separators', () => {
    expect(() => normalizeProfileId('../x')).toThrow(/Invalid profile id/);
    expect(() => normalizeProfileId('a/b')).toThrow(/Invalid profile id/);
    expect(() => normalizeProfileId('a\\b')).toThrow(/Invalid profile id/);
    expect(() => normalizeProfileId('line\nbreak')).toThrow(/Invalid profile id/);
  });
});
