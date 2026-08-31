import { describe, expect, it, vi } from 'vitest';
import { findSlabInstallation, isSlabInstalled, slabControlEndpoint } from './installation.js';

describe('SLAB installation discovery', () => {
  it('finds the first installed normal macOS app bundle', () => {
    const existsSync = vi.fn((candidate: string) => candidate === '/Users/me/Applications/SLAB.app/Contents/MacOS/SLAB');

    expect(findSlabInstallation({ platform: 'darwin', homeDir: '/Users/me', existsSync })).toEqual({
      platform: 'darwin',
      appPath: '/Users/me/Applications/SLAB.app',
      executablePath: '/Users/me/Applications/SLAB.app/Contents/MacOS/SLAB',
    });
  });

  it('does not fall back to a standalone browser executable', () => {
    const existsSync = vi.fn(() => false);

    expect(findSlabInstallation({ platform: 'darwin', homeDir: '/Users/me', existsSync })).toBeNull();
    expect(existsSync.mock.calls.flat().join(' ')).not.toContain('slab-browser');
  });

  it('reports only normal macOS app bundle availability', () => {
    expect(isSlabInstalled({
      platform: 'darwin',
      homeDir: '/Users/me',
      existsSync: candidate => candidate === '/Applications/SLAB.app/Contents/MacOS/SLAB',
    })).toBe(true);
    expect(isSlabInstalled({ platform: 'linux', homeDir: '/Users/me', existsSync: () => true })).toBe(false);
  });

  it('uses the owner-scoped control socket path', () => {
    expect(slabControlEndpoint('/Users/me')).toBe('/Users/me/.slab/run/slab-bridge.sock');
  });

});
