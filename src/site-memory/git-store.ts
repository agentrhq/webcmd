import { execFile as execFileCb } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { REPOSITORY_LOCK_STALE_MS, REPOSITORY_LOCK_TIMEOUT_MS, withFileLock } from './file-lock.js';
import { atomicWrite, containedRelativePath, sitesRoot, type LocalStoreOptions } from './local-store.js';
import type { MemoryRevision } from './model.js';

const execFile = promisify(execFileCb);
const AUTHOR_NAME = 'webcmd';
const AUTHOR_EMAIL = 'webcmd@local';
const GITIGNORE = ['.drafts/', '*.lock', '*.tmp', '**/fixtures/', '**/verify/', ''].join('\n');
const GIT_FLAGS = [
  '-c', `user.name=${AUTHOR_NAME}`,
  '-c', `user.email=${AUTHOR_EMAIL}`,
  '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null',
];

export interface SitesRepository {
  revision(): Promise<MemoryRevision | null>;
  commit(paths: string[], message: string, allowedDirty?: string[]): Promise<MemoryRevision>;
  pathsChanged(paths: string[]): Promise<boolean>;
  withRepositoryLock<T>(fn: () => Promise<T>): Promise<T>;
}

export async function openSitesRepository(options: LocalStoreOptions = {}): Promise<SitesRepository> {
  const root = await ensureSitesRoot(options);
  await assertExactRootOrAbsent(root);
  return {
    revision: () => revisionOf(root),
    commit: (paths, message, allowedDirty) => withRepositoryLock(root, () => commitPaths(root, paths, message, allowedDirty)),
    pathsChanged: (paths) => pathsDifferFromHead(root, paths),
    withRepositoryLock: (fn) => withRepositoryLock(root, fn),
  };
}

function withRepositoryLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(join(root, '.repository'), fn, {
    staleMs: REPOSITORY_LOCK_STALE_MS,
    timeoutMs: REPOSITORY_LOCK_TIMEOUT_MS,
  });
}

async function ensureSitesRoot(options: LocalStoreOptions): Promise<string> {
  const root = sitesRoot(options);
  await mkdir(root, { recursive: true });
  return realpath(root);
}

async function commitPaths(root: string, paths: string[], message: string, allowedDirty: string[] = []): Promise<MemoryRevision> {
  if (paths.length === 0) throw new Error('Refusing to commit without explicit paths.');
  await ensureRepository(root);
  const relativePaths = paths.map((path) => containedRelativePath(root, path));
  await atomicWrite(join(root, '.gitignore'), GITIGNORE);
  await assertNoUnrelatedDirty(root, [...relativePaths, ...allowedDirty.map((path) => containedRelativePath(root, path))]);
  try {
    await git(root, ['add', '--', ...relativePaths, '.gitignore']);
    await git(root, ['commit', '--no-gpg-sign', '-m', message]);
  } catch (err) {
    try {
      await restoreStagedPaths(root, relativePaths);
    } catch (cleanupErr) {
      throw new AggregateError([err, cleanupErr], 'Commit failed and index cleanup also failed');
    }
    throw err;
  }
  return (await git(root, ['rev-parse', 'HEAD'])).trim();
}

async function pathsDifferFromHead(root: string, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return false;
  const relativePaths = paths.map((path) => containedRelativePath(root, path));
  const status = await git(root, ['status', '--porcelain', '-z', '-uall', '--', ...relativePaths]);
  return porcelainEntries(status).length > 0;
}

async function restoreStagedPaths(root: string, relativePaths: string[]): Promise<void> {
  const paths = [...relativePaths, '.gitignore'];
  if (await revisionOf(root) !== null) {
    await git(root, ['restore', '--staged', '--', ...paths]);
  } else {
    await git(root, ['rm', '--cached', '-f', '--ignore-unmatch', '--', ...paths]);
  }
}

async function ensureRepository(root: string): Promise<void> {
  if (!await hasExactRepository(root)) {
    await git(root, ['init']);
    await assertExactRoot(root);
  }
  await git(root, ['config', 'user.name', AUTHOR_NAME]);
  await git(root, ['config', 'user.email', AUTHOR_EMAIL]);
}

async function revisionOf(root: string): Promise<MemoryRevision | null> {
  try {
    return (await git(root, ['rev-parse', 'HEAD'])).trim();
  } catch {
    return null;
  }
}

async function assertExactRootOrAbsent(root: string): Promise<void> {
  try {
    await assertExactRoot(root);
  } catch (err) {
    if (isNotRepo(err)) return;
    throw err;
  }
}

async function hasExactRepository(root: string): Promise<boolean> {
  try {
    await assertExactRoot(root);
    return true;
  } catch (err) {
    if (isNotRepo(err)) return false;
    throw err;
  }
}

async function assertExactRoot(root: string): Promise<void> {
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  if (await realpath(top) !== await realpath(root)) {
    throw new Error('An ancestor Git repository owns the sites path; it is not the sites repository.');
  }
}

async function assertNoUnrelatedDirty(root: string, allowed: string[]): Promise<void> {
  const allow = new Set([...allowed, '.gitignore']);
  const scopes = productScopes(allowed);
  if (scopes.length === 0) return;
  const status = await git(root, ['status', '--porcelain', '-z', '-uall', '--', ...scopes]);
  for (const { code, path } of porcelainEntries(status)) {
    if (code === '??' || code === '!!') continue;
    if (!allow.has(path)) throw new Error(`Refusing to commit unrelated dirty path: ${path}`);
  }
}

function productScopes(allowed: string[]): string[] {
  const scopes = new Set<string>();
  for (const path of allowed) {
    if (path === '.gitignore') continue;
    const product = path.split('/')[0];
    if (product) scopes.add(product);
  }
  return [...scopes];
}

function porcelainEntries(status: string): { code: string; path: string }[] {
  const entries: { code: string; path: string }[] = [];
  const parts = status.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const code = part.slice(0, 2);
    const path = part.slice(3);
    if (code.includes('R') || code.includes('C')) {
      i += 1;
      entries.push({ code, path: parts[i] || path });
    } else {
      entries.push({ code, path });
    }
  }
  return entries;
}

async function git(root: string, args: string[]): Promise<string> {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  env.GIT_AUTHOR_NAME = AUTHOR_NAME;
  env.GIT_AUTHOR_EMAIL = AUTHOR_EMAIL;
  env.GIT_COMMITTER_NAME = AUTHOR_NAME;
  env.GIT_COMMITTER_EMAIL = AUTHOR_EMAIL;
  const { stdout } = await execFile('git', [...GIT_FLAGS, ...args], { cwd: root, encoding: 'utf8', env });
  return stdout;
}

function isNotRepo(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const stderr = 'stderr' in err && typeof err.stderr === 'string' ? err.stderr : '';
  return 'code' in err && err.code === 128 && /not a git repository/i.test(stderr);
}
