#!/usr/bin/env node

import * as fs from 'node:fs';
import { register } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadManifestEntries } from './build-manifest.js';
import type { ManifestEntry } from './manifest-types.js';
import { findPackageRoot } from './package-paths.js';

const localPackageRoot = findPackageRoot(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(localPackageRoot, 'scripts/plugin-local-runtime-loader.mjs')), {
  parentURL: import.meta.url,
  data: { packageRoot: localPackageRoot },
});

const EXECUTABLE_FIELDS = [
  'aliases', 'access', 'domain', 'strategy', 'browser', 'args', 'columns', 'tags', 'keywords',
  'defaultFormat', 'pipeline', 'navigateBefore', 'siteSession', 'freshPage',
] as const satisfies readonly (keyof ManifestEntry)[];

type Importer = (moduleHref: string) => Promise<unknown>;

export async function scanPluginCommandModules(
  pluginsDir: string,
  importer: Importer = moduleHref => import(moduleHref),
): Promise<ManifestEntry[]> {
  if (!fs.existsSync(pluginsDir)) return [];
  const projectRoot = path.dirname(pluginsDir);
  const entries: ManifestEntry[] = [];
  const owners = new Map<string, string>();

  for (const site of fs.readdirSync(pluginsDir).sort()) {
    const pluginDir = path.join(pluginsDir, site);
    if (!fs.statSync(pluginDir).isDirectory()) continue;
    for (const file of fs.readdirSync(pluginDir).sort()) {
      if (!file.endsWith('.js') || file.endsWith('.test.js') || file === 'index.js') continue;
      const filePath = path.join(pluginDir, file);
      if (!fs.statSync(filePath).isFile()) continue;
      const loaded = await loadManifestEntries(filePath, site, importer, projectRoot);
      for (const entry of loaded) {
        const sourceFile = path.relative(projectRoot, filePath).replaceAll(path.sep, '/');
        const normalized = { ...entry, modulePath: sourceFile, sourceFile };
        claim(`${entry.site}/${entry.name}`, `${entry.site}/${entry.name}`, owners);
        for (const alias of entry.aliases ?? []) claim(`${entry.site}/${alias}`, `${entry.site}/${entry.name}`, owners);
        entries.push(normalized);
      }
    }
  }

  return entries.sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name));
}

export function findPluginCommandParityIssues(
  pluginEntries: readonly ManifestEntry[],
  frozenEntries: readonly ManifestEntry[],
): string[] {
  const frozen = new Map(frozenEntries.map(entry => [`${entry.site}/${entry.name}`, entry]));
  const issues: string[] = [];
  for (const entry of pluginEntries) {
    const key = `${entry.site}/${entry.name}`;
    const expected = frozen.get(key);
    if (!expected) continue;
    const actualMetadata = Object.fromEntries(EXECUTABLE_FIELDS.map(field => [field, entry[field]]));
    const expectedMetadata = Object.fromEntries(EXECUTABLE_FIELDS.map(field => [field, expected[field]]));
    if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
      issues.push(`${key} executable metadata differs from frozen core manifest`);
    }
  }
  return issues.sort();
}

function claim(key: string, owner: string, owners: Map<string, string>): void {
  const existing = owners.get(key);
  if (existing) throw new Error(`duplicate plugin command or alias ${key}: ${existing}, ${owner}`);
  owners.set(key, owner);
}

export function serializePluginCommandManifest(entries: readonly ManifestEntry[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

async function main(): Promise<void> {
  const entries = await scanPluginCommandModules(path.join(localPackageRoot, 'plugins'));
  const output = path.join(localPackageRoot, 'plugin-command-manifest.json');
  fs.writeFileSync(output, serializePluginCommandManifest(entries));
  process.stderr.write(`✅ Plugin command manifest compiled: ${entries.length} entries → ${output}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
