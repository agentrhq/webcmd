import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeOfficialPluginSource } from './official-plugin-source.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('normalizeOfficialPluginSource', () => {
  it('rewrites the exact official github shorthand and subplugin', () => {
    expect(normalizeOfficialPluginSource('github:agentrhq/webcmd')).toBe('github:agentrhq/webcmd-plugins');
    expect(normalizeOfficialPluginSource('github:agentrhq/webcmd/hackernews')).toBe('github:agentrhq/webcmd-plugins/hackernews');
  });

  it('rewrites the exact official HTTPS clone URL', () => {
    expect(normalizeOfficialPluginSource('https://github.com/agentrhq/webcmd.git')).toBe('https://github.com/agentrhq/webcmd-plugins.git');
    expect(normalizeOfficialPluginSource('https://github.com/agentrhq/webcmd')).toBe('https://github.com/agentrhq/webcmd-plugins.git');
  });

  it('leaves canonical and unrelated sources unchanged', () => {
    expect(normalizeOfficialPluginSource('github:agentrhq/webcmd-plugins')).toBe('github:agentrhq/webcmd-plugins');
    expect(normalizeOfficialPluginSource('github:agentrhq/webcmd-plugins/hackernews')).toBe('github:agentrhq/webcmd-plugins/hackernews');
    expect(normalizeOfficialPluginSource('github:other/webcmd/hackernews')).toBe('github:other/webcmd/hackernews');
    expect(normalizeOfficialPluginSource('https://github.com/other/webcmd.git')).toBe('https://github.com/other/webcmd.git');
    expect(normalizeOfficialPluginSource('github:agentrhq/webcmd-extra')).toBe('github:agentrhq/webcmd-extra');
  });
});

describe('packaged plugin catalog', () => {
  it('points at the canonical plugins repository', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(packageRoot, 'plugin-catalog.json'), 'utf8')) as {
      sources: Array<{ id: string; source: string; manifestUrl: string }>;
    };
    expect(catalog.sources).toEqual([{
      id: 'agentrhq/webcmd-plugins',
      source: 'github:agentrhq/webcmd-plugins',
      manifestUrl: 'https://raw.githubusercontent.com/agentrhq/webcmd-plugins/main/webcmd-plugin.json',
    }]);
  });
});
