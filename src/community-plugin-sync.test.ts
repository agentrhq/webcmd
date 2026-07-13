import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildCommunityPluginOutputs, writeCommunityPluginOutputs } from './community-plugin-sync.js';

const START_MARKER = '<!-- webcmd-community-plugins:start -->';
const END_MARKER = '<!-- webcmd-community-plugins:end -->';

describe('community plugin sync', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-plugin-generator-'));
    writeJson('webcmd-plugin.json', {
      name: 'webcmd',
      version: '0.2.0',
      description: 'Webcmd plugin collection',
      webcmd: '>=0.2.0',
      plugins: { stale: { path: 'plugins/stale' } },
    });
    writeJson('plugin-catalog.json', {
      version: 1,
      sources: [
        {
          id: 'agentrhq/webcmd',
          source: 'github:agentrhq/webcmd',
          manifestUrl: 'https://raw.githubusercontent.com/agentrhq/webcmd/main/webcmd-plugin.json',
        },
        {
          id: 'other/plugins',
          source: 'github:other/plugins',
          manifestUrl: 'https://raw.githubusercontent.com/other/plugins/main/webcmd-plugin.json',
        },
      ],
    });
    fs.writeFileSync(path.join(repoRoot, 'README.md'), [
      '# Webcmd',
      '',
      '## Plugins',
      '',
      START_MARKER,
      'old generated content',
      END_MARKER,
      '',
      '## Writing adapters',
      '',
    ].join('\n'));
    writePlugin('zeta', {
      name: 'zeta',
      version: '0.1.0',
      description: 'Last plugin',
      webcmd: '>=0.2.0',
      author: { name: 'Zed', handle: 'zed-user' },
    });
    writePlugin('alpha', {
      name: 'alpha',
      version: '1.0.0',
      description: 'Forecasts | alerts',
      webcmd: '>=0.3.0',
      author: { name: 'Alice', handle: 'alice' },
    });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('builds a sorted root manifest and three-column README catalog', () => {
    const result = buildCommunityPluginOutputs(repoRoot);

    expect(Object.keys(result.rootManifest.plugins ?? {})).toEqual(['alpha', 'zeta']);
    expect(result.rootManifest).toMatchObject({
      name: 'webcmd',
      version: '0.2.0',
      plugins: {
        alpha: {
          path: 'plugins/alpha',
          version: '1.0.0',
          description: 'Forecasts | alerts',
          webcmd: '>=0.3.0',
          author: { name: 'Alice', handle: 'alice' },
        },
      },
    });
    expect(result.readme).toContain('| Plugin | Description | Author |');
    expect(result.readme).toContain('| [`alpha`](./plugins/alpha/) | Forecasts \\| alerts | [Alice](https://github.com/alice) |');
    expect(result.readme.indexOf('`alpha`')).toBeLessThan(result.readme.indexOf('`zeta`'));
    expect(result.readme).toContain('### Plugin marketplaces');
    expect(result.readme).toContain('[other/plugins](https://github.com/other/plugins)');
    expect(result.readme).not.toContain('[agentrhq/webcmd](https://github.com/agentrhq/webcmd)');
  });

  it('writes the generated files', () => {
    const result = writeCommunityPluginOutputs(repoRoot);

    expect(JSON.parse(fs.readFileSync(path.join(repoRoot, 'webcmd-plugin.json'), 'utf-8'))).toEqual(result.rootManifest);
    expect(fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf-8')).toBe(result.readme);
  });

  it('fails with the plugin path when author metadata is missing', () => {
    writePlugin('alpha', {
      name: 'alpha',
      version: '1.0.0',
      description: 'Forecasts',
      webcmd: '>=0.3.0',
    });

    expect(() => buildCommunityPluginOutputs(repoRoot)).toThrow('plugins/alpha/webcmd-plugin.json: Invalid author');
  });

  it('fails with the plugin path for malformed JSON', () => {
    fs.writeFileSync(path.join(repoRoot, 'plugins/alpha/webcmd-plugin.json'), '{broken');

    expect(() => buildCommunityPluginOutputs(repoRoot)).toThrow('plugins/alpha/webcmd-plugin.json: malformed JSON');
  });

  it('rejects directory and manifest name mismatches', () => {
    writePlugin('alpha', {
      name: 'different',
      version: '1.0.0',
      description: 'Forecasts',
      webcmd: '>=0.3.0',
      author: { name: 'Alice', handle: 'alice' },
    });

    expect(() => buildCommunityPluginOutputs(repoRoot)).toThrow('plugins/alpha/webcmd-plugin.json: name must match directory "alpha"');
  });

  function writeJson(relativePath: string, value: unknown): void {
    const filePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  function writePlugin(name: string, manifest: unknown): void {
    writeJson(`plugins/${name}/webcmd-plugin.json`, manifest);
  }
});
