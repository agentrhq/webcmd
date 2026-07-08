import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPackageRoot } from './package-paths.js';
import { listPlugins } from './plugin.js';
import { isRecord } from './utils.js';

export const PLUGIN_CATALOG_FILENAME = 'plugin-catalog.json';
export const PLUGIN_CATALOG_CACHE_FILENAME = 'plugin-catalog-cache.json';
export const DEFAULT_PLUGIN_CATALOG_URL = 'https://raw.githubusercontent.com/agentrhq/webcmd/main/plugin-catalog.json';
export const DEFAULT_PLUGIN_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

const CATALOG_FILE = fileURLToPath(import.meta.url);

export interface PluginCatalogEntry {
  site: string;
  description: string;
  source: string;
  homepage?: string;
}

type FetchResponseLike = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponseLike>;

interface ResolvePluginCatalogOptions {
  packageRoot?: string;
  homeDir?: string;
  catalogUrl?: string;
  fetchImpl?: FetchLike;
  now?: number;
  ttlMs?: number;
}

interface PluginCatalogCache {
  catalogUrl: string;
  fetchedAt: number;
  entries: unknown[];
}

function normalizeCatalogEntry(value: unknown): PluginCatalogEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.site !== 'string' || value.site.trim() === '') return null;
  if (typeof value.description !== 'string' || value.description.trim() === '') return null;
  if (typeof value.source !== 'string' || value.source.trim() === '') return null;

  const entry: PluginCatalogEntry = {
    site: value.site.trim(),
    description: value.description.trim(),
    source: value.source.trim(),
  };
  if (typeof value.homepage === 'string' && value.homepage.trim()) {
    entry.homepage = value.homepage.trim();
  }
  return entry;
}

function normalizeCatalogEntries(parsed: unknown): PluginCatalogEntry[] {
  if (!Array.isArray(parsed)) return [];

  const bySite = new Map<string, PluginCatalogEntry>();
  for (const raw of parsed) {
    const entry = normalizeCatalogEntry(raw);
    if (!entry) continue;
    bySite.set(entry.site, entry);
  }
  return [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site));
}

export function loadPluginCatalog(packageRoot = findPackageRoot(CATALOG_FILE)): PluginCatalogEntry[] {
  const catalogPath = path.join(packageRoot, PLUGIN_CATALOG_FILENAME);
  try {
    return normalizeCatalogEntries(JSON.parse(fs.readFileSync(catalogPath, 'utf-8')));
  } catch {
    return [];
  }
}

export function installedPluginNames(): Set<string> {
  try {
    return new Set(listPlugins().map(plugin => plugin.name));
  } catch {
    return new Set();
  }
}

export function listAvailablePlugins(
  installed = installedPluginNames(),
  packageRoot = findPackageRoot(CATALOG_FILE),
): PluginCatalogEntry[] {
  return loadPluginCatalog(packageRoot).filter(plugin => !installed.has(plugin.site));
}

function getCatalogCachePath(homeDir: string): string {
  return path.join(homeDir, '.webcmd', PLUGIN_CATALOG_CACHE_FILENAME);
}

function readFreshCachedCatalog(cachePath: string, catalogUrl: string, now: number, ttlMs: number): PluginCatalogEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.catalogUrl !== catalogUrl) return null;
  if (typeof parsed.fetchedAt !== 'number' || !Number.isFinite(parsed.fetchedAt)) return null;
  if (now - parsed.fetchedAt > ttlMs) return null;
  const entries = normalizeCatalogEntries(parsed.entries);
  return entries.length > 0 || Array.isArray(parsed.entries) ? entries : null;
}

function writeCatalogCache(cachePath: string, cache: PluginCatalogCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 });
  } catch {
    // Catalog caching is best-effort; webcmd list should still work offline.
  }
}

async function fetchRemoteCatalog(catalogUrl: string, fetchImpl: FetchLike): Promise<PluginCatalogEntry[] | null> {
  const response = await fetchImpl(catalogUrl, {
    headers: {
      accept: 'application/json',
      'user-agent': 'webcmd-plugin-catalog',
    },
  });
  if (!response.ok) return null;
  const entries = normalizeCatalogEntries(await response.json());
  return entries.length > 0 ? entries : null;
}

export async function resolvePluginCatalog(options: ResolvePluginCatalogOptions = {}): Promise<PluginCatalogEntry[]> {
  const packageRoot = options.packageRoot ?? findPackageRoot(CATALOG_FILE);
  const homeDir = options.homeDir ?? os.homedir();
  const catalogUrl = options.catalogUrl ?? process.env.WEBCMD_PLUGIN_CATALOG_URL ?? DEFAULT_PLUGIN_CATALOG_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_PLUGIN_CATALOG_TTL_MS;
  const cachePath = getCatalogCachePath(homeDir);

  const cached = readFreshCachedCatalog(cachePath, catalogUrl, now, ttlMs);
  if (cached) return cached;

  if (typeof fetchImpl === 'function') {
    try {
      const remote = await fetchRemoteCatalog(catalogUrl, fetchImpl as FetchLike);
      if (remote) {
        writeCatalogCache(cachePath, { catalogUrl, fetchedAt: now, entries: remote });
        return remote;
      }
    } catch {
      // Remote catalog updates are opportunistic; fall back to bundled metadata.
    }
  }

  return loadPluginCatalog(packageRoot);
}

export async function listAvailablePluginsAsync(
  installed = installedPluginNames(),
  options: ResolvePluginCatalogOptions = {},
): Promise<PluginCatalogEntry[]> {
  return (await resolvePluginCatalog(options)).filter(plugin => !installed.has(plugin.site));
}
