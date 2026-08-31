import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyProduct } from './classify.js';
import { getMemoryContext, parseProductManifest } from './context.js';
import { openSitesRepository } from './git-store.js';
import { readProductFile, writeProductFile } from './local-store.js';
import type { SeedLookupResult } from './model.js';
import { canonicalProductKey } from './product-resolver.js';

const run = promisify(execFile);
const tempHomes: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('product classification', () => {
  it('records a same-product interface under lock and is idempotent', async () => {
    const { homeDir, revision } = await primed('reddit.com');
    const first = await classifyProduct({
      requested: 'https://old.reddit.com/',
      decision: 'same-product',
      parent: 'reddit.com',
      expectedRevision: revision,
      homeDir,
    });
    expect(first).toMatchObject({
      status: 'classified',
      decision: 'same-product',
      existing: false,
      requested: { key: 'old.reddit.com' },
      product: { key: 'reddit.com' },
    });
    if (first.status !== 'classified') throw new Error('expected classified');
    const manifest = parseProductManifest(await readProductFile('reddit.com', 'manifest.json', { homeDir }));
    expect(manifest?.interfaces).toEqual([canonicalProductKey('https://old.reddit.com/')]);

    const again = await classifyProduct({
      requested: 'old.reddit.com',
      decision: 'same-product',
      parent: 'reddit.com',
      expectedRevision: first.revision,
      homeDir,
    });
    expect(again).toMatchObject({ status: 'classified', existing: true, revision: first.revision });
  });

  it('refuses distinct classification when an incompatible beta SITE.md exists', async () => {
    const { homeDir, revision } = await primed('ycombinator.com');
    await mkdir(join(homeDir, '.webcmd/sites/news.ycombinator.com/sitemap'), { recursive: true });
    await writeFile(
      join(homeDir, '.webcmd/sites/news.ycombinator.com/sitemap/SITE.md'),
      '# beta schema\nold beta content\n',
    );

    await expect(classifyProduct({
      requested: 'https://news.ycombinator.com/',
      decision: 'distinct',
      expectedRevision: revision,
      homeDir,
    })).rejects.toThrow(/incompatible beta schema/i);

    expect(await readProductFile('news.ycombinator.com', 'manifest.json', { homeDir })).toBeNull();
    expect(parseProductManifest(await readProductFile('ycombinator.com', 'manifest.json', { homeDir }))?.interfaces)
      .toEqual([]);
  });

  it('creates a distinct package and does not mutate the parent', async () => {
    const { homeDir, revision } = await primed('ycombinator.com');
    const result = await classifyProduct({
      requested: 'https://news.ycombinator.com/',
      decision: 'distinct',
      expectedRevision: revision,
      homeDir,
    });
    expect(result).toMatchObject({
      status: 'classified',
      decision: 'distinct',
      existing: false,
      product: { key: 'news.ycombinator.com' },
    });
    expect(parseProductManifest(await readProductFile('ycombinator.com', 'manifest.json', { homeDir }))?.interfaces)
      .toEqual([]);
    expect(parseProductManifest(await readProductFile('news.ycombinator.com', 'manifest.json', { homeDir }))).toMatchObject({
      schemaVersion: 1,
      product: { key: 'news.ycombinator.com' },
      interfaces: [],
      seed: { status: 'unattempted' },
    });
  });

  it('seeds a newly distinct package on the next context', async () => {
    const { homeDir } = await primed('ycombinator.com');
    const classified = await classifyProduct({
      requested: 'https://news.ycombinator.com/',
      decision: 'distinct',
      expectedRevision: await (await openSitesRepository({ homeDir })).revision(),
      homeDir,
    });
    expect(classified).toMatchObject({ status: 'classified', existing: false });
    const context = await getMemoryContext({
      url: 'https://news.ycombinator.com/',
      taskId: 'task-hn',
      homeDir,
      seedProvider: {
        lookup: async (): Promise<SeedLookupResult> => ({
          status: 'available',
          revision: 'hn-1',
          site: '# HN\n',
        }),
      },
    });

    expect(context.manifest?.seed).toEqual({ status: 'available', revision: 'hn-1' });
    expect(context.manifest?.product.key).toBe('news.ycombinator.com');
    expect(context.siteMarkdown).toBe('# HN\n');
    expect(await readProductFile('news.ycombinator.com', 'sitemap/SITE.md', { homeDir })).toBe('# HN\n');
    expect(parseProductManifest(await readProductFile('ycombinator.com', 'manifest.json', { homeDir }))?.interfaces)
      .toEqual([]);
  });

  it('returns a CAS conflict without writing', async () => {
    const { homeDir } = await primed('reddit.com');
    const result = await classifyProduct({
      requested: 'https://old.reddit.com/',
      decision: 'same-product',
      parent: 'reddit.com',
      expectedRevision: '0'.repeat(40),
      homeDir,
    });
    expect(result).toMatchObject({ status: 'conflict', expectedRevision: '0'.repeat(40) });
    expect(parseProductManifest(await readProductFile('reddit.com', 'manifest.json', { homeDir }))?.interfaces)
      .toEqual([]);
  });

  it('rejects invalid identities, missing parent, and conflicting classifications', async () => {
    const { homeDir, revision } = await primed('reddit.com');
    await expect(classifyProduct({
      requested: '../escape',
      decision: 'same-product',
      parent: 'reddit.com',
      expectedRevision: revision,
      homeDir,
    })).rejects.toThrow(/invalid/i);
    await expect(classifyProduct({
      requested: 'https://old.reddit.com/',
      decision: 'same-product',
      expectedRevision: revision,
      homeDir,
    })).rejects.toThrow(/parent|same-product/i);

    const classified = await classifyProduct({
      requested: 'https://old.reddit.com/',
      decision: 'same-product',
      parent: 'reddit.com',
      expectedRevision: revision,
      homeDir,
    });
    if (classified.status !== 'classified') throw new Error('expected classified');
    await expect(classifyProduct({
      requested: 'https://old.reddit.com/',
      decision: 'distinct',
      expectedRevision: classified.revision,
      homeDir,
    })).rejects.toThrow(/conflict|interface|distinct/i);
  });

  it('refuses an ancestor repository', async () => {
    const { homeDir } = await tempSites();
    await mkdir(join(homeDir, '.webcmd', 'sites'), { recursive: true });
    await git(homeDir, ['init']);
    await expect(classifyProduct({
      requested: 'https://old.reddit.com/',
      decision: 'distinct',
      expectedRevision: null,
      homeDir,
    })).rejects.toThrow(/ancestor/i);
  });

  it('restores the parent manifest after a same-product commit failure', async () => {
    const { homeDir, sites, revision } = await primed('reddit.com');
    const prior = await readProductFile('reddit.com', 'manifest.json', { homeDir });
    await withFailingCommit(async () => {
      await expect(classifyProduct({
        requested: 'https://old.reddit.com/',
        decision: 'same-product',
        parent: 'reddit.com',
        expectedRevision: revision,
        homeDir,
      })).rejects.toThrow();
    });
    expect(await readProductFile('reddit.com', 'manifest.json', { homeDir })).toBe(prior);
    expect(parseProductManifest(prior)?.interfaces).toEqual([]);
    expect((await git(sites, ['status', '--porcelain', '-uall'])).trim()).toBe('');
    expect((await git(sites, ['diff', '--cached', '--name-only'])).trim()).toBe('');
  });

  it('combines classify commit and rollback errors', async () => {
    const { homeDir, revision } = await primed('reddit.com');
    const productDir = join(homeDir, '.webcmd/sites/reddit.com');
    try {
      const error = await withFailingCommit(async () => classifyProduct({
        requested: 'https://old.reddit.com/',
        decision: 'same-product',
        parent: 'reddit.com',
        expectedRevision: revision,
        homeDir,
      }).then(
        () => {
          throw new Error('expected classify to fail');
        },
        (err: unknown) => err,
      ), productDir);
      expect(error).toBeInstanceOf(AggregateError);
      const aggregate = error as AggregateError;
      expect(aggregate.errors).toHaveLength(2);
      expect(aggregate.message).toMatch(/rollback/i);
      expect(aggregate.errors.map((item) => (item instanceof Error ? item.message : String(item))).join('\n')).toMatch(
        /EACCES|EPERM|permission denied/i,
      );
    } finally {
      await chmod(productDir, 0o755).catch(() => undefined);
    }
  });

  it('deletes a newly created distinct manifest after a commit failure', async () => {
    const { homeDir, sites, revision } = await primed('ycombinator.com');
    await withFailingCommit(async () => {
      await expect(classifyProduct({
        requested: 'https://news.ycombinator.com/',
        decision: 'distinct',
        expectedRevision: revision,
        homeDir,
      })).rejects.toThrow();
    });
    expect(await readProductFile('news.ycombinator.com', 'manifest.json', { homeDir })).toBeNull();
    expect(parseProductManifest(await readProductFile('ycombinator.com', 'manifest.json', { homeDir }))?.interfaces)
      .toEqual([]);
    expect((await git(sites, ['status', '--porcelain', '-uall'])).trim()).toBe('');
    expect((await git(sites, ['diff', '--cached', '--name-only'])).trim()).toBe('');
  });
});

