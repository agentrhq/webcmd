import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkerPath = path.join(packageRoot, 'scripts/check-plugin-pr-scope.mjs');
const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function write(root: string, relativePath: string, contents = relativePath): void {
  const destination = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function commit(root: string, message: string): string {
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

function fixture(change: (root: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), 'webcmd-plugin-pr-scope-'));
  fixtureRoots.push(root);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  write(root, 'README.md', 'before\n');
  write(root, 'webcmd-plugin.json', '{}\n');
  write(root, 'package.json', '{}\n');
  write(root, '.github/workflows/ci.yml', 'name: CI\n');
  write(root, 'plugins/existing/webcmd-plugin.json', '{}\n');
  write(root, 'plugins/existing/index.js', 'export {};\n');
  const base = commit(root, 'base');
  change(root);
  const head = commit(root, 'head');
  return { root, base, head };
}

function addPlugin(root: string, name: string): void {
  write(root, `plugins/${name}/webcmd-plugin.json`, '{}\n');
  write(root, `plugins/${name}/index.js`, 'export {};\n');
}

function runGuard(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [checkerPath, ...args], { cwd: root, encoding: 'utf8' });
}

describe('plugin-only PR scope guard', () => {
  it('accepts changes contained in one newly added plugin', () => {
    const { root, base, head } = fixture((repo) => addPlugin(repo, 'foo'));

    expect(runGuard(root, base, head).status).toBe(0);
  });

  it.each([
    ['README.md', (root: string) => write(root, 'README.md', 'after\n')],
    ['webcmd-plugin.json', (root: string) => write(root, 'webcmd-plugin.json', '{"changed":true}\n')],
    ['package.json', (root: string) => write(root, 'package.json', '{"changed":true}\n')],
    ['.github/workflows/ci.yml', (root: string) => write(root, '.github/workflows/ci.yml', 'name: changed\n')],
    ['docs/note.md', (root: string) => write(root, 'docs/note.md')],
  ])('rejects a new plugin plus %s', (outsidePath, addOutsideChange) => {
    const { root, base, head } = fixture((repo) => {
      addPlugin(repo, 'foo');
      addOutsideChange(repo);
    });

    const result = runGuard(root, base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(outsidePath);
  });

  it('accepts changes contained in two newly added plugins', () => {
    const { root, base, head } = fixture((repo) => {
      addPlugin(repo, 'foo');
      addPlugin(repo, 'bar');
    });

    expect(runGuard(root, base, head).status).toBe(0);
  });

  it('rejects a new plugin plus an existing-plugin edit', () => {
    const { root, base, head } = fixture((repo) => {
      addPlugin(repo, 'foo');
      write(repo, 'plugins/existing/index.js', 'export const changed = true;\n');
    });

    const result = runGuard(root, base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('plugins/existing/index.js');
  });

  it.each([
    ['existing-plugin maintenance', (root: string) => write(root, 'plugins/existing/index.js', 'export const changed = true;\n')],
    ['a non-plugin change', (root: string) => write(root, 'README.md', 'after\n')],
  ])('does not activate for %s', (_label, change) => {
    const { root, base, head } = fixture(change);

    expect(runGuard(root, base, head).status).toBe(0);
  });

  it('rejects the deleted paths of a renamed existing plugin', () => {
    const { root, base, head } = fixture((repo) => {
      renameSync(path.join(repo, 'plugins/existing'), path.join(repo, 'plugins/renamed'));
    });

    const result = runGuard(root, base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('plugins/existing/webcmd-plugin.json');
  });

  it('does not treat a plugin name as a path prefix', () => {
    const { root, base, head } = fixture((repo) => {
      addPlugin(repo, 'foo');
      write(repo, 'plugins/foo-bar/index.js', 'export {};\n');
    });

    const result = runGuard(root, base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('plugins/foo-bar/index.js');
  });

  it('fails clearly when SHAs are missing or invalid', () => {
    const missing = runGuard(packageRoot);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Usage:');

    const { root, head } = fixture((repo) => write(repo, 'README.md', 'after\n'));
    const invalid = runGuard(root, 'not-a-sha', head);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Invalid base SHA');
  });
});
