import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prepareScript = path.join(packageRoot, 'scripts/prepare.mjs');
const scripts = (JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as { scripts: Record<string, string> }).scripts;

/**
 * npm runs these through the platform shell, which is cmd.exe on Windows, so
 * they may not use POSIX sh syntax: `npm install`/`npm ci`/`npm uninstall`
 * fail outright when one of them does.
 */
const INSTALL_LIFECYCLE_SCRIPTS = ['preuninstall', 'postinstall', 'prepare', 'prepublishOnly'] as const;

/**
 * POSIX sh constructs cmd.exe cannot run. `&&`/`||` themselves are fine in
 * cmd.exe — what breaks is chaining to a shell builtin it does not have, which
 * is how the old `[ -d src ] && npm run build || true` aborted `npm ci`.
 */
const SHELL_ONLY_SYNTAX: ReadonlyArray<[label: string, pattern: RegExp]> = [
  ['test brackets', /(?:^|\s)\[+(?:\s|$)/],
  ['chained shell builtin', /(?:\|\||&&)\s*(?:true|false|:)\b/],
  ['command substitution', /\$\(|`/],
  ['inline environment assignment', /^\s*[A-Za-z_][A-Za-z0-9_]*=/],
];

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

/**
 * Copy the real prepare script into a throwaway package so it resolves that
 * directory as its package root — the script derives the root from its own
 * location, so no test-only override is needed.
 */
function prepareFixture(buildScript?: string): string {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webcmd-prepare-'));
  fixtureRoots.push(fixtureRoot);
  mkdirSync(path.join(fixtureRoot, 'scripts'));
  copyFileSync(prepareScript, path.join(fixtureRoot, 'scripts/prepare.mjs'));
  writeFileSync(
    path.join(fixtureRoot, 'package.json'),
    `${JSON.stringify({
      name: 'webcmd-prepare-fixture',
      version: '0.0.0',
      private: true,
      ...(buildScript ? { scripts: { build: buildScript } } : {}),
    }, null, 2)}\n`,
  );
  return fixtureRoot;
}

function runPrepare(fixtureRoot: string) {
  // The script is a Node script; Bun's execPath points at bun, which is not
  // what we want to exercise here.
  return spawnSync('node', [path.join(fixtureRoot, 'scripts/prepare.mjs')], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });
}

describe('install lifecycle scripts', () => {
  it.each(INSTALL_LIFECYCLE_SCRIPTS)('defines %s', (name) => {
    expect(scripts[name]).toBeTruthy();
  });

  it.each(INSTALL_LIFECYCLE_SCRIPTS)('runs %s without POSIX-only shell syntax', (name) => {
    const script = scripts[name]!;

    expect(SHELL_ONLY_SYNTAX.filter(([, pattern]) => pattern.test(script)).map(([label]) => label))
      .toEqual([]);
  });
});

describe('prepare script', () => {
  it('skips the build when the package has no source tree', () => {
    const result = runPrepare(prepareFixture('node -e "process.exit(1)"'));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  }, 20_000);

  it('builds when the package ships its source tree', () => {
    const fixtureRoot = prepareFixture(
      `node -e "require('fs').writeFileSync('built.txt', 'ok')"`,
    );
    mkdirSync(path.join(fixtureRoot, 'src'));

    const result = runPrepare(fixtureRoot);

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixtureRoot, 'built.txt'), 'utf8')).toBe('ok');
  }, 60_000);

  it('warns but still succeeds when the build fails', () => {
    const fixtureRoot = prepareFixture('node -e "process.exit(1)"');
    mkdirSync(path.join(fixtureRoot, 'src'));

    const result = runPrepare(fixtureRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('did not complete');
  }, 60_000);
});
