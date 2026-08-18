#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const [baseArg, headArg, ...extraArgs] = process.argv.slice(2);

if (!baseArg || !headArg || extraArgs.length) {
  console.error('Usage: check-plugin-pr-scope <base-sha> <head-sha>');
  process.exit(1);
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) {
    console.error(`Failed to run git: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

function resolveSha(label, value) {
  const result = git(['rev-parse', '--verify', `${value}^{commit}`]);
  if (result.status !== 0) {
    console.error(`Invalid ${label} SHA: ${value}`);
    process.exit(1);
  }
  return result.stdout.trim();
}

const base = resolveSha('base', baseArg);
const head = resolveSha('head', headArg);
const mergeBaseResult = git(['merge-base', base, head]);
if (mergeBaseResult.status !== 0) {
  console.error(`Could not find a merge base for ${baseArg} and ${headArg}.`);
  process.exit(1);
}

const mergeBase = mergeBaseResult.stdout.trim();
const diffResult = git(['diff', '--name-status', '-z', '--no-renames', mergeBase, head, '--']);
if (diffResult.status !== 0) {
  console.error('Could not read the pull request diff.');
  process.exit(1);
}

const fields = diffResult.stdout.split('\0');
if (fields.at(-1) === '') fields.pop();
if (fields.length % 2 !== 0) {
  console.error('Could not parse the pull request diff.');
  process.exit(1);
}

const changes = [];
for (let index = 0; index < fields.length; index += 2) {
  changes.push({ status: fields[index], path: fields[index + 1] });
}

const pluginDirectories = new Set();
for (const change of changes) {
  const manifest = change.status === 'A'
    ? change.path.match(/^(plugins\/[^/]+)\/webcmd-plugin\.json$/)
    : null;
  if (manifest) pluginDirectories.add(manifest[1]);
}

if (pluginDirectories.size === 0) process.exit(0);

const outsideChanges = changes.filter(
  (change) => ![...pluginDirectories].some((directory) => change.path.startsWith(`${directory}/`)),
);

if (outsideChanges.length > 0) {
  console.error('Plugin-only PR scope violation: adding a plugin manifest requires every changed path to stay inside the newly added plugin directories.');
  for (const change of outsideChanges) console.error(`  ${change.status} ${change.path}`);
  process.exit(1);
}
