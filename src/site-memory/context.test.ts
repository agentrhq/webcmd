import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMemoryContext } from './context.js';
import { readProductFile } from './local-store.js';
import type { GlobalSeedProvider } from './seed-client.js';
import type { SeedLookupResult } from './model.js';

const run = promisify(execFile);
const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('memory context initialization', () => {
  it('persists a terminal absent result without creating SITE.md', async () => {
    const { homeDir, sites } = await tempSites();
    const lookup = vi.fn(async () => ({ status: 'absent' as const }));

    const context = await getMemoryContext({
      url: 'https://example.test/home',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(lookup),
    });

    expect(context.manifest?.seed).toEqual({ status: 'absent' });
    expect(context.siteMarkdown).toBeNull();
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBeNull();
    expect(await git(sites, ['ls-files'])).toContain('example.test/manifest.json');
    expect(await git(sites, ['ls-files'])).not.toContain('example.test/sitemap/SITE.md');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('persists lookup-failed without creating SITE.md', async () => {
    const { homeDir } = await tempSites();

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(async () => ({ status: 'lookup-failed' })),
    });

    expect(context.manifest?.seed).toEqual({ status: 'lookup-failed' });
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBeNull();
  });

  it('does not look up a seed once a product already exists', async () => {
    const { homeDir } = await tempSites();
    const lookup = vi.fn(async () => ({ status: 'absent' as const }));
    const seedProvider = provider(lookup);

    await getMemoryContext({ url: 'https://example.test/', taskId: 'task-1', homeDir, seedProvider });
    lookup.mockClear();

    const context = await getMemoryContext({ url: 'https://example.test/', taskId: 'task-2', homeDir, seedProvider });

    expect(lookup).not.toHaveBeenCalled();
    expect(context.manifest?.seed).toEqual({ status: 'absent' });
  });

  it('accepts an oversized seed unchanged and does not retain the body in the manifest', async () => {
    const { homeDir, sites } = await tempSites();
    const site = Array.from({ length: 501 }, (_, i) => `line ${i}`).join('\n');
    const lookup = vi.fn(async (): Promise<SeedLookupResult> => ({
      status: 'available',
      revision: 'seed-big',
      site,
      references: { 'alt.md': '# Alt\n' },
    }));

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(lookup),
    });

    const stored = await readProductFile('example.test', 'sitemap/SITE.md', { homeDir });
    expect(stored?.split('\n').filter(Boolean)).toHaveLength(501);
    expect(await readProductFile('example.test', 'sitemap/references/alt.md', { homeDir })).toBe('# Alt\n');
    expect(context.siteMarkdown).toBe(site);
    expect(context.manifest?.seed).toEqual({ status: 'available', revision: 'seed-big' });
    expect(JSON.stringify(context.manifest)).not.toContain('line 0');
    expect(await git(sites, ['ls-files'])).toContain('example.test/sitemap/SITE.md');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('diagnoses legacy SITE.md as read-only and skips seed lookup', async () => {
    const { homeDir } = await tempSites();
    await mkdir(join(homeDir, '.webcmd/sites/example.test/sitemap'), { recursive: true });
    await writeFile(
      join(homeDir, '.webcmd/sites/example.test/sitemap/SITE.md'),
      '---\nsite: example\nkind: site\nid: example\nstatus: verified\nverified_at: 2026-01-01\nsource: beta\n---\n# Beta\n',
    );
    const lookup = vi.fn(async () => ({ status: 'available' as const, revision: 'x', site: '# no\n' }));

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(lookup),
    });

    expect(context.readOnly).toBe(true);
    expect(context.diagnostics.join('\n')).toMatch(/incompatible beta schema/i);
    expect(lookup).not.toHaveBeenCalled();
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toMatch(/^---\n/);
  });

  it('uses a seed transiently when Git is unsafe and does not persist it', async () => {
    const { homeDir } = await tempSites();
    await git(homeDir, ['init']);
    const lookup = vi.fn(async (): Promise<SeedLookupResult> => ({
      status: 'available',
      revision: 'seed-1',
      site: '# Transient\n',
    }));

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(lookup),
    });

    expect(context.siteMarkdown).toBe('# Transient\n');
    expect(context.readOnly).toBe(true);
    expect(context.manifest).toBeUndefined();
    expect(await readProductFile('example.test', 'manifest.json', { homeDir })).toBeNull();
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('creates a task-id-contained draft and rejects escaping task ids', async () => {
    const { homeDir, sites } = await tempSites();

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(async () => ({ status: 'available', revision: 'r1', site: '# Draft me\n' })),
    });

    expect(context.draftPath).toBe(join(sites, '.drafts/task-1/example.test/sitemap'));
    expect(await readFile(join(context.draftPath, 'SITE.md'), 'utf8')).toBe('# Draft me\n');
    await expect(getMemoryContext({
      url: 'https://example.test/',
      taskId: '../escape',
      homeDir,
      seedProvider: provider(async () => ({ status: 'absent' })),
    })).rejects.toThrow(/Invalid site memory path/);
  });
});

function provider(lookup: GlobalSeedProvider['lookup']): GlobalSeedProvider {
  return { lookup };
}

async function tempSites() {
  const homeDir = await mkdtemp(join(tmpdir(), 'webcmd-memory-context-'));
  tempHomes.push(homeDir);
  return { homeDir, sites: join(homeDir, '.webcmd', 'sites') };
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}
