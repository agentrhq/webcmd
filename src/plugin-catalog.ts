import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnabledPlugins, isMonorepo, type PluginManifest } from './plugin-manifest.js';
import { findPackageRoot } from './package-paths.js';

const MODULE_FILE = fileURLToPath(import.meta.url);
const CATALOG_FILENAME = 'plugin-catalog.json';

export interface PluginCatalogSource {
  id: string;
  source: string;
  manifestUrl: string;
}

export interface PluginCatalog {
  version: 1;
  sources: PluginCatalogSource[];
}

export interface PluginSearchRow {
  name: string;
  description?: string;
  version?: string;
  sourceId: string;
  installSource: string;
  webcmd?: string;
}

export interface PluginSearchError {
  sourceId: string;
  manifestUrl: string;
  message: string;
}

export interface PluginSearchResult {
  plugins: PluginSearchRow[];
  errors: PluginSearchError[];
}

type FetchJson = (url: string) => Promise<unknown>;

interface CatalogOptions {
  packageRoot?: string;
  homeDir?: string;
  fetchJson?: FetchJson;
}

export function getUserPluginCatalogPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.webcmd', CATALOG_FILENAME);
}

export function getPackagedPluginCatalogPath(packageRoot: string = findPackageRoot(MODULE_FILE)): string {
  return path.join(packageRoot, CATALOG_FILENAME);
}

export function readCatalog(options: CatalogOptions = {}): PluginCatalog {
  const homeDir = options.homeDir ?? os.homedir();
  const userPath = getUserPluginCatalogPath(homeDir);
  if (!fs.existsSync(userPath)) seedUserCatalog(options.packageRoot, homeDir);

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(userPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Malformed plugin catalog at ${userPath}: ${errorMessage(err)}`);
  }
  return normalizeCatalog(parsed, userPath);
}

export function writeCatalog(catalog: PluginCatalog, options: CatalogOptions = {}): void {
  const userPath = getUserPluginCatalogPath(options.homeDir ?? os.homedir());
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.writeFileSync(userPath, `${JSON.stringify(catalog, null, 2)}\n`);
}

export function deriveGithubCatalogSource(source: string): PluginCatalogSource {
  const parsed = parseGithubSource(source);
  if (!parsed) throw new Error(`Unsupported catalog source "${source}". Use github:owner/repo.`);
  const { owner, repo } = parsed;
  return {
    id: `${owner}/${repo}`,
    source,
    manifestUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/webcmd-plugin.json`,
  };
}

export async function addCatalogSource(source: string, options: CatalogOptions = {}): Promise<PluginCatalogSource> {
  const entry = deriveGithubCatalogSource(source);
  const catalog = readCatalog(options);
  const duplicate = catalog.sources.find((existing) => (
    existing.id === entry.id || existing.source === entry.source || existing.manifestUrl === entry.manifestUrl
  ));
  if (duplicate) throw new Error(`Catalog source already exists: ${duplicate.id}`);

  const manifest = await fetchManifest(entry, options.fetchJson);
  validateMarketplaceManifest(manifest, entry.manifestUrl);

  catalog.sources.push(entry);
  writeCatalog(catalog, options);
  return entry;
}

export function removeCatalogSource(id: string, options: CatalogOptions = {}): PluginCatalogSource {
  const catalog = readCatalog(options);
  const index = catalog.sources.findIndex((source) => source.id === id);
  if (index < 0) throw new Error(`Catalog source not found: ${id}`);
  const [removed] = catalog.sources.splice(index, 1);
  writeCatalog(catalog, options);
  return removed;
}

export function flattenPluginManifest(source: PluginCatalogSource, manifest: PluginManifest): PluginSearchRow[] {
  if (isMonorepo(manifest)) {
    return getEnabledPlugins(manifest).map(({ name, entry }) => ({
      name,
      description: entry.description,
      version: entry.version,
      sourceId: source.id,
      installSource: `${source.source}/${name}`,
      webcmd: entry.webcmd ?? manifest.webcmd,
    }));
  }
  if (!manifest.name) return [];
  return [{
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    sourceId: source.id,
    installSource: source.source,
    webcmd: manifest.webcmd,
  }];
}

