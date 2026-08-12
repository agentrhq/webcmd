#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const committedRoot = process.env.WEBCMD_CONTRACT_COMMITTED_ROOT
  ? path.resolve(process.env.WEBCMD_CONTRACT_COMMITTED_ROOT)
  : packageRoot;
const generatedRoot = mkdtempSync(path.join(tmpdir(), 'webcmd-hosted-contract-'));
const committedArtifactNames = ['cli-manifest.json', 'hosted-contract.json'];

const generator = String.raw`
  import { readFile, writeFile } from 'node:fs/promises';
  import path from 'node:path';
  import { pathToFileURL } from 'node:url';

  const packageRoot = process.env.WEBCMD_PACKAGE_ROOT;
  const outputRoot = process.env.WEBCMD_CONTRACT_OUTPUT_ROOT;
  if (!packageRoot || !outputRoot) throw new Error('Missing contract generation paths');

  const moduleUrl = pathToFileURL(path.join(packageRoot, 'src/build-manifest.ts')).href;
  const {
    buildManifest,
    buildManifestArtifacts,
    findManifestMetadataIssues,
  } = await import(moduleUrl);
  const { entries, failures } = await buildManifest();
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => failure.message).join('\n'));
  }
  const metadataIssues = findManifestMetadataIssues(entries);
  if (metadataIssues.length > 0) {
    throw new Error(
      metadataIssues
        .map((issue) => issue.site + '/' + issue.command + ': ' + issue.reason)
        .join('\n'),
    );
  }

  const packageMetadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (typeof packageMetadata.version !== 'string') {
    throw new Error('Package version is required');
  }
  const artifacts = buildManifestArtifacts(entries, packageMetadata.version, []);
  await Promise.all([
    writeFile(path.join(outputRoot, 'cli-manifest.json'), artifacts.manifestJson),
    writeFile(path.join(outputRoot, 'hosted-contract.json'), artifacts.hostedContractJson),
  ]);
`;

try {
  const generation = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', generator],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        WEBCMD_PACKAGE_ROOT: packageRoot,
        WEBCMD_CONTRACT_OUTPUT_ROOT: generatedRoot,
      },
    },
  );
  if (generation.error) throw generation.error;
  if (generation.status !== 0) {
    process.stderr.write(generation.stdout);
    process.stderr.write(generation.stderr);
    process.exitCode = generation.status ?? 1;
  } else {
    const dirtyArtifacts = committedArtifactNames.filter((artifactName) => {
      const committed = readFileSync(path.join(committedRoot, artifactName));
      const generated = readFileSync(path.join(generatedRoot, artifactName));
      return !committed.equals(generated);
    });

    if (dirtyArtifacts.length > 0) {
      process.stderr.write(
        `Generated contract artifacts are out of date: ${dirtyArtifacts.join(', ')}\n`
        + 'Run `npm run build`, then commit the updated manifest.\n',
      );
      process.exitCode = 1;
    } else {
      const generatedContract = JSON.parse(
        readFileSync(path.join(generatedRoot, 'hosted-contract.json'), 'utf8'),
      );
      if (
        generatedContract?.schemaVersion !== 1
        || typeof generatedContract?.webcmdVersion !== 'string'
        || !Array.isArray(generatedContract?.commands)
        || !Array.isArray(generatedContract?.browserCommands)
      ) {
        process.stderr.write('Generated hosted-contract.json is structurally invalid.\n');
        process.exitCode = 1;
      } else {
        process.stdout.write(
          'Generated cli-manifest.json and hosted-contract.json match committed bytes; hosted-contract.json generated successfully.\n',
        );
      }
    }
  }
} finally {
  rmSync(generatedRoot, { recursive: true, force: true });
}
