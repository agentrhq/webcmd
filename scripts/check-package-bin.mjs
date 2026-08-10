#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatPackageBinSpawnFailure,
  packageBinSpawnOptions,
} from '../dist/src/package-bin-process.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const binEntries = Object.entries(pkg.bin ?? {});

function fail(message) {
  console.error(`package-bin check failed: ${message}`);
  process.exit(1);
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...packageBinSpawnOptions(process.platform, command),
    ...opts,
  });
  if (result.error || result.status !== 0) {
    fail(formatPackageBinSpawnFailure(command, args, result));
  }
  return result;
}

function parseNpmJsonArray(stdout) {
  const text = stdout.trim();
  const jsonStart = text.lastIndexOf('\n[');
  const jsonText = jsonStart === -1 ? text : text.slice(jsonStart + 1);
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to the clearer failure below.
  }
  fail(`npm did not return a JSON array:\n${stdout.trim()}`);
}

if (binEntries.length === 0) {
  fail('package.json has no bin entries');
}

for (const [name, target] of binEntries) {
  const targetPath = path.join(ROOT, String(target));
  if (!fs.existsSync(targetPath)) {
    fail(`bin "${name}" target is missing: ${target}`);
  }
  const firstLine = fs.readFileSync(targetPath, 'utf8').split(/\r?\n/, 1)[0];
  if (!firstLine.startsWith('#!/usr/bin/env node')) {
    fail(`bin "${name}" target is missing a node shebang: ${target}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-package-bin-'));
try {
  const pack = run('npm', ['pack', '--ignore-scripts', '--pack-destination', tmp, '--json']);
  const packData = parseNpmJsonArray(pack.stdout)[0];
  if (!packData?.filename || !Array.isArray(packData.files)) {
    fail('npm pack did not return the expected JSON payload');
  }

  const packedPaths = new Set(packData.files.map((file) => file.path));
  for (const prefix of ['clis/', 'plugins/']) {
    if ([...packedPaths].some((packedPath) => packedPath.startsWith(prefix))) {
      fail(`packed tarball contains adapter source: ${prefix}`);
    }
  }
  if (packedPaths.has('scripts/fetch-adapters.js')) {
    fail('packed tarball contains the retired adapter fetch lifecycle');
  }

  // Every command the core manifest advertises must be in the tarball. A
  // manifest entry whose module was left behind is discoverable but dies with
  // ADAPTER_LOAD on first use — see #247, where web/fetch-browser was the only
  // escalation path FETCH_BLOCKED knew how to recommend.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'cli-manifest.json'), 'utf8'));
  for (const entry of manifest) {
    if (!entry.modulePath) continue;
    const packedModule = `dist/src/clis/${entry.modulePath}`;
    if (!packedPaths.has(packedModule)) {
      fail(`packed tarball is missing manifest module for ${entry.site}/${entry.name}: ${packedModule}`);
    }
  }
  if (manifest.length > 0 && !packedPaths.has('dist/src/cli-manifest.json')) {
    fail('packed tarball is missing the staged core manifest: dist/src/cli-manifest.json');
  }
  for (const [name, target] of binEntries) {
    if (!packedPaths.has(String(target))) {
      fail(`packed tarball is missing bin "${name}" target: ${target}`);
    }
  }

  const tarball = path.join(tmp, packData.filename);
  const prefix = path.join(tmp, 'prefix');
  run('npm', ['install', '-g', tarball, '--prefix', prefix, '--ignore-scripts']);

  for (const [name] of binEntries) {
    const binPath = process.platform === 'win32'
      ? path.join(prefix, `${name}.cmd`)
      : path.join(prefix, 'bin', name);
    if (!fs.existsSync(binPath)) {
      fail(`global install did not create executable: ${binPath}`);
    }
    run(binPath, ['--version'], { cwd: tmp });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`package-bin check passed for ${binEntries.map(([name]) => name).join(', ')}`);
