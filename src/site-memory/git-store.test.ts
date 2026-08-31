import { execFile, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  lockPathFor,
  REPOSITORY_LOCK_STALE_MS,
  REPOSITORY_LOCK_TIMEOUT_MS,
} from './file-lock.js';
import { openSitesRepository } from './git-store.js';
import { listProductKeys, writeProductFile } from './local-store.js';

const run = promisify(execFile);
const tempHomes: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('sites git repository', () => {
  it('initializes on first commit with a dedicated local author and no remote', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });

    const repo = await openSitesRepository({ homeDir });
    const revision = await repo.commit(['example.test/manifest.json'], 'init example.test');

    expect(revision).toMatch(/^[0-9a-f]{40}$/);
    expect(await repo.revision()).toBe(revision);
    expect((await git(sites, ['config', '--local', 'user.name'])).trim()).toBe('webcmd');
    expect((await git(sites, ['config', '--local', 'user.email'])).trim()).toBe('webcmd@local');
    expect((await git(sites, ['log', '-1', '--format=%an <%ae>'])).trim()).toBe('webcmd <webcmd@local>');
    expect((await git(sites, ['remote'])).trim()).toBe('');
  });

  it('creates a gitignore for drafts, locks, temps, fixtures, and verify artifacts', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });

    await (await openSitesRepository({ homeDir })).commit(['example.test/manifest.json'], 'init');

    const ignore = await git(sites, ['show', 'HEAD:.gitignore']);
    expect(ignore).toMatch(/^\.drafts\/$/m);
    expect(ignore).toMatch(/\*\.lock/);
    expect(ignore).toMatch(/\*\.tmp/);
    expect(ignore).toMatch(/fixtures/);
    expect(ignore).toMatch(/verify/);
  });

  it('accepts a repository whose real toplevel is exactly the sites root', async () => {
    const { homeDir, sites } = await tempSites();
    await mkdir(sites, { recursive: true });
    await git(sites, ['init']);
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });

    const revision = await (await openSitesRepository({ homeDir })).commit(['example.test/manifest.json'], 'init');

    expect(await realpath((await git(sites, ['rev-parse', '--show-toplevel'])).trim())).toBe(await realpath(sites));
    expect(revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it('refuses an ancestor repository that owns the sites path', async () => {
    const { homeDir, sites } = await tempSites();
    await mkdir(sites, { recursive: true });
    await git(homeDir, ['init']);

    await expect(openSitesRepository({ homeDir })).rejects.toThrow(/ancestor/i);
  });

  it('refuses to commit when an unrelated dirty file exists', async () => {
    const { homeDir } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/manifest.json'], 'init');
    await writeProductFile('example.test', 'manifest.json', '{"dirty":true}\n', { homeDir });
    await writeProductFile('other.test', 'manifest.json', '{}\n', { homeDir });

    await expect(repo.commit(['other.test/manifest.json'], 'other')).rejects.toThrow(/unrelated/i);
  });

  it('stages only explicit paths and never git add .', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    await writeProductFile('example.test', 'fixtures/sample.json', '{"ok":true}\n', { homeDir });
    await mkdir(join(sites, '.drafts', 'task'), { recursive: true });
    await writeFile(join(sites, '.drafts', 'task', 'scratch.md'), 'draft');

    await (await openSitesRepository({ homeDir })).commit(['example.test/manifest.json'], 'init');

    const files = (await git(sites, ['ls-files'])).trim().split('\n').sort();
    expect(files).toEqual(['.gitignore', 'example.test/manifest.json']);
  });

  it('serializes concurrent commits so both explicit writes survive', async () => {
    const { homeDir, sites } = await tempSites();
    const repo = await openSitesRepository({ homeDir });
    await writeProductFile('a.test', 'manifest.json', 'a\n', { homeDir });
    await writeProductFile('b.test', 'manifest.json', 'b\n', { homeDir });

    await Promise.all([
      repo.commit(['a.test/manifest.json'], 'a'),
      repo.commit(['b.test/manifest.json'], 'b'),
    ]);

    const files = (await git(sites, ['ls-files'])).trim().split('\n').sort();
    expect(files).toEqual(['.gitignore', 'a.test/manifest.json', 'b.test/manifest.json']);
  });

  it('commits from inside withRepositoryLock without deadlocking', async () => {
    const { homeDir } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });

    const revision = await repo.withRepositoryLock(async () =>
      repo.commit(['example.test/manifest.json'], 'nested'),
    );

    expect(revision).toMatch(/^[0-9a-f]{40}$/);
    expect(await repo.revision()).toBe(revision);
  }, 5_000);

  it('keeps a slow git commit inside the repository-specific stale bound', async () => {
    expect(REPOSITORY_LOCK_STALE_MS).toBeGreaterThan(LOCK_STALE_MS);
    expect(REPOSITORY_LOCK_TIMEOUT_MS).toBeGreaterThan(LOCK_TIMEOUT_MS);

    const { homeDir } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    await installSlowGit(250);
    const started = Date.now();

    const revision = await (await openSitesRepository({ homeDir })).commit(['example.test/manifest.json'], 'slow');

    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it('recovers a repository lock left by a stale owner', async () => {
    const { homeDir, sites } = await tempSites();
    await mkdir(sites, { recursive: true });
    const lockPath = lockPathFor(join(sites, '.repository'));
    await writeFile(lockPath, `${JSON.stringify({ pid: deadPid(), host: hostname(), token: 'stale' })}\n`);
    const past = new Date(Date.now() - REPOSITORY_LOCK_STALE_MS - 1_000);
    await utimes(lockPath, past, past);

    const repo = await openSitesRepository({ homeDir });
    await expect(repo.withRepositoryLock(async () => 'ok')).resolves.toBe('ok');
  });

  it('restores only staged paths after a failed first commit without HEAD', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    await mkdir(join(sites, '.drafts', 'task'), { recursive: true });
    await writeFile(join(sites, '.drafts', 'task', 'scratch.md'), 'draft');
    await writeFile(join(sites, 'keep-me.txt'), 'unrelated\n');
    await installFailingCommitGit();

    await expect(
      (await openSitesRepository({ homeDir })).commit(['example.test/manifest.json'], 'init'),
    ).rejects.toThrow();

    expect((await git(sites, ['ls-files'])).trim()).toBe('');
    expect(await git(sites, ['status', '--porcelain', '-uall'])).toMatch(/^\?\? keep-me\.txt$/m);
    expect(await git(sites, ['status', '--porcelain', '-uall'])).not.toMatch(/^(A |AD|D )/m);
    expect(await readFile(join(sites, 'example.test', 'manifest.json'), 'utf8')).toBe('{}\n');
    await expect(git(sites, ['rev-parse', 'HEAD'])).rejects.toThrow();
  });

  it('restores only staged paths after a failed commit when HEAD exists', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/manifest.json'], 'init');
    const head = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    await writeProductFile('example.test', 'notes.md', 'keep later\n', { homeDir });
    await writeFile(join(sites, 'keep-me.txt'), 'unrelated\n');
    await installFailingCommitGit();

    await expect(repo.commit(['example.test/notes.md'], 'notes')).rejects.toThrow();

    expect((await git(sites, ['ls-files'])).trim().split('\n').sort()).toEqual(['.gitignore', 'example.test/manifest.json']);
    expect((await git(sites, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect(await git(sites, ['status', '--porcelain', '-uall'])).toMatch(/^\?\? keep-me\.txt$/m);
    expect(await git(sites, ['status', '--porcelain', '-uall'])).toMatch(/^\?\? example\.test\/notes\.md$/m);
    expect(await git(sites, ['status', '--porcelain', '-uall'])).not.toMatch(/^(A |AD)/m);
  });

  it('exposes commit and cleanup failures together when restore also fails', async () => {
    const { homeDir } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/manifest.json'], 'init');
    await writeProductFile('example.test', 'notes.md', 'keep later\n', { homeDir });
    await installFailingCommitAndCleanupGit();

    const error = await repo.commit(['example.test/notes.md'], 'notes').then(
      () => {
        throw new Error('expected commit to fail');
      },
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AggregateError);
    const aggregate = error as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.message).toMatch(/cleanup/i);
    expect(aggregate.errors.map((item) => (item instanceof Error ? item.message : String(item))).join('\n')).toMatch(
      /restore|rm --cached/,
    );
  });

  it('excludes .git, .drafts, and other dot entries from product enumeration', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    await mkdir(join(sites, '.drafts', 'task'), { recursive: true });
    await mkdir(join(sites, '.cache'), { recursive: true });
    await writeFile(join(sites, '.hidden'), 'nope');
    await (await openSitesRepository({ homeDir })).commit(['example.test/manifest.json'], 'init');

    await expect(listProductKeys({ homeDir })).resolves.toEqual(['example.test']);
  });
});

