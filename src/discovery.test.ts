import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverClis, discoverPlugins } from './discovery.js';
import { getRegistry } from './registry.js';
import { classifyCommandOrigin } from './command-origin.js';

const CLI_MODULE = `
import { cli } from '${new URL('./registry.ts', import.meta.url).href}';
cli({
  site: '__SITE__', name: 'run', access: 'read', browser: false,
  func: async () => ({ ok: true }),
});
`;

describe('discovery attributes source through the real cli() path', () => {
  let tempHome: string;

  beforeEach(async () => {
    getRegistry().clear();
    tempHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcmd-discovery-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempHome, { recursive: true, force: true });
  });

  it('sets source on a plugin-registered (cli()) command to its module path', async () => {
    const pluginsDir = path.join(tempHome, 'plugins');
    const pluginDir = path.join(pluginsDir, 'linkedin');
    await fs.promises.mkdir(pluginDir, { recursive: true });
    const modulePath = path.join(pluginDir, 'run.js');
    await fs.promises.writeFile(modulePath, CLI_MODULE.replace('__SITE__', 'linkedin'));

    await discoverPlugins(pluginsDir);

    const cmd = getRegistry().get('linkedin/run');
    expect(cmd?.source).toBe(modulePath);
    expect(classifyCommandOrigin(cmd!, { pluginsDir, userClisDir: path.join(tempHome, 'clis') }))
      .toEqual({ kind: 'plugin', plugin: 'linkedin' });
  });

  it('sets source on a clis-registered (cli()) command to its module path', async () => {
    const clisDir = path.join(tempHome, 'clis');
    const siteDir = path.join(clisDir, 'mysite');
    await fs.promises.mkdir(siteDir, { recursive: true });
    const modulePath = path.join(siteDir, 'run.js');
    await fs.promises.writeFile(modulePath, CLI_MODULE.replace('__SITE__', 'mysite'));

    await discoverClis(clisDir);

    const cmd = getRegistry().get('mysite/run');
    expect(cmd?.source).toBe(modulePath);
    expect(classifyCommandOrigin(cmd!, { pluginsDir: path.join(tempHome, 'plugins'), userClisDir: clisDir }))
      .toEqual({ kind: 'local' });
  });

  it('classifies a symlinked monorepo plugin as plugin:<name> without resolving the link', async () => {
    const pluginsDir = path.join(tempHome, 'plugins');
    const monorepoDir = path.join(tempHome, 'monorepos', 'repo1', 'plugins', 'linkedin');
    await fs.promises.mkdir(monorepoDir, { recursive: true });
    await fs.promises.mkdir(pluginsDir, { recursive: true });
    const realModulePath = path.join(monorepoDir, 'run.js');
    await fs.promises.writeFile(realModulePath, CLI_MODULE.replace('__SITE__', 'linkedin'));

    const linkPath = path.join(pluginsDir, 'linkedin');
    await fs.promises.symlink(monorepoDir, linkPath, 'dir');

    await discoverPlugins(pluginsDir);

    const cmd = getRegistry().get('linkedin/run');
    expect(cmd?.source).toBe(path.join(linkPath, 'run.js'));
    expect(classifyCommandOrigin(cmd!, { pluginsDir, userClisDir: path.join(tempHome, 'clis') }))
      .toEqual({ kind: 'plugin', plugin: 'linkedin' });
  });

  it('never registers commands from clis/.base/ (shallow: file is a direct child of .base)', async () => {
    const clisDir = path.join(tempHome, 'clis');
    const baseDir = path.join(clisDir, '.base');
    await fs.promises.mkdir(baseDir, { recursive: true });
    // discoverClisFromFs treats each directory under clisDir as a "site" and
    // scans its direct children — so the file must sit right here, not nested
    // another level deeper, or this test can't detect a missing guard.
    await fs.promises.writeFile(path.join(baseDir, 'run.js'), CLI_MODULE.replace('__SITE__', 'demo'));

    await discoverClis(clisDir);

    expect(getRegistry().get('demo/run')).toBeUndefined();
  });

  it('never registers commands from a nested clis/.base/<site>/ dir either', async () => {
    const clisDir = path.join(tempHome, 'clis');
    const baseDir = path.join(clisDir, '.base', 'demo');
    await fs.promises.mkdir(baseDir, { recursive: true });
    await fs.promises.writeFile(path.join(baseDir, 'run.js'), CLI_MODULE.replace('__SITE__', 'demo'));

    await discoverClis(clisDir);

    expect(getRegistry().get('demo/run')).toBeUndefined();
  });

  it('never registers manifest commands whose module or source is under clis/.base/', async () => {
    const clisDir = path.join(tempHome, 'clis');
    await fs.promises.mkdir(clisDir, { recursive: true });
    await fs.promises.writeFile(path.join(tempHome, 'cli-manifest.json'), JSON.stringify([
      {
        site: 'base-module', name: 'run', access: 'read', browser: false, args: [],
        modulePath: '.base/base-module/run.js', sourceFile: 'base-module/run.js',
      },
      {
        site: 'base-source', name: 'run', access: 'read', browser: false, args: [],
        modulePath: 'base-source/run.js', sourceFile: '.base/base-source/run.js',
      },
    ]));

    await discoverClis(clisDir);

    expect(getRegistry().get('base-module/run')).toBeUndefined();
    expect(getRegistry().get('base-source/run')).toBeUndefined();
  });
});
