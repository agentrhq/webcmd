import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGitShim, restoreGitShim } from './git-shim.js';
import { openSitesRepository } from './git-store.js';
import { writeProductFile } from './local-store.js';
import { GIT_TEST_TIMEOUT_MS, removeTempDirs } from './__fixtures__/git-test-support.js';

vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT_MS });

const tempHomes: string[] = [];

afterEach(async () => {
  restoreGitShim();
  await removeTempDirs(tempHomes);
});

describe('installGitShim', () => {
  it('fails git-store commits through the exec seam without PATH wrappers', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'webcmd-git-shim-'));
    tempHomes.push(homeDir);
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const originalPath = process.env.PATH;
    const seen: string[][] = [];

    installGitShim(async (args, runReal) => {
      seen.push([...args]);
      if (args.includes('commit')) {
        throw Object.assign(new Error(`Command failed: git ${args.join(' ')}`), { code: 1, stderr: 'shim' });
      }
      return runReal();
    });

    await expect(
      (await openSitesRepository({ homeDir })).commit(['example.test/manifest.json'], 'init'),
    ).rejects.toThrow(/commit/);
    expect(process.env.PATH).toBe(originalPath);
    expect(seen.some((args) => args.includes('commit'))).toBe(true);
  });
});