async function withFailingCommit<T>(fn: () => Promise<T>, chmodOnFail?: string): Promise<T> {
  const wrapperDir = await mkdtemp(join(tmpdir(), 'webcmd-classify-git-'));
  tempHomes.push(wrapperDir);
  const { stdout } = await run('/usr/bin/which', ['git'], { encoding: 'utf8' });
  const wrapper = join(wrapperDir, 'git');
  await writeFile(wrapper, `#!/usr/bin/env node
const { chmodSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('commit')) {
  ${chmodOnFail ? `try { chmodSync(${JSON.stringify(chmodOnFail)}, 0o555); } catch {}` : ''}
  process.exit(1);
}
const result = spawnSync(${JSON.stringify(stdout.trim())}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  await chmod(wrapper, 0o755);
  process.env.PATH = `${wrapperDir}:${originalPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

async function primed(productKey: string) {
  const { homeDir } = await tempSites();
  const product = canonicalProductKey(`https://${productKey}/`);
  await writeProductFile(product.key, 'manifest.json', `${JSON.stringify({
    schemaVersion: 1,
    product,
    interfaces: [],
    seed: { status: 'absent' },
  }, null, 2)}\n`, { homeDir });
  const repo = await openSitesRepository({ homeDir });
  const revision = await repo.commit([`${product.key}/manifest.json`], `init ${product.key}`);
  return { homeDir, sites: join(homeDir, '.webcmd', 'sites'), revision };
}

async function tempSites() {
  const homeDir = await mkdtemp(join(tmpdir(), 'webcmd-classify-'));
  tempHomes.push(homeDir);
  return { homeDir };
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}
