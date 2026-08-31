import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyProduct } from './classify.js';
import { parseProductManifest } from './context.js';
import { openSitesRepository } from './git-store.js';
import { readProductFile, writeProductFile } from './local-store.js';
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

async function withFailingCommit(fn: () => Promise<void>) {
  const wrapperDir = await mkdtemp(join(tmpdir(), 'webcmd-classify-git-'));
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
    await fn();
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