async function tempSites() {
  const homeDir = await mkdtemp(join(tmpdir(), 'webcmd-git-store-'));
  tempHomes.push(homeDir);
  return { homeDir, sites: join(homeDir, '.webcmd', 'sites') };
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}

async function installFailingCommitGit() {
  const dir = await mkdtemp(join(tmpdir(), 'webcmd-fail-git-'));
  tempHomes.push(dir);
  const { stdout } = await run('/usr/bin/which', ['git'], { encoding: 'utf8' });
  const wrapper = join(dir, 'git');
  await writeFile(wrapper, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('commit')) process.exit(1);
const result = spawnSync(${JSON.stringify(stdout.trim())}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  await chmod(wrapper, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH}`;
}

async function installFailingCommitAndCleanupGit() {
  const dir = await mkdtemp(join(tmpdir(), 'webcmd-fail-git-cleanup-'));
  tempHomes.push(dir);
  const { stdout } = await run('/usr/bin/which', ['git'], { encoding: 'utf8' });
  const wrapper = join(dir, 'git');
  await writeFile(wrapper, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('commit') || args.includes('restore') || args.includes('rm')) process.exit(1);
const result = spawnSync(${JSON.stringify(stdout.trim())}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  await chmod(wrapper, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH}`;
}

async function installSlowGit(delayMs: number) {
  const dir = await mkdtemp(join(tmpdir(), 'webcmd-slow-git-'));
  tempHomes.push(dir);
  const { stdout } = await run('/usr/bin/which', ['git'], { encoding: 'utf8' });
  const wrapper = join(dir, 'git');
  await writeFile(wrapper, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('commit')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${delayMs});
const result = spawnSync(${JSON.stringify(stdout.trim())}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  await chmod(wrapper, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH}`;
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  if (typeof child.pid !== 'number') throw new Error('could not spawn a child to retire');
  return child.pid;
}
