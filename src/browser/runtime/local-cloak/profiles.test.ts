import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeProfileId, resolveCloakProfileDir } from './profiles.js';

describe('cloak profile resolution', () => {
  it('normalizes empty profile ids to default', () => {
    expect(normalizeProfileId(undefined)).toBe('default');
    expect(normalizeProfileId('')).toBe('default');
    expect(normalizeProfileId('  work  ')).toBe('work');
  });

  it('rejects path traversal and separators', () => {
    expect(() => normalizeProfileId('../x')).toThrow(/Invalid profile id/);
    expect(() => normalizeProfileId('a/b')).toThrow(/Invalid profile id/);
    expect(() => normalizeProfileId('a\\b')).toThrow(/Invalid profile id/);
  });

  it('resolves under the webcmd cloak profiles directory', () => {
    expect(resolveCloakProfileDir('work', { baseDir: '/tmp/webcmd' }))
      .toBe(path.join('/tmp/webcmd', 'cloak', 'profiles', 'work'));
  });
});
