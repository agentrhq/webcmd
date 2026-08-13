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

function output(result) {
  return `${result.stdout}${result.stderr}`;
}

function requireOutput(result, text, label) {
  if (!output(result).includes(text)) {
    fail(`${label} did not include ${JSON.stringify(text)}:\n${output(result).trim()}`);
  }
}

function rejectOutput(result, text, label) {
  if (output(result).includes(text)) {
    fail(`${label} unexpectedly included ${JSON.stringify(text)}:\n${output(result).trim()}`);
  }
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
  for (const prefix of ['clis/', 'plugins/', 'clis/web/', 'src/fetch/browser', 'dist/src/fetch/browser']) {
    if ([...packedPaths].some((packedPath) => packedPath.startsWith(prefix))) {
      fail(`packed tarball contains adapter source: ${prefix}`);
    }
  }
  if ([...packedPaths].some((packedPath) => packedPath.includes('fetch-browser'))) {
    fail('packed tarball contains fetch-browser artifact');
  }
  if (packedPaths.has('scripts/fetch-adapters.js')) {
    fail('packed tarball contains the retired adapter fetch lifecycle');
  }
  for (const [name, target] of binEntries) {
    if (!packedPaths.has(String(target))) {
      fail(`packed tarball is missing bin "${name}" target: ${target}`);
    }
  }

  const tarball = path.join(tmp, packData.filename);
  const prefix = path.join(tmp, 'prefix');
  run('npm', ['install', '-g', tarball, '--prefix', prefix, '--ignore-scripts']);
  const isolatedHome = path.join(tmp, 'home');
  const isolatedConfig = path.join(tmp, 'config');
  fs.mkdirSync(isolatedHome);
  fs.mkdirSync(isolatedConfig);
  const installedEnv = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    WEBCMD_CONFIG_DIR: isolatedConfig,
  };

  for (const [name] of binEntries) {
    const binPath = process.platform === 'win32'
      ? path.join(prefix, `${name}.cmd`)
      : path.join(prefix, 'bin', name);
    if (!fs.existsSync(binPath)) {
      fail(`global install did not create executable: ${binPath}`);
    }
    run(binPath, ['--version'], { cwd: tmp, env: installedEnv });
    const fetchHelp = run(binPath, ['web', 'fetch', '--help'], { cwd: tmp, env: installedEnv });
    for (const option of ['--url', '--timeout', '--max-chars', '--allow-private']) {
      requireOutput(fetchHelp, option, 'web fetch --help');
    }
    const webHelp = run(binPath, ['web', '--help'], { cwd: tmp, env: installedEnv });
    requireOutput(webHelp, 'fetch', 'web --help');
    rejectOutput(webHelp, 'fetch-browser', 'web --help');
    const list = run(binPath, ['list', '-f', 'json'], { cwd: tmp, env: installedEnv });
    const listedCommands = JSON.parse(list.stdout);
    if (listedCommands.filter((command) => command.command === 'web/fetch').length !== 1) {
      fail(`list -f json did not contain exactly one web/fetch:\n${list.stdout.trim()}`);
    }
    if (listedCommands.some((command) => command.command === 'web/fetch-browser')) {
      fail(`list -f json unexpectedly contained web/fetch-browser:\n${list.stdout.trim()}`);
    }
    const completions = run(binPath, ['--get-completions', '--cursor', '2', 'web'], { cwd: tmp, env: installedEnv });
    requireOutput(completions, 'fetch', '--get-completions --cursor 2 web');
    rejectOutput(completions, 'fetch-browser', '--get-completions --cursor 2 web');
  }

  const packageRoot = run('npm', ['root', '-g', '--prefix', prefix]).stdout.trim();
  const installedPackagePath = path.join(packageRoot, pkg.name);
  const fetchExport = pkg.exports?.['./fetch/command'];
  if (typeof fetchExport !== 'string') fail('package.json has no ./fetch/command export');
  const installedFetchCommand = path.join(installedPackagePath, fetchExport);
  if (!fs.existsSync(installedFetchCommand)) {
    fail(`installed package is missing fetch command export: ${installedFetchCommand}`);
  }
  run(process.execPath, ['--input-type=module', '--eval', `import(${JSON.stringify(new URL(`file://${installedFetchCommand}`).href)})`], {
    cwd: tmp,
    env: installedEnv,
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`package-bin check passed for ${binEntries.map(([name]) => name).join(', ')}`);
