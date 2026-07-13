import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  validatePluginAuthor,
  type PluginManifest,
  type SubPluginEntry,
} from './plugin-manifest.js';

export const COMMUNITY_PLUGINS_START = '<!-- webcmd-community-plugins:start -->';
export const COMMUNITY_PLUGINS_END = '<!-- webcmd-community-plugins:end -->';

export interface CommunityPluginOutputs {
  rootManifest: PluginManifest;
  readme: string;
}

/** Build generated catalog outputs without writing them. */
export function buildCommunityPluginOutputs(repoRoot: string): CommunityPluginOutputs {
  const rootManifestPath = path.join(repoRoot, 'webcmd-plugin.json');
  const rootManifest = readObject(rootManifestPath, 'webcmd-plugin.json') as PluginManifest;
  const plugins = readRepositoryPlugins(repoRoot);
  const readmePath = path.join(repoRoot, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf-8');
  const marketplaces = readExternalMarketplaces(repoRoot);

  return {
    rootManifest: { ...rootManifest, plugins },
    readme: replaceGeneratedSection(readme, renderCommunityPlugins(plugins, marketplaces)),
  };
}

/** Build and write the root manifest and README catalog. */
export function writeCommunityPluginOutputs(repoRoot: string): CommunityPluginOutputs {
  const generated = buildCommunityPluginOutputs(repoRoot);
  fs.writeFileSync(
    path.join(repoRoot, 'webcmd-plugin.json'),
    `${JSON.stringify(generated.rootManifest, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(repoRoot, 'README.md'), generated.readme);
  return generated;
}

function readRepositoryPlugins(repoRoot: string): Record<string, SubPluginEntry> {
  const pluginsDir = path.join(repoRoot, 'plugins');
  const directoryNames = fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const plugins: Record<string, SubPluginEntry> = {};
  for (const directoryName of directoryNames) {
    const relativeManifestPath = `plugins/${directoryName}/webcmd-plugin.json`;
    const manifestPath = path.join(repoRoot, relativeManifestPath);
    const manifest = readObject(manifestPath, relativeManifestPath);
    const name = requiredString(manifest, 'name', relativeManifestPath);
    if (name !== directoryName) {
      throw new Error(`${relativeManifestPath}: name must match directory "${directoryName}"`);
    }

    let author;
    try {
      author = validatePluginAuthor(manifest.author);
    } catch (err) {
      throw new Error(`${relativeManifestPath}: ${errorMessage(err)}`);
    }

    plugins[name] = {
      path: `plugins/${directoryName}`,
      version: requiredString(manifest, 'version', relativeManifestPath),
      description: requiredString(manifest, 'description', relativeManifestPath),
      webcmd: requiredString(manifest, 'webcmd', relativeManifestPath),
      author,
    };
  }
  return plugins;
}

function readExternalMarketplaces(repoRoot: string): string[] {
  const catalog = readObject(
    path.join(repoRoot, 'plugin-catalog.json'),
    'plugin-catalog.json',
  );
  if (!Array.isArray(catalog.sources)) {
    throw new Error('plugin-catalog.json: sources must be an array');
  }

  return catalog.sources.flatMap((source, index) => {
    if (!isObject(source) || typeof source.source !== 'string') {
      throw new Error(`plugin-catalog.json: sources[${index}].source must be a string`);
    }
    const match = /^github:([\w.-]+)\/([\w.-]+)$/.exec(source.source);
    if (!match) return [];
    const repository = `${match[1]}/${match[2]}`;
    return repository === 'agentrhq/webcmd' ? [] : [repository];
  }).sort((a, b) => a.localeCompare(b));
}

function renderCommunityPlugins(
  plugins: Record<string, SubPluginEntry>,
  marketplaces: string[],
): string {
  const lines = [
    COMMUNITY_PLUGINS_START,
    '### Community plugins',
    '',
    '| Plugin | Description | Author |',
    '| --- | --- | --- |',
  ];

  for (const [name, plugin] of Object.entries(plugins)) {
    const author = plugin.author!;
    lines.push(
      `| [\`${markdownCell(name)}\`](./plugins/${name}/) | ${markdownCell(plugin.description!)} | [${markdownCell(author.name)}](https://github.com/${author.handle}) |`,
    );
  }

  if (marketplaces.length > 0) {
    lines.push('', '### Plugin marketplaces', '', '| Marketplace |', '| --- |');
    for (const marketplace of marketplaces) {
      lines.push(`| [${markdownCell(marketplace)}](https://github.com/${marketplace}) |`);
    }
  }

  lines.push(COMMUNITY_PLUGINS_END);
  return lines.join('\n');
}

function replaceGeneratedSection(readme: string, section: string): string {
  const start = readme.indexOf(COMMUNITY_PLUGINS_START);
  const end = readme.indexOf(COMMUNITY_PLUGINS_END);
  if (start < 0 || end < start) {
    throw new Error(`README.md: expected ${COMMUNITY_PLUGINS_START} and ${COMMUNITY_PLUGINS_END}`);
  }
  if (
    readme.indexOf(COMMUNITY_PLUGINS_START, start + COMMUNITY_PLUGINS_START.length) >= 0
    || readme.indexOf(COMMUNITY_PLUGINS_END, end + COMMUNITY_PLUGINS_END.length) >= 0
  ) {
    throw new Error('README.md: community plugin markers must appear exactly once');
  }
  return `${readme.slice(0, start)}${section}${readme.slice(end + COMMUNITY_PLUGINS_END.length)}`;
}

function readObject(filePath: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    throw new Error(`${label}: malformed JSON (${errorMessage(err)})`);
  }
  if (!isObject(parsed)) throw new Error(`${label}: expected an object`);
  return parsed;
}

function requiredString(value: Record<string, unknown>, key: string, label: string): string {
  const result = typeof value[key] === 'string' ? value[key].trim() : '';
  if (!result) throw new Error(`${label}: ${key} must be a non-empty string`);
  return result;
}

function markdownCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\r?\n/g, ' ');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
