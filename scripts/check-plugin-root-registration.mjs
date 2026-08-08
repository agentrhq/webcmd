#!/usr/bin/env node
/**
 * check-plugin-root-registration.mjs — every plugins/<site>/ must be listed
 * in the root webcmd-plugin.json plugins map, and vice versa.
 *
 * The promotion flow (webcmd-adapter-author skill / adapter-template.md) has
 * an easy-to-skip step: after `webcmd plugin create` scaffolds plugins/<site>/,
 * the author must also add <site> to the root webcmd-plugin.json. Nothing in
 * `webcmd plugin create`, `webcmd plugin install file://...`, or
 * `webcmd validate <site>` errors or warns when that step is skipped — the
 * plugin works locally either way, so the omission is silent until someone
 * tries `webcmd plugin install github:agentrhq/webcmd/<site>` (which
 * resolves sub-plugins by looking up <site> in the root manifest) and it
 * fails to resolve. This check catches the gap at CI time instead. See #222.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(root, 'plugins');
const rootManifest = readJson(path.join(root, 'webcmd-plugin.json'));
const registered = new Set(Object.keys(rootManifest.plugins ?? {}));

const onDisk = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(pluginsDir, name, 'webcmd-plugin.json')))
  .sort();

const issues = [];

for (const site of onDisk) {
  if (!registered.has(site)) {
    issues.push(`plugins/${site} exists but is not registered in root webcmd-plugin.json`);
  }
}

const onDiskSet = new Set(onDisk);
for (const site of registered) {
  if (!onDiskSet.has(site)) {
    issues.push(`root webcmd-plugin.json registers "${site}" but plugins/${site} does not exist`);
  }
}

if (issues.length) {
  console.error(`Plugin root-registration check failed (${issues.length} issue(s)):`);
  for (const issue of issues) console.error(`  - ${issue}`);
  console.error('\nRegister every plugins/<site>/ in the root webcmd-plugin.json "plugins" map (see references/adapter-template.md).');
  process.exit(1);
}

console.log(`OK - ${onDisk.length} plugin(s) on disk match root webcmd-plugin.json registration.`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
