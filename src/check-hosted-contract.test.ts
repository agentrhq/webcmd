import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { browserCommandCatalog } from './browser/command-catalog.js';
import { buildManifestArtifacts } from './build-manifest.js';
import { PKG_VERSION } from './version.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkerPath = path.join(packageRoot, 'scripts/check-hosted-contract.mjs');
const committedArtifactNames = ['cli-manifest.json', 'hosted-contract.json'] as const;
const fixtureRoots: string[] = [];

afterEach(() => {
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function createCommittedArtifactFixture(): string {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'webcmd-contract-committed-'));
  fixtureRoots.push(fixtureRoot);
  copyFileSync(path.join(packageRoot, 'cli-manifest.json'), path.join(fixtureRoot, 'cli-manifest.json'));
  const manifest = JSON.parse(
    readFileSync(path.join(fixtureRoot, 'cli-manifest.json'), 'utf8'),
  ) as Parameters<typeof buildManifestArtifacts>[0];
  writeFileSync(
    path.join(fixtureRoot, 'hosted-contract.json'),
    buildManifestArtifacts(manifest, PKG_VERSION, browserCommandCatalog).hostedContractJson,
  );
  return fixtureRoot;
}

function rootArtifactHashes(): Record<string, string> {
  return Object.fromEntries(['cli-manifest.json'].map((artifactName) => [
    artifactName,
    createHash('sha256').update(readFileSync(path.join(packageRoot, artifactName))).digest('hex'),
  ]));
}

function runChecker(committedRoot: string) {
  // The checker is a Node script; Bun's execPath points at bun, which is not
  // what we want to exercise here.
  return spawnSync('node', [checkerPath], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, WEBCMD_CONTRACT_COMMITTED_ROOT: committedRoot },
  });
}

describe('hosted contract reproducibility checker', () => {
  it('accepts a byte-identical committed manifest and generates the package contract', () => {
    const result = runChecker(createCommittedArtifactFixture());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('hosted-contract.json generated successfully.');
  }, 10_000);

  it.each(committedArtifactNames)('rejects one stale byte in %s without mutating root artifacts', (artifactName) => {
    const before = rootArtifactHashes();
    const fixtureRoot = createCommittedArtifactFixture();
    const stalePath = path.join(fixtureRoot, artifactName);
    const staleBytes = readFileSync(stalePath);
    staleBytes[0] ^= 1;
    writeFileSync(stalePath, staleBytes);

    const result = runChecker(fixtureRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(artifactName);
    expect(rootArtifactHashes()).toEqual(before);
  }, 10_000);
});
