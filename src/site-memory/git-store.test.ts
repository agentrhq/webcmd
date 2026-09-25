import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  lockPathFor,
  REPOSITORY_LOCK_STALE_MS,
  REPOSITORY_LOCK_TIMEOUT_MS,
} from './file-lock.js';
import { installGitShim, restoreGitShim } from './git-shim.js';
import { openSitesRepository } from './git-store.js';
import { listProductKeys, readProductFile, writeProductFile } from './local-store.js';
import { GIT_TEST_TIMEOUT_MS, removeTempDirs } from './__fixtures__/git-test-support.js';

vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT_MS });

const run = promisify(execFile);
const tempHomes: string[] = [];

afterEach(async () => {
  restoreGitShim();
  await removeTempDirs(tempHomes);
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

  it('leaves an existing modified .gitignore byte-identical', async () => {
    const { homeDir, sites } = await tempSites();
    await mkdir(sites, { recursive: true });
    const custom = 'node_modules/\n';
    await writeFile(join(sites, '.gitignore'), custom);
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    await git(sites, ['init']);
    await git(sites, ['add', '--', '.gitignore']);
    await git(sites, ['-c', 'user.name=webcmd', '-c', 'user.email=webcmd@local', 'commit', '-m', 'ignore']);
    const modified = `${custom}*.log\n`;
    await writeFile(join(sites, '.gitignore'), modified);

    await (await openSitesRepository({ homeDir })).commit(['example.test/manifest.json'], 'init');

    expect(await readFile(join(sites, '.gitignore'), 'utf8')).toBe(modified);
    expect(await git(sites, ['show', 'HEAD:.gitignore'])).toBe(custom);
  });

  it('refuses a pre-staged user .gitignore without destaging or rewriting it', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/manifest.json'], 'init');
    const original = await readFile(join(sites, '.gitignore'), 'utf8');
    const modified = `${original}*.log\n`;
    await writeFile(join(sites, '.gitignore'), modified);
    await git(sites, ['add', '--', '.gitignore']);
    const stagedBefore = await git(sites, ['diff', '--cached', '--name-only', '-z']);
    await writeProductFile('example.test', 'notes.md', 'keep\n', { homeDir });

    await expect(repo.commit(['example.test/notes.md'], 'notes')).rejects.toThrow(/staged/i);

    expect(await readFile(join(sites, '.gitignore'), 'utf8')).toBe(modified);
    expect(await git(sites, ['diff', '--cached', '--name-only', '-z'])).toBe(stagedBefore);
    expect(await git(sites, ['show', 'HEAD:.gitignore'])).toBe(original);
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

  it('refuses dirty files in the target product subtree and still stages only explicit paths', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    await writeProductFile('example.test', 'notes.md', 'keep\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/manifest.json', 'example.test/notes.md'], 'init');
    await writeProductFile('example.test', 'manifest.json', '{"ok":true}\n', { homeDir });
    await writeProductFile('example.test', 'notes.md', 'dirty\n', { homeDir });

    await expect(repo.commit(['example.test/manifest.json'], 'notes')).rejects.toThrow(/unrelated/i);
    expect((await git(sites, ['show', 'HEAD:example.test/manifest.json'])).trim()).toBe('{}');
    expect((await git(sites, ['ls-files'])).trim().split('\n')).not.toContain('example.test/scratch.md');
  });

  it('refuses a pre-staged path outside the commit allow-set without destaging it', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('a.test', 'manifest.json', '{}\n', { homeDir });
    await writeProductFile('b.test', 'sitemap/SITE.md', '# B\n\nUNVALIDATED user text with no date and secrets: password=hunter2\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['a.test/manifest.json'], 'init a');
    await git(sites, ['add', '--', 'b.test/sitemap/SITE.md']);
    const stagedBefore = await git(sites, ['diff', '--cached', '--name-only', '-z']);
    await writeProductFile('a.test', 'notes.md', 'keep\n', { homeDir });

    await expect(repo.commit(['a.test/notes.md'], 'a notes')).rejects.toThrow(/staged/i);

    expect(await git(sites, ['diff', '--cached', '--name-only', '-z'])).toBe(stagedBefore);
    expect((await git(sites, ['ls-tree', '-r', '--name-only', 'HEAD'])).trim().split('\n')).not.toContain('b.test/sitemap/SITE.md');
    expect((await git(sites, ['log', '-1', '--format=%s'])).trim()).toBe('init a');
    expect(await readProductFile('b.test', 'sitemap/SITE.md', { homeDir })).toMatch(/password=hunter2/);
  });

  it('does not let an unrelated product\'s dirty files wedge the target product', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/manifest.json'], 'init');
    await writeProductFile('example.test', 'manifest.json', '{"dirty":true}\n', { homeDir });
    await writeProductFile('other.test', 'manifest.json', '{}\n', { homeDir });

    const revision = await repo.commit(['other.test/manifest.json'], 'other');
    expect(revision).toMatch(/^[0-9a-f]{40}$/);
    expect((await git(sites, ['ls-files'])).trim().split('\n')).toEqual(expect.arrayContaining([
      'example.test/manifest.json',
      'other.test/manifest.json',
    ]));
    expect(await readProductFile('example.test', 'manifest.json', { homeDir })).toBe('{"dirty":true}\n');
  });

  it('parses NUL-terminated porcelain so quoted paths can commit themselves', async () => {
    const { homeDir } = await tempSites();
    await writeProductFile('example.test', 'café.md', 'one\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/café.md'], 'unicode');
    await writeProductFile('example.test', 'café.md', 'two\n', { homeDir });

    const revision = await repo.commit(['example.test/café.md'], 'unicode-2');
    expect(revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it('checks a rename destination and consumes the extra source field', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('example.test', 'old.md', 'keep\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/old.md'], 'init');
    await git(sites, ['mv', 'example.test/old.md', 'example.test/new.md']);

    const revision = await repo.commit(['example.test/new.md'], 'rename');

    expect(revision).toMatch(/^[0-9a-f]{40}$/);
    expect((await git(sites, ['ls-files'])).trim().split('\n')).toEqual(expect.arrayContaining(['example.test/new.md']));
    expect((await git(sites, ['ls-files'])).trim().split('\n')).not.toContain('example.test/old.md');
    expect(await git(sites, ['show', 'HEAD:example.test/new.md'])).toBe('keep\n');
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

  it('returns null from showAtHead only when HEAD lacks the path', async () => {
    const { homeDir } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/manifest.json'], 'init');

    expect(await repo.showAtHead('example.test/missing.json')).toBeNull();
    expect(await repo.showAtHead('example.test/manifest.json')).toBe('{}\n');

    installGitShim(async (args, runReal) => {
      if (args.includes('show')) {
        throw Object.assign(new Error('git show exploded'), { code: 128, stderr: 'fatal: not a git repository\n' });
      }
      return runReal();
    });
    await expect(repo.showAtHead('example.test/manifest.json')).rejects.toThrow(/exploded/);
  });

  it('reports whether explicit paths differ from HEAD', async () => {
    const { homeDir } = await tempSites();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const repo = await openSitesRepository({ homeDir });
    await repo.commit(['example.test/manifest.json'], 'init');

    expect(await repo.pathsChanged(['example.test/manifest.json'])).toBe(false);

    await writeProductFile('example.test', 'manifest.json', '{"dirty":true}\n', { homeDir });
    expect(await repo.pathsChanged(['example.test/manifest.json'])).toBe(true);

    await writeProductFile('example.test', 'notes.md', 'untracked\n', { homeDir });
    expect(await repo.pathsChanged(['example.test/notes.md'])).toBe(true);
    expect(await repo.pathsChanged(['example.test/missing.md'])).toBe(false);
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

function failGit(args: readonly string[]): never {
  throw Object.assign(new Error(`Command failed: git ${args.join(' ')}`), { code: 1, stderr: '' });
}

function installFailingCommitGit() {
  installGitShim(async (args, runReal) => args.includes('commit') ? failGit(args) : runReal());
}

function installFailingCommitAndCleanupGit() {
  installGitShim(async (args, runReal) => (
    args.includes('commit') || args.includes('restore') || args.includes('rm') ? failGit(args) : runReal()
  ));
}

function installSlowGit(delayMs: number) {
  installGitShim(async (args, runReal) => {
    if (args.includes('commit')) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return runReal();
  });
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  if (typeof child.pid !== 'number') throw new Error('could not spawn a child to retire');
  return child.pid;
}
