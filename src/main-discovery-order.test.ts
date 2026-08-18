import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverClis, discoverPlugins } from './discovery.js';
import { getRegistry, registerCommand, Strategy } from './registry.js';

describe('adapter discovery precedence', () => {
  beforeEach(() => getRegistry().clear());

  it('lets a later registration win, which is what precedence relies on', () => {
    registerCommand({
      site: 'demo', name: 'run', access: 'read', args: [],
      source: 'demo', func: async () => [{ from: 'plugin' }],
    } as never);
    registerCommand({
      site: 'demo', name: 'run', access: 'read', args: [],
      source: '/home/u/.webcmd/clis/demo/run.js', func: async () => [{ from: 'override' }],
    } as never);

    expect(getRegistry().get('demo/run')!.source).toBe('/home/u/.webcmd/clis/demo/run.js');
  });

  it('resolves a command present in both plugins and clis to the clis copy, running discovery in the new order', async () => {
    const registryTsUrl = pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href;
    const tempHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcmd-precedence-'));

    try {
      const pluginDir = path.join(tempHome, 'plugins', 'demo');
      const clisDir = path.join(tempHome, 'clis', 'demo');
      await fs.promises.mkdir(pluginDir, { recursive: true });
      await fs.promises.mkdir(clisDir, { recursive: true });

      await fs.promises.writeFile(path.join(pluginDir, 'run.js'), `
// cli() marker so discovery's module-content sniff picks up this file
import { registerCommand, Strategy } from '${registryTsUrl}';
registerCommand({
  site: 'demo', name: 'run', access: 'read', args: [],
  description: 'plugin copy', strategy: Strategy.PUBLIC, browser: false,
  source: 'plugin:demo', func: async () => [{ from: 'plugin' }],
});
`);
      await fs.promises.writeFile(path.join(clisDir, 'run.js'), `
// cli() marker so discovery's module-content sniff picks up this file
import { registerCommand, Strategy } from '${registryTsUrl}';
registerCommand({
  site: 'demo', name: 'run', access: 'read', args: [],
  description: 'override copy', strategy: Strategy.PUBLIC, browser: false,
  source: ${JSON.stringify(path.join(clisDir, 'run.js'))}, func: async () => [{ from: 'override' }],
});
`);

      // New precedence: plugins discovered first, user clis (overrides) last.
      await discoverPlugins(path.join(tempHome, 'plugins'));
      await discoverClis(path.join(tempHome, 'clis'));

      expect(getRegistry().get('demo/run')!.source).toBe(path.join(clisDir, 'run.js'));
    } finally {
      await fs.promises.rm(tempHome, { recursive: true, force: true });
    }
  });
});
