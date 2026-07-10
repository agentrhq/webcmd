import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  addCatalogSource,
  deriveGithubCatalogSource,
  flattenPluginManifest,
  getUserPluginCatalogPath,
  readCatalog,
  removeCatalogSource,
  searchCatalogPlugins,
  type PluginCatalog,
} from './plugin-catalog.js';

describe('plugin catalog', () => {
  let tmpDir: string;
  let packageRoot: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-plugin-catalog-'));
    packageRoot = path.join(tmpDir, 'package');
    homeDir = path.join(tmpDir, 'home');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'plugin-catalog.json'), JSON.stringify({
      version: 1,
      sources: [{
        id: 'agentrhq/webcmd',
        source: 'github:agentrhq/webcmd',
        manifestUrl: 'https://raw.githubusercontent.com/agentrhq/webcmd/main/webcmd-plugin.json',
      }],
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds the user catalog from the packaged default', () => {
    const catalog = readCatalog({ packageRoot, homeDir });

    expect(catalog.sources).toEqual([{ id: 'agentrhq/webcmd', source: 'github:agentrhq/webcmd', manifestUrl: 'https://raw.githubusercontent.com/agentrhq/webcmd/main/webcmd-plugin.json' }]);
    expect(fs.existsSync(getUserPluginCatalogPath(homeDir))).toBe(true);
  });

  it('derives catalog metadata from github shorthand', () => {
    expect(deriveGithubCatalogSource('github:other-org/webcmd-travel-plugins')).toEqual({
      id: 'other-org/webcmd-travel-plugins',
      source: 'github:other-org/webcmd-travel-plugins',
      manifestUrl: 'https://raw.githubusercontent.com/other-org/webcmd-travel-plugins/main/webcmd-plugin.json',
    });
  });

  it('adds and removes catalog sources in the user catalog', async () => {
    const fetchJson = async () => ({ name: 'travel', description: 'Travel tools' });

    const added = await addCatalogSource('github:other-org/webcmd-travel-plugins', { packageRoot, homeDir, fetchJson });
    expect(added.id).toBe('other-org/webcmd-travel-plugins');

    expect(readCatalog({ packageRoot, homeDir }).sources.map((source) => source.id)).toEqual([
      'agentrhq/webcmd',
      'other-org/webcmd-travel-plugins',
    ]);

    removeCatalogSource('other-org/webcmd-travel-plugins', { packageRoot, homeDir });
    expect(readCatalog({ packageRoot, homeDir }).sources.map((source) => source.id)).toEqual(['agentrhq/webcmd']);
  });

  it('rejects duplicate catalog sources', async () => {
    const fetchJson = async () => ({ name: 'travel', description: 'Travel tools' });
    await addCatalogSource('github:other-org/webcmd-travel-plugins', { packageRoot, homeDir, fetchJson });

    await expect(addCatalogSource('github:other-org/webcmd-travel-plugins', { packageRoot, homeDir, fetchJson })).rejects.toThrow('already exists');
  });

  it('flattens monorepo manifests into installable rows', () => {
    const rows = flattenPluginManifest({
      id: 'agentrhq/webcmd',
      source: 'github:agentrhq/webcmd',
      manifestUrl: 'https://example.com/webcmd-plugin.json',
    }, {
      webcmd: '>=0.2.0',
      plugins: {
        skyscanner: { path: 'plugins/skyscanner', version: '0.1.0', description: 'Flights', webcmd: '>=0.2.1' },
        disabled: { path: 'plugins/disabled', disabled: true },
      },
    });

    expect(rows).toEqual([{ name: 'skyscanner', description: 'Flights', version: '0.1.0', sourceId: 'agentrhq/webcmd', installSource: 'github:agentrhq/webcmd/skyscanner', webcmd: '>=0.2.1' }]);
  });

  it('flattens single-plugin manifests into installable rows', () => {
    const rows = flattenPluginManifest({
      id: 'research-tools',
      source: 'github:someone/research-tools',
      manifestUrl: 'https://example.com/webcmd-plugin.json',
    }, { name: 'research-tools', version: '0.1.0', description: 'Research helpers', webcmd: '>=0.2.0' });

    expect(rows).toEqual([{ name: 'research-tools', description: 'Research helpers', version: '0.1.0', sourceId: 'research-tools', installSource: 'github:someone/research-tools', webcmd: '>=0.2.0' }]);
  });

  it('fetches manifests live and preserves remote errors in search output', async () => {
    const catalog: PluginCatalog = {
      version: 1,
      sources: [
        { id: 'ok', source: 'github:ok/repo', manifestUrl: 'https://ok.test/webcmd-plugin.json' },
        { id: 'bad', source: 'github:bad/repo', manifestUrl: 'https://bad.test/webcmd-plugin.json' },
      ],
    };
    const fetchJson = async (url: string) => {
      if (url.includes('bad')) throw new Error('network failed');
      return { plugins: { flights: { path: 'plugins/flights', description: 'Flight search' } } };
    };

    const result = await searchCatalogPlugins(catalog, { query: 'flight', fetchJson });

    expect(result.plugins.map((plugin) => plugin.name)).toEqual(['flights']);
    expect(result.errors).toEqual([{ sourceId: 'bad', manifestUrl: 'https://bad.test/webcmd-plugin.json', message: 'network failed' }]);
  });
});
