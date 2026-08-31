import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMemoryContext, parseProductManifest } from './context.js';
import { openSitesRepository } from './git-store.js';
import { readProductFile, writeProductFile } from './local-store.js';
import type { GlobalSeedProvider } from './seed-client.js';
import type { SeedLookupResult } from './model.js';

const run = promisify(execFile);
const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('parseProductManifest', () => {
  const product = {
    key: 'example.test',
    hostname: 'example.test',
    displayHostname: 'example.test',
    registrableDomain: 'example.test',
  };
  const valid = { schemaVersion: 1, product, interfaces: [], seed: { status: 'absent' as const } };

  it('accepts a v1 manifest and rejects missing, partial, malformed, and non-v1 input', () => {
    expect(parseProductManifest(`${JSON.stringify(valid)}\n`)).toEqual(valid);
    expect(parseProductManifest(null)).toBeUndefined();
    expect(parseProductManifest('{')).toBeUndefined();
    expect(parseProductManifest(JSON.stringify({ ...valid, schemaVersion: 2 }))).toBeUndefined();
    expect(parseProductManifest(JSON.stringify({ schemaVersion: 1, product, seed: { status: 'absent' } }))).toBeUndefined();
  });
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

  it('persists an unattempted seed result without creating SITE.md', async () => {
    const { homeDir, sites } = await tempSites();

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(async () => ({ status: 'unattempted' })),
    });

    expect(context.manifest?.seed).toEqual({ status: 'unattempted' });
    expect(context.readOnly).toBe(false);
    expect(context.siteMarkdown).toBeNull();
    expect(parseProductManifest(await readProductFile('example.test', 'manifest.json', { homeDir }))?.seed)
      .toEqual({ status: 'unattempted' });
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBeNull();
    expect(await git(sites, ['ls-files'])).toContain('example.test/manifest.json');
    expect(await git(sites, ['ls-files'])).not.toContain('example.test/sitemap/SITE.md');
  });

  it('retries an unattempted seed once lookup is enabled and preserves identity', async () => {
    const { homeDir, sites } = await tempSites();
    await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(async () => ({ status: 'unattempted' })),
    });
    const lookup = vi.fn(async (): Promise<SeedLookupResult> => ({
      status: 'available',
      revision: 'seed-1',
      site: '# Seeded\n',
      references: { 'alt.md': '# Alt\n' },
    }));

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-2',
      homeDir,
      seedProvider: provider(lookup),
    });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(context.manifest?.seed).toEqual({ status: 'available', revision: 'seed-1' });
    expect(context.manifest?.product.key).toBe('example.test');
    expect(context.manifest?.interfaces).toEqual([]);
    expect(context.siteMarkdown).toBe('# Seeded\n');
    expect(parseProductManifest(await readProductFile('example.test', 'manifest.json', { homeDir }))?.seed)
      .toEqual({ status: 'available', revision: 'seed-1' });
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe('# Seeded\n');
    expect(await readProductFile('example.test', 'sitemap/references/alt.md', { homeDir })).toBe('# Alt\n');
    expect(await git(sites, ['ls-files'])).toContain('example.test/sitemap/SITE.md');
    lookup.mockClear();
    await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-3',
      homeDir,
      seedProvider: provider(lookup),
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('leaves unattempted in place when lookup stays disabled', async () => {
    const { homeDir, sites } = await tempSites();
    const lookup = vi.fn(async () => ({ status: 'unattempted' as const }));
    await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(lookup),
    });
    lookup.mockClear();
    const log = (await git(sites, ['log', '--oneline'])).trim();

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-2',
      homeDir,
      seedProvider: provider(lookup),
    });

    expect(context.manifest?.seed).toEqual({ status: 'unattempted' });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect((await git(sites, ['log', '--oneline'])).trim()).toBe(log);
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

  it('does not overwrite existing SITE or reference draft files', async () => {
    const { homeDir } = await tempSites();
    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(async () => ({
        status: 'available',
        revision: 'r1',
        site: '# Draft me\n',
        references: { 'alt.md': '# Alt\n' },
      })),
    });
    const siteDraft = join(context.draftPath, 'SITE.md');
    const refDraft = join(context.draftPath, 'references', 'alt.md');
    const editedSite = '# Draft me\n\n- [verified 2026-09-01] IMPORTANT: /del bans the account.\n';
    const editedRef = '# Alt\n\n- [verified 2026-09-01] Keep the local note.\n';
    await writeFile(siteDraft, editedSite);
    await writeFile(refDraft, editedRef);

    await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(async () => ({ status: 'absent' })),
    });

    expect(await readFile(siteDraft, 'utf8')).toBe(editedSite);
    expect(await readFile(refDraft, 'utf8')).toBe(editedRef);
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

  it('does not treat schemaVersion 1 memory as beta because SITE.md has frontmatter', async () => {
    const { homeDir } = await tempSites();
    await mkdir(join(homeDir, '.webcmd/sites/example.test/sitemap'), { recursive: true });
    await writeFile(join(homeDir, '.webcmd/sites/example.test/manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      product: {
        key: 'example.test',
        hostname: 'example.test',
        displayHostname: 'example.test',
        registrableDomain: 'example.test',
      },
      interfaces: [],
      seed: { status: 'available', revision: 'seed-1' },
    }, null, 2)}\n`);
    await writeFile(
      join(homeDir, '.webcmd/sites/example.test/sitemap/SITE.md'),
      '---\ntitle: seeded\n---\n# Seeded\n',
    );
    const lookup = vi.fn(async () => ({ status: 'available' as const, revision: 'x', site: '# no\n' }));

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(lookup),
    });

    expect(context.readOnly).toBe(false);
    expect(context.diagnostics.join('\n')).not.toMatch(/incompatible beta schema/i);
    expect(context.siteMarkdown).toBe('---\ntitle: seeded\n---\n# Seeded\n');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('persists a new product even when an unrelated product is dirty', async () => {
    const { homeDir } = await tempSites();
    await writeProductFile('other.test', 'manifest.json', '{}\n', { homeDir });
    await (await openSitesRepository({ homeDir })).commit(['other.test/manifest.json'], 'init');
    await writeProductFile('other.test', 'manifest.json', '{"dirty":true}\n', { homeDir });
    const lookup = vi.fn(async (): Promise<SeedLookupResult> => ({
      status: 'available',
      revision: 'seed-1',
      site: '# Seed\n',
      references: { 'alt.md': '# Alt\n' },
    }));

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: provider(lookup),
    });

    expect(context.readOnly).toBe(false);
    expect(context.siteMarkdown).toBe('# Seed\n');
    expect(context.manifest?.seed).toEqual({ status: 'available', revision: 'seed-1' });
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe('# Seed\n');
    expect(await readProductFile('example.test', 'sitemap/references/alt.md', { homeDir })).toBe('# Alt\n');
    expect(await readProductFile('other.test', 'manifest.json', { homeDir })).toBe('{"dirty":true}\n');
  });

  it('degrades persist failures to read-only transient seed and drops uncommitted seed files', async () => {
    const { homeDir } = await tempSites();
    const lookup = vi.fn(async (): Promise<SeedLookupResult> => ({
      status: 'available',
      revision: 'seed-1',
      site: '# Transient\n',
      references: { 'alt.md': '# Alt\n' },
    }));
    const originalPath = process.env.PATH;
    const wrapperDir = await mkdtemp(join(tmpdir(), 'webcmd-persist-fail-'));
    tempHomes.push(wrapperDir);
    const { stdout } = await run('/usr/bin/which', ['git'], { encoding: 'utf8' });
    const wrapper = join(wrapperDir, 'git');
    await writeFile(wrapper, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('commit')) process.exit(1);
const result = spawnSync(${JSON.stringify(stdout.trim())}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    await chmod(wrapper, 0o755);
    process.env.PATH = `${wrapperDir}:${originalPath}`;
    try {
      const context = await getMemoryContext({
        url: 'https://example.test/',
        taskId: 'task-1',
        homeDir,
        seedProvider: provider(lookup),
      });
      expect(context.readOnly).toBe(true);
      expect(context.siteMarkdown).toBe('# Transient\n');
      expect(context.manifest).toBeUndefined();
      expect(await readProductFile('example.test', 'manifest.json', { homeDir })).toBeNull();
      expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBeNull();
      expect(await readProductFile('example.test', 'sitemap/references/alt.md', { homeDir })).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }

    lookup.mockClear();
    await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-2',
      homeDir,
      seedProvider: provider(lookup),
    });
    expect(lookup).toHaveBeenCalled();
  });

  it('ignores manifests whose shape would crash product resolution', async () => {
    const { homeDir } = await tempSites();
    await git(homeDir, ['init']);
    const product = {
      key: 'broken.test',
      hostname: 'broken.test',
      displayHostname: 'broken.test',
      registrableDomain: 'broken.test',
    };
    const lookup = vi.fn(async () => ({ status: 'absent' as const }));
    for (const [key, manifest] of [
      ['missing-if.test', { schemaVersion: 1, product: { ...product, key: 'missing-if.test' }, seed: { status: 'absent' } }],
      ['obj-if.test', { schemaVersion: 1, product: { ...product, key: 'obj-if.test' }, interfaces: {}, seed: { status: 'absent' } }],
      ['null-if.test', { schemaVersion: 1, product: { ...product, key: 'null-if.test' }, interfaces: [null], seed: { status: 'absent' } }],
      ['bad-product.test', { schemaVersion: 1, product: 'bad-product.test', interfaces: [], seed: { status: 'absent' } }],
    ] as const) {
      await mkdir(join(homeDir, '.webcmd/sites', key), { recursive: true });
      await writeFile(join(homeDir, '.webcmd/sites', key, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    }

    for (const host of ['www.missing-if.test', 'www.obj-if.test', 'www.null-if.test', 'www.bad-product.test']) {
      await expect(getMemoryContext({
        url: `https://${host}/`,
        taskId: 'task-1',
        homeDir,
        seedProvider: provider(lookup),
      })).resolves.toMatchObject({ resolution: { status: 'new' } });
    }
  });

  it.each(['absent', 'lookup-failed', 'unattempted'] as const)(
    'creates the task draft directory when seed is %s and SITE.md is absent',
    async (status) => {
      const { homeDir } = await tempSites();

      const context = await getMemoryContext({
        url: 'https://example.test/',
        taskId: 'task-1',
        homeDir,
        seedProvider: provider(async () => ({ status })),
      });

      expect(context.siteMarkdown).toBeNull();
      await expect(access(context.draftPath)).resolves.toBeUndefined();
    },
  );

  it('keeps one committed product when two cold contexts initialize together', async () => {
    const { homeDir, sites } = await tempSites();
    const seed: SeedLookupResult = {
      status: 'available',
      revision: 'seed-1',
      site: '# Seed\n',
      references: { 'alt.md': '# Alt\n' },
    };
    let pending = 0;
    let release!: () => void;
    const bothLooking = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lookup = vi.fn(async (): Promise<SeedLookupResult> => {
      pending += 1;
      if (pending === 2) release();
      await bothLooking;
      return seed;
    });
    const input = { url: 'https://example.test/', homeDir, seedProvider: provider(lookup) };

    const [first, second] = await Promise.all([
      getMemoryContext({ ...input, taskId: 'task-1' }),
      getMemoryContext({ ...input, taskId: 'task-2' }),
    ]);

    expect(await readProductFile('example.test', 'manifest.json', { homeDir })).not.toBeNull();
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe('# Seed\n');
    expect(await readProductFile('example.test', 'sitemap/references/alt.md', { homeDir })).toBe('# Alt\n');
    expect(await git(sites, ['ls-files'])).toContain('example.test/manifest.json');
    expect(await git(sites, ['show', 'HEAD:example.test/sitemap/SITE.md'])).toBe('# Seed\n');
    for (const context of [first, second]) {
      expect(context.resolution.status).toBe('exact');
      expect(context.manifest?.seed).toEqual({ status: 'available', revision: 'seed-1' });
      expect(context.siteMarkdown).toBe('# Seed\n');
      expect(context.readOnly).toBe(false);
    }
  });

  it('surfaces non-ENOENT seed cleanup failures', async () => {
    const { homeDir, sites } = await tempSites();
    const originalPath = process.env.PATH;
    const productDir = join(sites, 'example.test');
    const wrapperDir = await mkdtemp(join(tmpdir(), 'webcmd-git-cleanup-'));
    tempHomes.push(wrapperDir);
    const { stdout } = await run('/usr/bin/which', ['git'], { encoding: 'utf8' });
    const wrapper = join(wrapperDir, 'git');
    await writeFile(wrapper, `#!/usr/bin/env node
const { chmodSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('commit')) {
  try { chmodSync(${JSON.stringify(productDir)}, 0o555); } catch {}
  process.exit(1);
}
const result = spawnSync(${JSON.stringify(stdout.trim())}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    await chmod(wrapper, 0o755);
    process.env.PATH = `${wrapperDir}:${originalPath}`;
    try {
      const context = await getMemoryContext({
        url: 'https://example.test/',
        taskId: 'task-1',
        homeDir,
        seedProvider: provider(async () => ({ status: 'available', revision: 'seed-1', site: '# Transient\n' })),
      });
      expect(context.readOnly).toBe(true);
      expect(context.diagnostics.join('\n')).toMatch(/EACCES|EPERM|permission denied/i);
    } finally {
      process.env.PATH = originalPath;
      await chmod(productDir, 0o755).catch(() => undefined);
    }
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
