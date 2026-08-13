import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import type { ManifestEntry } from './manifest-types.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-plugin-manifest-'));
  roots.push(root);
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(root, 'plugins', relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return root;
}

function command(site: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    site,
    name,
    description: `${name} description`,
    access: 'read',
    aliases: ['find'],
    example: `webcmd ${site} ${name}`,
    domain: 'example.com',
    strategy: 'public',
    browser: false,
    args: [{ name: 'limit', type: 'int', default: 10, required: false, help: 'Limit' }],
    columns: ['id'],
    tags: ['search'],
    keywords: ['lookup'],
    defaultFormat: 'json',
    navigateBefore: false,
    siteSession: 'ephemeral',
    freshPage: false,
    ...overrides,
  };
}

function scanInChild(pluginsDir: string): string {
  const moduleHref = pathToFileURL(path.resolve('src/build-plugin-command-manifest.ts')).href;
  return execFileSync(process.execPath, [
    '--import', 'tsx',
    '--input-type=module',
    '--eval',
    `
      import { scanPluginCommandModules } from ${JSON.stringify(moduleHref)};
      const entries = await scanPluginCommandModules(${JSON.stringify(pluginsDir)});
      process.stdout.write(JSON.stringify(entries));
    `,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('plugin command manifest', () => {
  it('scans flat command modules and emits deterministic plugin source paths', async () => {
    const root = fixture({
      'zeta/search.js': 'cli({ site: "zeta", name: "search" });',
      'alpha/list.js': 'cli({ site: "alpha", name: "list" });',
      'alpha/helper.js': 'export const helper = true;',
      'alpha/test/ignored.test.js': 'cli({ site: "alpha", name: "ignored" });',
    });
    const modules = new Map([
      [pathToFileURL(path.join(root, 'plugins/zeta/search.js')).href, { zeta: command('zeta', 'search') }],
      [pathToFileURL(path.join(root, 'plugins/alpha/list.js')).href, { alpha: command('alpha', 'list', { aliases: undefined }) }],
    ]);
    const { scanPluginCommandModules } = await import('./build-plugin-command-manifest.js');

    const entries = await scanPluginCommandModules(path.join(root, 'plugins'), href => Promise.resolve(modules.get(href)));

    expect(entries.map(entry => `${entry.site}/${entry.name}`)).toEqual(['alpha/list', 'zeta/search']);
    expect(entries.map(entry => entry.sourceFile)).toEqual(['plugins/alpha/list.js', 'plugins/zeta/search.js']);
    expect(entries.map(entry => entry.modulePath)).toEqual(['plugins/alpha/list.js', 'plugins/zeta/search.js']);
  });

  it('rejects duplicate canonical keys and aliases', async () => {
    const root = fixture({
      'alpha/one.js': 'cli({ site: "alpha", name: "one" });',
      'alpha/two.js': 'cli({ site: "alpha", name: "two" });',
    });
    const modules = new Map([
      [pathToFileURL(path.join(root, 'plugins/alpha/one.js')).href, { one: command('alpha', 'one', { aliases: ['shared'] }) }],
      [pathToFileURL(path.join(root, 'plugins/alpha/two.js')).href, { two: command('alpha', 'two', { aliases: ['shared'] }) }],
    ]);
    const { scanPluginCommandModules } = await import('./build-plugin-command-manifest.js');

    await expect(scanPluginCommandModules(path.join(root, 'plugins'), href => Promise.resolve(modules.get(href))))
      .rejects.toThrow('duplicate plugin command or alias alpha/shared');
  });

  it('preserves executable metadata and reports a changed argument default', async () => {
    const root = fixture({ 'alpha/search.js': 'cli({ site: "alpha", name: "search" });' });
    const runtime = command('alpha', 'search');
    const moduleHref = pathToFileURL(path.join(root, 'plugins/alpha/search.js')).href;
    const { findPluginCommandParityIssues, scanPluginCommandModules } = await import('./build-plugin-command-manifest.js');
    const entries = await scanPluginCommandModules(path.join(root, 'plugins'), async href => href === moduleHref ? { runtime } : {});
    const frozen = [{ ...entries[0], modulePath: 'alpha/search.js', sourceFile: 'alpha/search.js' }] as ManifestEntry[];

    expect(findPluginCommandParityIssues(entries, frozen)).toEqual([]);

    const changed = structuredClone(entries);
    changed[0]!.args![0]!.default = 20;
    expect(findPluginCommandParityIssues(changed, frozen)).toEqual([
      'alpha/search executable metadata differs from frozen core manifest',
    ]);
  });

  it('scans plugin packages against the local Webcmd runtime', async () => {
    const root = fixture({
      'alpha/package.json': '{"name":"webcmd-plugin-alpha","type":"module"}',
      'alpha/search.js': `
        import { cli, Strategy } from '@agentrhq/webcmd/registry';
        cli({
          site: 'alpha',
          name: 'search',
          tags: ['search'],
          access: 'read',
          description: 'Search alpha',
          strategy: Strategy.PUBLIC,
          browser: false,
          args: [],
          columns: ['id'],
          func: async () => [],
        });
      `,
    });
    const stalePackage = path.join(root, 'node_modules', '@agentrhq', 'webcmd');
    fs.mkdirSync(path.join(stalePackage, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(stalePackage, 'package.json'), JSON.stringify({
      name: '@agentrhq/webcmd',
      version: '0.0.0-stale',
      type: 'module',
      exports: { './registry': './dist/registry.js' },
    }));
    fs.writeFileSync(path.join(stalePackage, 'dist', 'registry.js'), `
      const registry = globalThis.__webcmd_registry__ ??= new Map();
      export const Strategy = { PUBLIC: 'public' };
      export function cli(options) {
        const command = { ...options };
        delete command.tags;
        registry.set(command.site + '/' + command.name, command);
      }
    `);
    const stdout = scanInChild(path.join(root, 'plugins'));
    const entries = JSON.parse(stdout) as ManifestEntry[];

    expect(entries).toHaveLength(1);
    expect(entries[0]?.tags).toEqual(['search']);
  });

  it('rejects Webcmd subpaths missing from the local package instead of loading a stale install', () => {
    const root = fixture({
      'alpha/package.json': '{"name":"webcmd-plugin-alpha","type":"module"}',
      'alpha/search.js': `
        import { cli, Strategy } from '@agentrhq/webcmd/registry';
        import { staleDescription } from '@agentrhq/webcmd/stale-only';
        cli({
          site: 'alpha',
          name: 'search',
          access: 'read',
          description: staleDescription,
          strategy: Strategy.PUBLIC,
          browser: false,
          args: [],
          columns: ['id'],
          func: async () => [],
        });
      `,
    });
    const stalePackage = path.join(root, 'node_modules', '@agentrhq', 'webcmd');
    fs.mkdirSync(path.join(stalePackage, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(stalePackage, 'package.json'), JSON.stringify({
      name: '@agentrhq/webcmd',
      version: '0.0.0-stale',
      type: 'module',
      exports: { './stale-only': './dist/stale-only.js' },
    }));
    fs.writeFileSync(
      path.join(stalePackage, 'dist', 'stale-only.js'),
      "export const staleDescription = 'loaded from stale install';\n",
    );

    expect(() => scanInChild(path.join(root, 'plugins')))
      .toThrow(/@agentrhq\/webcmd does not export \.\/stale-only/);
  });

  it('declares the minimum Node version required by module.register', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { engines?: { node?: string } };

    expect(manifest.engines?.node).toBe('>=20.6.0');
  });

  it('documents the same minimum Node version as the package', () => {
    expect(fs.readFileSync('README.md', 'utf8')).toContain('Node.js 20.6+');
    expect(fs.readFileSync('docs/quickstart.mdx', 'utf8')).toContain('Node.js 20.6+');
  });

  it.each(['goettingen', 'heidelberg', 'hft'])('%s declares its direct undici import', (site) => {
    const manifest = JSON.parse(fs.readFileSync(`plugins/${site}/package.json`, 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies?.undici).toBe('^6.27.0');
  });

  it('requires the plugin-runtime release for LinkedIn', () => {
    // The floor must match the webcmd version that actually ships
    // plugin-runtime, not a hardcoded literal that drifts from package.json.
    const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
    const expectedRange = `>=${version}`;

    const packageManifest = JSON.parse(fs.readFileSync('plugins/linkedin/package.json', 'utf8')) as {
      peerDependencies?: Record<string, string>;
    };
    const pluginManifest = JSON.parse(fs.readFileSync('plugins/linkedin/webcmd-plugin.json', 'utf8')) as {
      webcmd?: string;
    };
    const rootManifest = JSON.parse(fs.readFileSync('webcmd-plugin.json', 'utf8')) as {
      plugins?: Record<string, { webcmd?: string }>;
    };

    expect(packageManifest.peerDependencies?.['@agentrhq/webcmd']).toBe(expectedRange);
    expect(pluginManifest.webcmd).toBe(expectedRange);
    expect(rootManifest.plugins?.linkedin?.webcmd).toBe(expectedRange);
  });

  it.each([
    ['CI', '.github/workflows/ci.yml', 'build'],
    ['release', '.github/workflows/release.yml', 'release'],
  ])('checks plugin parity immediately after manifest generation in %s', (_name, workflowPath, jobName) => {
    const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8')) as {
      jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
    };
    const runs = workflow.jobs?.[jobName]?.steps?.map(step => step.run).filter(Boolean) ?? [];
    const generation = runs.indexOf('npm run build-plugin-manifest');

    expect(generation).toBeGreaterThanOrEqual(0);
    expect(runs[generation + 1]).toBe('npm run check:plugin-parity');
  });
});
