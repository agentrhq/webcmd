import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadPluginCatalog, listAvailablePlugins, resolvePluginCatalog } from './plugin-catalog.js';

describe('plugin catalog', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  function writeCatalog(entries: unknown[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-plugin-catalog-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'plugin-catalog.json'), JSON.stringify(entries, null, 2));
    return dir;
  }

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function okJson(value: unknown) {
    return { ok: true, json: async () => value };
  }

  it('loads plugin metadata without exposing pre-install command names', () => {
    const root = writeCatalog([
      {
        site: 'skyscanner',
        description: 'Search Skyscanner flights',
        source: 'github:agentrhq/webcmd/skyscanner',
        commands: ['flights'],
      },
    ]);

    expect(loadPluginCatalog(root)).toEqual([
      {
        site: 'skyscanner',
        description: 'Search Skyscanner flights',
        source: 'github:agentrhq/webcmd/skyscanner',
      },
    ]);
  });

  it('hides catalog plugins that are already installed', () => {
    const root = writeCatalog([
      {
        site: 'skyscanner',
        description: 'Search Skyscanner flights',
        source: 'github:agentrhq/webcmd/skyscanner',
      },
      {
        site: 'open-meteo',
        description: 'Weather forecast commands',
        source: 'github:agentrhq/webcmd/open-meteo',
      },
    ]);

    expect(listAvailablePlugins(new Set(['skyscanner']), root).map(plugin => plugin.site)).toEqual(['open-meteo']);
  });

  it('uses a fresh remote catalog cache without fetching', async () => {
    const packageRoot = writeCatalog([
      {
        site: 'bundled',
        description: 'Bundled plugin',
        source: 'github:agentrhq/webcmd/bundled',
      },
    ]);
    const homeDir = makeTempDir('webcmd-plugin-catalog-home-');
    const cacheDir = path.join(homeDir, '.webcmd');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'plugin-catalog-cache.json'), JSON.stringify({
      catalogUrl: 'https://example.test/catalog.json',
      fetchedAt: 1_000,
      entries: [
        {
          site: 'remote',
          description: 'Remote cached plugin',
          source: 'github:agentrhq/webcmd/remote',
          commands: ['hidden'],
        },
      ],
    }));
    const fetchImpl = vi.fn();

    await expect(resolvePluginCatalog({
      packageRoot,
      homeDir,
      catalogUrl: 'https://example.test/catalog.json',
      fetchImpl,
      now: 1_500,
      ttlMs: 1_000,
    })).resolves.toEqual([
      {
        site: 'remote',
        description: 'Remote cached plugin',
        source: 'github:agentrhq/webcmd/remote',
      },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches and caches the remote catalog when cache is stale', async () => {
    const packageRoot = writeCatalog([]);
    const homeDir = makeTempDir('webcmd-plugin-catalog-home-');
    const fetchImpl = vi.fn(async () => okJson([
      {
        site: 'new-plugin',
        description: 'Fresh remote plugin',
        source: 'github:agentrhq/webcmd/new-plugin',
      },
    ]));

    const entries = await resolvePluginCatalog({
      packageRoot,
      homeDir,
      catalogUrl: 'https://example.test/catalog.json',
      fetchImpl,
      now: 2_000,
      ttlMs: 1_000,
    });

    expect(entries.map(entry => entry.site)).toEqual(['new-plugin']);
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/catalog.json', expect.objectContaining({ headers: expect.any(Object) }));
    const cached = JSON.parse(fs.readFileSync(path.join(homeDir, '.webcmd', 'plugin-catalog-cache.json'), 'utf-8'));
    expect(cached).toMatchObject({
      catalogUrl: 'https://example.test/catalog.json',
      fetchedAt: 2_000,
      entries,
    });
  });

  it('falls back to the bundled catalog when remote fetch fails', async () => {
    const packageRoot = writeCatalog([
      {
        site: 'bundled',
        description: 'Bundled plugin',
        source: 'github:agentrhq/webcmd/bundled',
      },
    ]);
    const homeDir = makeTempDir('webcmd-plugin-catalog-home-');
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(resolvePluginCatalog({
      packageRoot,
      homeDir,
      catalogUrl: 'https://example.test/catalog.json',
      fetchImpl,
      now: 2_000,
      ttlMs: 1_000,
    })).resolves.toEqual([
      {
        site: 'bundled',
        description: 'Bundled plugin',
        source: 'github:agentrhq/webcmd/bundled',
      },
    ]);
  });
});
