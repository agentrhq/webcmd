import { describe, expect, it, vi } from 'vitest';
import { findSlabInstallation, isSlabInstalled } from './installation.js';

describe('SLAB installation discovery', () => {
  it('finds the first valid macOS app bundle', () => {
    const exists = vi.fn((candidate: string) => candidate === '/Users/me/Applications/SLAB.app/Contents/MacOS/SLAB');

    expect(findSlabInstallation({ platform: 'darwin', homeDir: '/Users/me', existsSync: exists })).toEqual({
      platform: 'darwin',
      executablePath: '/Users/me/Applications/SLAB.app/Contents/MacOS/SLAB',
    });
  });

  it('returns null without probing another platform', () => {
    const existsSync = vi.fn(() => false);

    expect(findSlabInstallation({ platform: 'darwin', homeDir: '/Users/me', existsSync })).toBeNull();
    expect(existsSync.mock.calls.flat().join(' ')).not.toMatch(/Program Files|\/opt\/slab/);
  });

  it('reports whether SLAB is installed', () => {
    expect(isSlabInstalled({
      platform: 'darwin',
      homeDir: '/Users/me',
      existsSync: (candidate) => candidate === '/Applications/SLAB.app/Contents/MacOS/SLAB',
    })).toBe(true);
  });
});
