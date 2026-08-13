#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugins = read('plugin-command-manifest.json');
const core = read('cli-manifest.json');
const frozen = read('test/fixtures/core-cli-manifest-v0.5.3.json');
const coreKeys = new Set(core.map(key));
const pluginByKey = new Map(plugins.map(entry => [key(entry), entry]));
// This command was intentionally removed rather than migrated to a plugin.
const intentionallyRemoved = new Set(['web/fetch-browser']);
// `args` is checked separately: a migrated command may still gain new optional
// flags, so strict deep-equality would forbid ordinary feature work rather than
// the regression this guards against.
const fields = [
  'aliases', 'access', 'domain', 'strategy', 'browser', 'columns', 'tags', 'keywords',
  'defaultFormat', 'pipeline', 'navigateBefore', 'siteSession', 'freshPage',
];
// Help text documents an argument; it does not change how one is invoked.
const argFields = ['name', 'type', 'default', 'required', 'positional'];
const issues = [];

for (const expected of frozen) {
  const command = key(expected);
  if (coreKeys.has(command)) continue;
  if (intentionallyRemoved.has(command)) continue;
  const actual = pluginByKey.get(command);
  if (!actual) {
    issues.push(`${command} is missing from plugin-command-manifest.json`);
    continue;
  }
  if (JSON.stringify(pick(actual)) !== JSON.stringify(pick(expected))) {
    issues.push(`${command} executable metadata differs from frozen core manifest`);
  }
  issues.push(...argIssues(command, actual.args ?? [], expected.args ?? []));
}

if (issues.length) {
  console.error(`Plugin parity failed (${issues.length} issue(s)):`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log(`OK - plugin parity preserved for ${frozen.length - coreKeys.size} migrated command(s).`);

function read(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function key(entry) {
  return `${entry.site}/${entry.name}`;
}

function pick(entry) {
  return Object.fromEntries(fields.map(field => [field, entry[field]]));
}

function pickArg(arg) {
  return Object.fromEntries(argFields.map(field => [field, arg[field]]));
}

// Every frozen argument must still be invocable exactly as it was in v0.5.3:
// present, same type / default / required / positional, and in the same relative
// order so positional invocations keep working. New arguments may be added
// around them, and help text may be reworded.
function argIssues(command, actual, expected) {
  const found = [];
  const actualByName = new Map(actual.map(arg => [arg.name, arg]));
  for (const arg of expected) {
    const match = actualByName.get(arg.name);
    if (!match) {
      found.push(`${command} dropped the frozen argument --${arg.name}`);
      continue;
    }
    if (JSON.stringify(pickArg(match)) !== JSON.stringify(pickArg(arg))) {
      found.push(`${command} changed how --${arg.name} is invoked`);
    }
  }
  const frozenOrder = expected.map(arg => arg.name);
  const actualOrder = actual.map(arg => arg.name).filter(name => frozenOrder.includes(name));
  if (JSON.stringify(actualOrder) !== JSON.stringify(frozenOrder.filter(n => actualByName.has(n)))) {
    found.push(`${command} reordered the frozen arguments`);
  }
  return found;
}
