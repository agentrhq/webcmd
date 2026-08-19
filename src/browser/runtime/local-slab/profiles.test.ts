import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeProfileId, resolveSlabProfileDir } from './profiles.js';

describe('SLAB profile resolution', () => {
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

  it('resolves under the webcmd SLAB profiles directory', () => {
    expect(resolveSlabProfileDir('work', { baseDir: '/tmp/webcmd' }))
      .toBe(path.join('/tmp/webcmd', 'slab', 'profiles', 'work'));
  });
});
