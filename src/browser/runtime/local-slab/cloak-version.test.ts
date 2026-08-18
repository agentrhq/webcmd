import { describe, expect, it, vi } from 'vitest';

// Isolated file: the version cache is module-level and populated by the first
// call in the process, so this must import a fresh copy to observe the read.
describe('resolveCloakBrowserVersion', () => {
  it('resolves and reads cloakbrowser/package.json only once per process', async () => {
    vi.resetModules();
    const fs = (await import('node:fs')).default;
    // Import before spying: loading the module graph reads files of its own,
    // and only reads made by resolveCloakBrowserVersion should be counted.
    const { resolveCloakBrowserVersion } = await import('./session-manager.js');
    const readFileSync = vi.spyOn(fs, 'readFileSync');
    try {
      const first = resolveCloakBrowserVersion();
      const second = resolveCloakBrowserVersion();
      const third = resolveCloakBrowserVersion();

      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(readFileSync).toHaveBeenCalledTimes(1);
    } finally {
      readFileSync.mockRestore();
    }
  });
});