export async function searchCatalogPlugins(
  catalog: PluginCatalog,
  options: { query?: string; fetchJson?: FetchJson } = {},
): Promise<PluginSearchResult> {
  const plugins: PluginSearchRow[] = [];
  const errors: PluginSearchError[] = [];

  await Promise.all(catalog.sources.map(async (source) => {
    try {
      const manifest = await fetchManifest(source, options.fetchJson);
      validateMarketplaceManifest(manifest, source.manifestUrl);
      plugins.push(...flattenPluginManifest(source, manifest));
    } catch (err) {
      errors.push({ sourceId: source.id, manifestUrl: source.manifestUrl, message: errorMessage(err) });
    }
  }));

  const query = options.query?.trim().toLowerCase();
  const filtered = query
    ? plugins.filter((plugin) => `${plugin.name} ${plugin.description ?? ''}`.toLowerCase().includes(query))
    : plugins;

  filtered.sort((a, b) => a.name.localeCompare(b.name));
  errors.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return { plugins: filtered, errors };
}

function seedUserCatalog(packageRoot: string | undefined, homeDir: string): void {
  const packagedPath = getPackagedPluginCatalogPath(packageRoot);
  const userPath = getUserPluginCatalogPath(homeDir);
  if (!fs.existsSync(packagedPath)) throw new Error(`Packaged plugin catalog not found: ${packagedPath}`);
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.copyFileSync(packagedPath, userPath);
}

function normalizeCatalog(value: unknown, filePath: string): PluginCatalog {
  if (!isRecord(value)) throw new Error(`Malformed plugin catalog at ${filePath}: expected object`);
  if (value.version !== 1) throw new Error(`Malformed plugin catalog at ${filePath}: expected version 1`);
  if (!Array.isArray(value.sources)) throw new Error(`Malformed plugin catalog at ${filePath}: expected sources array`);
  return {
    version: 1,
    sources: value.sources.map((source, index) => normalizeCatalogSource(source, `${filePath} sources[${index}]`)),
  };
}

function normalizeCatalogSource(value: unknown, label: string): PluginCatalogSource {
  if (!isRecord(value)) throw new Error(`Malformed plugin catalog at ${label}: expected object`);
  if (typeof value.id !== 'string' || !value.id) throw new Error(`Malformed plugin catalog at ${label}: expected id`);
  if (typeof value.source !== 'string' || !value.source) throw new Error(`Malformed plugin catalog at ${label}: expected source`);
  if (typeof value.manifestUrl !== 'string' || !value.manifestUrl) throw new Error(`Malformed plugin catalog at ${label}: expected manifestUrl`);
  const github = parseGithubSource(value.source);
  return {
    id: github ? `${github.owner}/${github.repo}` : value.id,
    source: value.source,
    manifestUrl: value.manifestUrl,
  };
}

function parseGithubSource(source: string): { owner: string; repo: string } | null {
  const match = /^github:([\w.-]+)\/([\w.-]+)$/.exec(source);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function fetchManifest(source: PluginCatalogSource, fetchJson: FetchJson = defaultFetchJson): Promise<PluginManifest> {
  const value = await fetchJson(source.manifestUrl);
  if (!isRecord(value)) throw new Error(`Invalid plugin manifest at ${source.manifestUrl}: expected object`);
  return value as PluginManifest;
}

function validateMarketplaceManifest(manifest: PluginManifest, manifestUrl: string): void {
  if (isMonorepo(manifest)) {
    if (getEnabledPlugins(manifest).length === 0) {
      throw new Error(`Invalid plugin manifest at ${manifestUrl}: no enabled plugins`);
    }
    return;
  }
  if (!manifest.name) throw new Error(`Invalid plugin manifest at ${manifestUrl}: missing name or plugins`);
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
