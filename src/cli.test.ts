import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { cli, getRegistry, runWithDiscoverySource, Strategy } from './registry.js';
import { BrowserCommandError } from './browser/daemon-client.js';
import type { IPage } from './types.js';
import { TargetError } from './browser/target-errors.js';
import { PKG_VERSION } from './version.js';
import { classifyAdapter, getInstalledRootHelpPresentation } from './help.js';
import {
  commandListPresentation,
  formatRootHelp,
  toPresentableCommand,
} from './command-presentation.js';
import { render as renderOutput } from './output.js';
import * as pluginModule from './plugin.js';
import * as discoveryModule from './discovery.js';

const {
  mockBrowserConnect,
  mockBrowserClose,
  mockBindTab,
  mockListExistingBrowserTabs,
  mockSendCommand,
  mockExecFileSync,
  browserState,
} = vi.hoisted(() => ({
  mockBrowserConnect: vi.fn(),
  mockBrowserClose: vi.fn(),
  mockBindTab: vi.fn(),
  mockListExistingBrowserTabs: vi.fn(),
  mockSendCommand: vi.fn(),
  mockExecFileSync: vi.fn(),
  browserState: { page: null as IPage | null },
}));

vi.mock('./browser/index.js', () => {
  mockBrowserConnect.mockImplementation(async () => browserState.page as IPage);
  return {
    BrowserBridge: class {
      connect = mockBrowserConnect;
      close = mockBrowserClose;
    },
  };
});
vi.mock('./browser/daemon-client.js', async () => {
  const actual = await vi.importActual<typeof import('./browser/daemon-client.js')>('./browser/daemon-client.js');
  return {
    ...actual,
    bindTab: mockBindTab,
    listExistingBrowserTabs: mockListExistingBrowserTabs,
    sendCommand: mockSendCommand,
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFileSync: mockExecFileSync,
  };
});

import { createProgram, findPackageRoot, loadAntigravityServe, normalizeVerifyRows, renderVerifyPreview, resolveBrowserVerifyInvocation, resolveSitemapAvailabilityForUrl, selectFreshByTimestamp } from './cli.js';

const realHome = process.env.HOME;
let isolatedCliTestHome: string;

beforeEach(() => {
  isolatedCliTestHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cli-home-'));
  process.env.HOME = isolatedCliTestHome;
});

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  fs.rmSync(isolatedCliTestHome, { recursive: true, force: true });
});

describe('plugin update reconciliation reporting', () => {
  const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    stdoutSpy.mockClear();
    process.exitCode = undefined;
  });

  it('reports every monorepo plugin refreshed by a named update', async () => {
    const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-plugin-update-'));
    const update = vi.spyOn(pluginModule, 'updatePlugin').mockReturnValue(['alpha', 'beta'] as never);
    const findNeeds = vi.spyOn(pluginModule, 'findOverridesNeedingReconcile').mockReturnValue([]);
    const discover = vi.spyOn(discoveryModule, 'discoverPlugins').mockResolvedValue();

    try {
      await createProgram('', '', pluginsDir).parseAsync(['node', 'webcmd', 'plugin', 'update', 'alpha']);

      expect(update).toHaveBeenCalledWith('alpha', { force: false });
      expect(findNeeds).toHaveBeenCalledWith(['alpha', 'beta']);
    } finally {
      update.mockRestore();
      findNeeds.mockRestore();
      discover.mockRestore();
      fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  });

  it('reports reconciliation only for successful --all updates', async () => {
    const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-plugin-update-'));
    const updateAll = vi.spyOn(pluginModule, 'updateAllPlugins').mockReturnValue([
      { name: 'alpha', success: true, updatedPlugins: ['alpha'] },
      { name: 'broken', success: false, error: 'network error' },
      { name: 'beta', success: true, updatedPlugins: ['beta'] },
    ]);
    const findNeeds = vi.spyOn(pluginModule, 'findOverridesNeedingReconcile').mockReturnValue([{
      commandKey: 'beta/search',
      plugin: 'beta',
      yours: '/tmp/home/.webcmd/clis/beta/search.js',
      upstream: '/tmp/home/.webcmd/plugins/beta/search.js',
      base: '/tmp/home/.webcmd/clis/.base/beta/search.js',
    }]);
    const discover = vi.spyOn(discoveryModule, 'discoverPlugins').mockResolvedValue();

    try {
      await createProgram('', '', pluginsDir).parseAsync(['node', 'webcmd', 'plugin', 'update', '--all']);

      expect(findNeeds).toHaveBeenCalledWith(['alpha', 'beta']);
      const output = stdoutSpy.mock.calls.flat().join('\n');
      expect(output).toContain('beta/search');
      expect(output).toContain('yours:    /tmp/home/.webcmd/clis/beta/search.js');
      expect(output).toContain('upstream: /tmp/home/.webcmd/plugins/beta/search.js');
      expect(output).toContain('base:     /tmp/home/.webcmd/clis/.base/beta/search.js');
    } finally {
      updateAll.mockRestore();
      findNeeds.mockRestore();
      discover.mockRestore();
      fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  });
});

describe('override reporting surfaces', () => {
  const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    stdoutSpy.mockClear();
    originalHome = process.env.HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cli-overrides-'));
    process.env.HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('includes override fields in plugin list JSON', async () => {
    const list = vi.spyOn(pluginModule, 'listPlugins').mockReturnValue([{
      name: 'linkedin', path: '/tmp/linkedin', commands: ['search'], source: 'github:example/linkedin',
      overrides: ['search'], updateAvailable: true,
    }] as never);
    try {
      await createProgram('', '', path.join(home, '.webcmd', 'plugins'))
        .parseAsync(['node', 'webcmd', 'plugin', 'list', '--format', 'json']);
      expect(JSON.parse(stdoutSpy.mock.calls.flat().join('\n'))).toMatchObject([{
        name: 'linkedin', commands: ['search'], source: 'github:example/linkedin',
        overrides: ['search'], updateAvailable: true,
      }]);
    } finally {
      list.mockRestore();
    }
  });

  it('renders an empty plugin list as JSON', async () => {
    const list = vi.spyOn(pluginModule, 'listPlugins').mockReturnValue([]);
    try {
      await createProgram('', '', path.join(home, '.webcmd', 'plugins'))
        .parseAsync(['node', 'webcmd', 'plugin', 'list', '--format', 'json']);

      expect(JSON.parse(stdoutSpy.mock.calls.flat().join('\n'))).toEqual([]);
    } finally {
      list.mockRestore();
    }
  });

  it('reports override origins in webcmd list JSON', async () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    const userClis = path.join(home, '.webcmd', 'clis');
    const source = path.join(userClis, 'linkedin', 'search.js');
    registry.clear();
    try {
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, '// override\n');
      fs.mkdirSync(path.join(home, '.webcmd'), { recursive: true });
      fs.writeFileSync(path.join(home, '.webcmd', 'override-provenance.json'), JSON.stringify({
        'linkedin/search': {
          plugin: 'linkedin', commitHash: null, sourcePath: '/tmp/upstream.js', sourceSha256: 'abc',
          basePath: '/tmp/base.js', createdAt: '2026-08-09T00:00:00.000Z',
        },
      }));
      await runWithDiscoverySource(source, async () => {
        cli({ site: 'linkedin', name: 'search', access: 'read', browser: false });
      });

      await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
        .parseAsync(['node', 'webcmd', 'list', '--format', 'json']);
      expect(JSON.parse(stdoutSpy.mock.calls.flat().join('\n'))).toMatchObject([
        { command: 'linkedin/search', origin: 'override:linkedin' },
      ]);
    } finally {
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('marks orphaned overrides in adapter status', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');
    fs.mkdirSync(path.join(userClis, 'linkedin'), { recursive: true });
    fs.writeFileSync(path.join(userClis, 'linkedin', 'search.js'), '// override\n');
    fs.writeFileSync(path.join(home, '.webcmd', 'override-provenance.json'), JSON.stringify({
      'linkedin/search': {
        plugin: 'linkedin', commitHash: null, sourcePath: path.join(home, '.webcmd', 'plugins', 'linkedin', 'search.js'),
        sourceSha256: 'abc', basePath: '/tmp/base.js', createdAt: '2026-08-09T00:00:00.000Z',
      },
    }));

    await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
      .parseAsync(['node', 'webcmd', 'adapter', 'status']);
    expect(stdoutSpy.mock.calls.flat().join('\n')).toContain('orphaned override: linkedin/search (plugin linkedin is not installed)');
  });

  it('reports adapter override state as JSON', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');
    const pluginsDir = path.join(home, '.webcmd', 'plugins');
    const upstream = path.join(pluginsDir, 'linkedin', 'search.js');
    fs.mkdirSync(path.dirname(upstream), { recursive: true });
    fs.mkdirSync(path.join(userClis, 'linkedin'), { recursive: true });
    fs.mkdirSync(path.join(userClis, 'local'), { recursive: true });
    fs.mkdirSync(path.join(userClis, 'old'), { recursive: true });
    fs.writeFileSync(upstream, '// upstream v2\n');
    fs.writeFileSync(path.join(userClis, 'linkedin', 'search.js'), '// override\n');
    fs.writeFileSync(path.join(userClis, 'local', 'run.js'), '// user adapter\n');
    fs.writeFileSync(path.join(userClis, 'old', 'search.js'), '// orphan\n');
    fs.writeFileSync(path.join(home, '.webcmd', 'override-provenance.json'), JSON.stringify({
      'linkedin/search': {
        plugin: 'linkedin', commitHash: null, sourcePath: upstream, sourceSha256: 'old-hash',
        basePath: '/tmp/base.js', createdAt: '2026-08-09T00:00:00.000Z',
      },
      'old/search': {
        plugin: 'old', commitHash: null, sourcePath: path.join(pluginsDir, 'old', 'search.js'), sourceSha256: 'old-hash',
        basePath: '/tmp/base.js', createdAt: '2026-08-09T00:00:00.000Z',
      },
    }));

    await createProgram('', userClis, pluginsDir)
      .parseAsync(['node', 'webcmd', 'adapter', 'status', '--format', 'json']);
    expect(JSON.parse(stdoutSpy.mock.calls.flat().join('\n'))).toEqual([
      { command: 'linkedin/search', kind: 'override', plugin: 'linkedin', reconciliationNeeded: true, orphaned: false },
      { command: 'local/run', kind: 'user', plugin: null, reconciliationNeeded: false, orphaned: false },
      { command: 'old/search', kind: 'override', plugin: 'old', reconciliationNeeded: false, orphaned: true },
    ]);
  });

  it('reports an empty adapter status as JSON', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');

    await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
      .parseAsync(['node', 'webcmd', 'adapter', 'status', '--format', 'json']);

    expect(JSON.parse(stdoutSpy.mock.calls.flat().join('\n'))).toEqual([]);
  });

  it('reports a JSON status error when a listed adapter site disappears', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');
    const siteDir = path.join(userClis, 'linkedin');
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    const originalReaddir = fs.promises.readdir;
    const readdir = vi.spyOn(fs.promises, 'readdir');
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'search.js'), '// adapter\n');
    readdir.mockImplementationOnce(async () => {
      const entries = await originalReaddir(userClis, { withFileTypes: true });
      fs.rmSync(siteDir, { recursive: true });
      return entries as any;
    });
    try {
      await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
        .parseAsync(['node', 'webcmd', 'adapter', 'status', '--format', 'json']);

      expect(stdoutSpy.mock.calls.flat().join('\n')).not.toBe('[]');
      expect(stderrSpy.mock.calls.flat().join('\n')).toContain('ENOENT');
      expect(process.exitCode).not.toBe(0);
    } finally {
      readdir.mockRestore();
      process.exitCode = previousExitCode;
      stderrSpy.mockRestore();
    }
  });

  it('reports malformed override provenance as a JSON status error', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    fs.mkdirSync(path.join(userClis, 'linkedin'), { recursive: true });
    fs.writeFileSync(path.join(userClis, 'linkedin', 'search.js'), '// override\n');
    fs.writeFileSync(path.join(home, '.webcmd', 'override-provenance.json'), '{not json');
    try {
      await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
        .parseAsync(['node', 'webcmd', 'adapter', 'status', '--format', 'json']);

      expect(stdoutSpy.mock.calls.flat().join('\n')).not.toBe('[]');
      expect(stderrSpy.mock.calls.flat().join('\n')).toContain('Malformed override provenance store');
    } finally {
      process.exitCode = previousExitCode;
      stderrSpy.mockRestore();
    }
  });

  it('reports malformed override provenance as a table status error', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    fs.mkdirSync(path.join(userClis, 'linkedin'), { recursive: true });
    fs.writeFileSync(path.join(userClis, 'linkedin', 'search.js'), '// override\n');
    fs.writeFileSync(path.join(home, '.webcmd', 'override-provenance.json'), '{not json');
    try {
      await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
        .parseAsync(['node', 'webcmd', 'adapter', 'status']);

      expect(stdoutSpy.mock.calls.flat().join('\n')).not.toContain('No local adapters installed.');
      expect(stderrSpy.mock.calls.flat().join('\n')).toContain('Malformed override provenance store');
      expect(process.exitCode).not.toBe(0);
    } finally {
      process.exitCode = previousExitCode;
      stderrSpy.mockRestore();
    }
  });

  it('fails reset --all loudly on malformed provenance before deleting adapters', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');
    const siteDir = path.join(userClis, 'linkedin');
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'search.js'), '// override\n');
    fs.writeFileSync(path.join(home, '.webcmd', 'override-provenance.json'), '{not json');
    try {
      await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
        .parseAsync(['node', 'webcmd', 'adapter', 'reset', '--all']);

      expect(fs.existsSync(siteDir)).toBe(true);
      expect(stdoutSpy.mock.calls.flat().join('\n')).not.toContain('No local sites to reset.');
      expect(stderrSpy.mock.calls.flat().join('\n')).toContain('Malformed override provenance store');
      expect(process.exitCode).not.toBe(0);
    } finally {
      process.exitCode = previousExitCode;
      stderrSpy.mockRestore();
    }
  });

  it('fails reset --all loudly on malformed provenance when clis is empty', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    fs.mkdirSync(userClis, { recursive: true });
    fs.writeFileSync(path.join(home, '.webcmd', 'override-provenance.json'), '{not json');
    try {
      await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
        .parseAsync(['node', 'webcmd', 'adapter', 'reset', '--all']);

      expect(stdoutSpy.mock.calls.flat().join('\n')).not.toContain('No local sites to reset.');
      expect(stderrSpy.mock.calls.flat().join('\n')).toContain('Malformed override provenance store');
      expect(process.exitCode).not.toBe(0);
    } finally {
      process.exitCode = previousExitCode;
      stderrSpy.mockRestore();
    }
  });

  it('reports no sites when reset --all has no local adapter directory', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');

    await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
      .parseAsync(['node', 'webcmd', 'adapter', 'reset', '--all']);

    expect(stdoutSpy.mock.calls.flat().join('\n')).toContain('No local sites to reset.');
  });

  it('reports no sites when reset --all has an empty adapter directory and no provenance', async () => {
    const userClis = path.join(home, '.webcmd', 'clis');
    fs.mkdirSync(userClis, { recursive: true });

    await createProgram('', userClis, path.join(home, '.webcmd', 'plugins'))
      .parseAsync(['node', 'webcmd', 'adapter', 'reset', '--all']);

    expect(stdoutSpy.mock.calls.flat().join('\n')).toContain('No local sites to reset.');
  });
});

describe('Antigravity serve plugin loading', () => {
  it('loads serve.js from the installed Antigravity plugin', async () => {
    const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-antigravity-plugins-'));
    const pluginDir = path.join(pluginsDir, 'antigravity');
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(path.join(pluginDir, 'package.json'), '{"type":"module"}\n');
    fs.writeFileSync(path.join(pluginDir, 'serve.js'), 'export const loadedFrom = "installed-plugin";\n');
    try {
      await expect(loadAntigravityServe(pluginsDir)).resolves.toMatchObject({
        loadedFrom: 'installed-plugin',
      });
    } finally {
      fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  });

  it('omits the serve bridge and uses missing-plugin guidance when Antigravity is absent', async () => {
    const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-antigravity-absent-'));
    const registry = getRegistry();
    const snapshot = new Map(registry);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    registry.clear();
    try {
      const program = createProgram('', '', pluginsDir);
      program.outputHelp = vi.fn();

      await program.parseAsync(['antigravity', 'serve'], { from: 'user' });

      expect(program.commands.some(command => command.name() === 'antigravity')).toBe(false);
      expect(stderr.mock.calls.map(([line]) => line).join('\n')).toContain('Search: webcmd plugin search antigravity');
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = previousExitCode;
      stderr.mockRestore();
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
      fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  });

  it('registers the serve bridge when the installed Antigravity module exists', () => {
    const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-antigravity-present-'));
    const pluginDir = path.join(pluginsDir, 'antigravity');
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(path.join(pluginDir, 'serve.js'), 'export async function startServe() {}\n');
    try {
      const antigravity = createProgram('', '', pluginsDir).commands.find(command => command.name() === 'antigravity');

      expect(antigravity?.commands.map(command => command.name())).toContain('serve');
    } finally {
      fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  });
});

describe('createProgram root help descriptions', () => {
  function descriptionFor(program: ReturnType<typeof createProgram>, name: string): string | undefined {
    return program.commands.find(cmd => cmd.name() === name)?.description();
  }

  it('summarizes built-in command groups with their subcommands', () => {
    const program = createProgram('', '');

    expect(descriptionFor(program, 'browser')).toContain('tabs');
    expect(descriptionFor(program, 'browser')).toContain('verify');
    expect(descriptionFor(program, 'browser')).not.toContain('Browser control');
    expect(descriptionFor(program, 'auth')).toBe('refresh, status');
    expect(descriptionFor(program, 'plugin')).toBe('catalog, create, install, list, search, uninstall, update');
    expect(descriptionFor(program, 'adapter')).toBe('override, path, reset, source, status');
    expect(descriptionFor(program, 'profile')).toBe('list, rename, use');
    expect(descriptionFor(program, 'daemon')).toBe('restart, status, stop');
    expect(descriptionFor(program, 'external')).toBe('install, list, register');
  });

  it('exposes add and remove without an install command', () => {
    const skills = createProgram('', '').commands.find((command) => command.name() === 'skills')!;

    expect(skills.commands.map((command) => command.name())).toEqual(['list', 'add', 'update', 'remove']);
    expect(skills.commands.find((command) => command.name() === 'add')?.aliases()).toEqual([]);
  });

  it('keeps legacy local adapters manageable without claiming a bundled baseline', () => {
    const adapter = createProgram('', '').commands.find((command) => command.name() === 'adapter')!;

    expect(adapter.commands.map((command) => command.name())).toEqual(['status', 'reset', 'override', 'source', 'path']);
    expect(adapter.helpInformation()).not.toMatch(/official|baseline|eject/i);
  });

  it('renders auth namespace structured help', () => {
    const argv = process.argv;
    try {
      const program = createProgram('', '');
      const auth = program.commands.find(cmd => cmd.name() === 'auth')!;
      expect(auth).toBeTruthy();

      process.argv = ['node', 'webcmd', 'auth', '--help', '-f', 'yaml'];
      const data = yaml.load(auth.helpInformation()) as any;

      expect(data).toMatchObject({
        namespace: 'auth',
        description: 'Inspect website login status',
        command_count: 2,
      });
      expect(data.commands.map((cmd: any) => cmd.name)).toEqual(['refresh', 'status']);
      const status = auth.commands.find(cmd => cmd.name() === 'status')!;
      process.argv = ['node', 'webcmd', 'auth', 'status', '--help', '-f', 'yaml'];
      const statusData = yaml.load(status.helpInformation()) as any;
      expect(statusData.command).toBe('webcmd auth status');
      expect(statusData.command_options.map((option: any) => option.name)).toEqual(expect.arrayContaining([
        'site',
        'full',
        'concurrency',
        'timeout',
        'only',
        'format',
      ]));
    } finally {
      process.argv = argv;
    }
  });

  it('keeps leaf command descriptions unchanged', () => {
    const program = createProgram('', '');

    expect(descriptionFor(program, 'list')).toBe('List all available CLI commands');
    expect(descriptionFor(program, 'doctor')).toBe('Diagnose webcmd browser bridge connectivity');
  });

  it('renders the actual local root through the shared root presentation seam', () => {
    const program = createProgram('', '');
    const presentation = getInstalledRootHelpPresentation(program);
    const commanderHelp = program.createHelp();

    expect(presentation).toBeDefined();
    expect(presentation!.baseText).toBe(commanderHelp.formatHelp(program, commanderHelp));
    expect(program.helpInformation()).toBe(formatRootHelp(presentation!));
  });

  it('guides an absent site to explicit plugin search and install without side effects', async () => {
    const plugin = await import('./plugin.js');
    const catalog = await import('./plugin-catalog.js');
    const install = vi.spyOn(plugin, 'installPlugin');
    const search = vi.spyOn(catalog, 'searchCatalogPlugins');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    const program = createProgram('', '');
    program.outputHelp = vi.fn();

    try {
      await program.parseAsync(['example', 'missing-command'], { from: 'user' });

      expect(stderr.mock.calls.map(([line]) => line).join('\n')).toContain([
        'Site "example" is not installed.',
        'Search: webcmd plugin search example',
        'Install using the installSource returned by search.',
      ].join('\n'));
      expect(install).not.toHaveBeenCalled();
      expect(search).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = previousExitCode;
      stderr.mockRestore();
      install.mockRestore();
      search.mockRestore();
    }
  });

  it('keeps site adapters out of root commands and lists sites in the root help tail', () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    registry.clear();
    try {
      cli({
        site: 'reddit',
        name: 'hot',
        access: 'read',
        description: 'Reddit hot posts',
        strategy: Strategy.PUBLIC,
        browser: false,
      });
      cli({
        site: 'youtube',
        name: 'search',
        access: 'read',
        description: 'Search YouTube',
        strategy: Strategy.PUBLIC,
        browser: false,
      });

      const program = createProgram('', '');
      const help = program.helpInformation();

      expect(help).toContain('Site adapters (2):');
      expect(help).toContain('reddit, youtube');
      expect(help).toContain("webcmd <site> --help -f yaml");
      expect(help).not.toMatch(/\n  reddit\s+hot/);
      expect(help).not.toMatch(/\n  youtube\s+search/);
    } finally {
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('groups adapters into App / Site buckets by domain field', () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    registry.clear();
    try {
      cli({
        site: 'youtube',
        name: 'search',
        access: 'read',
        description: 'Search YouTube',
        domain: 'www.youtube.com',
        strategy: Strategy.PUBLIC,
        browser: false,
      });
      cli({
        site: 'chatwise',
        name: 'ask',
        access: 'write',
        description: 'Ask Chatwise desktop app',
        domain: 'localhost',
        strategy: Strategy.UI,
        browser: true,
      });

      const program = createProgram('', '');
      const help = program.helpInformation();

      // Two separate sections, each with own count
      expect(help).toContain('App adapters (1):');
      expect(help).toMatch(/App adapters \(1\):\n {2}chatwise/);
      expect(help).toContain('Site adapters (1):');
      expect(help).toMatch(/Site adapters \(1\):\n {2}youtube/);

      // App adapters appear before Site adapters (External CLIs are absent here)
      expect(help.indexOf('App adapters')).toBeLessThan(help.indexOf('Site adapters'));
    } finally {
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('classifies local IP domains as app adapters', () => {
    expect(classifyAdapter('localhost')).toBe('app');
    expect(classifyAdapter('127.0.0.1')).toBe('app');
    expect(classifyAdapter('::1')).toBe('app');
    expect(classifyAdapter('www.youtube.com')).toBe('site');
  });

  it('splits list table output into App and Site sections without changing per-site rows', async () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const restoreStdoutSpy = () => stdoutSpy.mockImplementation(() => {});
    registry.clear();
    try {
      cli({
        site: 'antigravity',
        name: 'history',
        access: 'read',
        description: 'Read Antigravity history',
        domain: '127.0.0.1',
        strategy: Strategy.UI,
        browser: true,
      });
      cli({
        site: 'chatwise',
        name: 'ask',
        access: 'write',
        description: 'Ask Chatwise desktop app',
        domain: 'localhost',
        strategy: Strategy.UI,
        browser: true,
      });
      cli({
        site: 'youtube',
name: 'search',
        access: 'read',
        description: 'Search YouTube',
        domain: 'www.youtube.com',
        strategy: Strategy.PUBLIC,
        browser: false,
      });

      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', 'list']);
      const output = stdoutSpy.mock.calls.flat().join('\n');

      expect(output).toContain('App adapters');
      expect(output).toContain('Site adapters');
      expect(output.indexOf('App adapters')).toBeLessThan(output.indexOf('Site adapters'));
      expect(output).toMatch(/App adapters[\s\S]*antigravity[\s\S]*history \[ui\] — Read Antigravity history/);
      expect(output).toMatch(/App adapters[\s\S]*chatwise[\s\S]*ask \[ui\] — Ask Chatwise desktop app/);
      expect(output).toMatch(/Site adapters[\s\S]*youtube[\s\S]*search \[public\] — Search YouTube/);
      expect(output).toContain('3 built-in commands across 2 apps + 1 sites,');
    } finally {
      restoreStdoutSpy();
      stdoutSpy.mockClear();
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('omits empty list table sections and leaves structured list rows unchanged', async () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const restoreStdoutSpy = () => stdoutSpy.mockImplementation(() => {});
    registry.clear();
    try {
      cli({
        site: 'youtube',
        name: 'search',
        access: 'read',
        description: 'Search YouTube',
        domain: 'www.youtube.com',
        strategy: Strategy.PUBLIC,
        browser: false,
        columns: ['title', 'url'],
      });

      const tableProgram = createProgram('', '');
      await tableProgram.parseAsync(['node', 'webcmd', 'list']);
      const tableOutput = stdoutSpy.mock.calls.flat().join('\n');
      expect(tableOutput).not.toContain('App adapters');
      expect(tableOutput).toContain('Site adapters');
      expect(tableOutput).toContain('1 built-in commands across 0 apps + 1 sites,');

      stdoutSpy.mockClear();
      const jsonProgram = createProgram('', '');
      await jsonProgram.parseAsync(['node', 'webcmd', 'list', '-f', 'json']);
      const jsonOutput = stdoutSpy.mock.calls.flat().join('\n');
      const rows = JSON.parse(jsonOutput);
      expect(rows).toMatchObject([
        {
          site: 'youtube',
          name: 'search',
          domain: 'www.youtube.com',
          columns: ['title', 'url'],
        },
      ]);
      expect(rows[0]).not.toHaveProperty('adapterKind');
      expect(rows[0]).not.toHaveProperty('section');
    } finally {
      restoreStdoutSpy();
      stdoutSpy.mockClear();
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('filters local structured list rows by an exact case-insensitive tag', async () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    const outputSpy = vi.mocked(console.log);
    registry.clear();
    try {
      cli({
        site: 'searchable',
        name: 'find',
        access: 'read',
        description: 'Find records',
        strategy: Strategy.PUBLIC,
        browser: false,
        tags: ['search'],
        keywords: ['lookup'],
      });
      cli({
        site: 'other',
        name: 'write',
        access: 'write',
        description: 'Write records',
        strategy: Strategy.PUBLIC,
        browser: false,
        tags: ['write'],
      });

      outputSpy.mockClear();
      await createProgram('', '').parseAsync(['node', 'webcmd', 'list', '--tag', 'SEARCH', '-f', 'json']);
      const rows = JSON.parse(outputSpy.mock.calls.flat().join('\n'));

      expect(rows).toEqual([expect.objectContaining({
        command: 'searchable/find',
        tags: ['search'],
        keywords: ['lookup'],
      })]);
    } finally {
      outputSpy.mockClear();
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it.each(['json', 'yaml', 'yml'])(
    'renders local list %s through the shared list presentation',
    async (format) => {
      const registry = getRegistry();
      const snapshot = new Map(registry);
      registry.clear();
      try {
        const command = cli({
          site: 'github',
          name: 'issues',
          aliases: ['issue-list'],
          access: 'read',
          description: 'List repository issues',
          strategy: Strategy.PUBLIC,
          browser: false,
          args: [{ name: 'limit', type: 'int', default: 20, help: 'Maximum issues' }],
          columns: ['number', 'title'],
        });
        const presentation = commandListPresentation([
          { ...toPresentableCommand(command), origin: 'builtin' },
        ], format);

        const outputSpy = vi.mocked(console.log);
        outputSpy.mockClear();
        const program = createProgram('', '');
        await program.parseAsync(['node', 'webcmd', 'list', '-f', format]);
        const actual = outputSpy.mock.calls.flat().join('\n');

        outputSpy.mockClear();
        renderOutput(presentation.rows, {
          fmt: format,
          columns: presentation.columns,
          title: 'webcmd/list',
          source: 'webcmd list',
        });
        const expected = outputSpy.mock.calls.flat().join('\n');
        outputSpy.mockClear();

        expect(actual).toBe(expected);
      } finally {
        registry.clear();
        for (const [key, value] of snapshot) registry.set(key, value);
      }
    },
  );

  it('exposes external_clis / app_adapters / site_adapters in structured help', () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    const argv = process.argv;
    registry.clear();
    try {
      cli({
        site: 'youtube',
        name: 'search',
        access: 'read',
        description: 'Search YouTube',
        domain: 'www.youtube.com',
        strategy: Strategy.PUBLIC,
        browser: false,
      });
      cli({
        site: 'chatwise',
        name: 'ask',
        access: 'write',
        description: 'Ask Chatwise desktop app',
        domain: 'localhost',
        strategy: Strategy.UI,
        browser: true,
      });

      const program = createProgram('', '');
      process.argv = ['node', 'webcmd', '--help', '-f', 'yaml'];
      const data = yaml.load(program.helpInformation()) as any;

      expect(data.app_adapters.count).toBe(1);
      expect(data.app_adapters.apps).toEqual(['chatwise']);
      expect(data.site_adapters.count).toBe(1);
      expect(data.site_adapters.sites).toEqual(['youtube']);
      expect(data.external_clis.count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.external_clis.clis)).toBe(true);
      expect(Array.isArray(data.external_clis.display)).toBe(true);
      // Adapters must NOT leak into the core commands list
      const commandNames = data.commands.map((cmd: any) => cmd.name);
      expect(commandNames).not.toContain('youtube');
      expect(commandNames).not.toContain('chatwise');
    } finally {
      process.argv = argv;
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('renders root structured help with built-ins and site adapter names', () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    const argv = process.argv;
    registry.clear();
    try {
      cli({
        site: 'youtube',
        name: 'search',
        access: 'read',
        description: 'Search YouTube',
        strategy: Strategy.PUBLIC,
        browser: false,
      });

      const program = createProgram('', '');
      process.argv = ['node', 'webcmd', '--help', '-f', 'yaml'];
      const data = yaml.load(program.helpInformation()) as any;

      expect(data.site_adapters.count).toBe(1);
      expect(data.site_adapters.sites).toEqual(['youtube']);
      expect(data.commands.map((cmd: any) => cmd.name)).toContain('list');
      expect(data.commands.map((cmd: any) => cmd.name)).not.toContain('youtube');
    } finally {
      process.argv = argv;
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('renders per-site structured help with all commands, access, args, and examples', () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    const argv = process.argv;
    registry.clear();
    try {
      cli({
        site: 'youtube',
        name: 'search',
        access: 'read',
        description: 'Search YouTube',
        strategy: Strategy.PUBLIC,
        browser: false,
        args: [{ name: 'limit', type: 'int', default: 20, help: 'Number of videos' }],
        columns: ['title', 'url'],
      });

      const program = createProgram('', '');
      const site = program.commands.find(cmd => cmd.name() === 'youtube');
      expect(site).toBeTruthy();
      process.argv = ['node', 'webcmd', 'youtube', '--help', '-f', 'yaml'];
      const data = yaml.load(site!.helpInformation()) as any;

      expect(data.site).toBe('youtube');
      expect(data.commands).toMatchObject([
        {
          name: 'search',
          access: 'read',
          description: 'Search YouTube',
          browser: false,
          example: 'webcmd youtube search -f yaml',
          command_options: [{ name: 'limit', type: 'int', default: 20 }],
          columns: ['title', 'url'],
        },
      ]);
      expect(data.commands[0]).not.toHaveProperty('args');
    } finally {
      process.argv = argv;
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('renders per-site text help without per-command common option noise', () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    registry.clear();
    try {
      cli({
        site: 'youtube',
        name: 'search',
        access: 'read',
        description: 'Search YouTube',
        strategy: Strategy.PUBLIC,
        browser: false,
        args: [{ name: 'limit', type: 'int', default: 20, help: 'Number of videos' }],
      });
      cli({
        site: 'youtube',
        name: 'video',
        access: 'read',
        description: 'Read one video',
        domain: 'www.youtube.com',
        strategy: Strategy.PUBLIC,
        browser: true,
        args: [{ name: 'bvid', positional: true, required: true, help: 'Video id' }],
      });

      const program = createProgram('', '');
      const site = program.commands.find(cmd => cmd.name() === 'youtube');
      expect(site).toBeTruthy();
      const help = site!.helpInformation();

      expect(help).toContain('search [options]  [read] Search YouTube');
      expect(help).toContain('video <bvid>      [read] Read one video');
      expect(help).toContain('search [options]');
      expect(help).not.toContain('video <bvid> [options]');
      expect(help).not.toContain('\nOptions:');
      expect(help).toContain('Common options:');
      expect(help).toContain('-f, --format <fmt>');
      expect(help).toContain('--trace <mode>');
      expect(help).toContain('get all command args/options in one structured response');
    } finally {
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('separates command args from common options in structured help', () => {
    const registry = getRegistry();
    const snapshot = new Map(registry);
    const argv = process.argv;
    registry.clear();
    try {
      cli({
        site: 'youtube',
        name: 'video',
        access: 'read',
        description: 'Read one video',
        strategy: Strategy.PUBLIC,
        domain: 'www.youtube.com',
        browser: true,
        args: [
          { name: 'bvid', positional: true, required: true, help: 'Video id' },
          { name: 'with-comments', type: 'boolean', default: false, help: 'Include comments' },
        ],
        columns: ['title', 'url'],
      });

      const program = createProgram('', '');
      const site = program.commands.find(cmd => cmd.name() === 'youtube');
      const command = site!.commands.find(cmd => cmd.name() === 'video');
      expect(command).toBeTruthy();
      process.argv = ['node', 'webcmd', 'youtube', 'video', '--help', '-f', 'yaml'];
      const data = yaml.load(command!.helpInformation()) as any;

      expect(data.usage).toBe('webcmd youtube video <bvid> [options]');
      expect(data.browser).toBe(true);
      expect(data.domain).toBe('www.youtube.com');
      expect(data.positionals).toMatchObject([{ name: 'bvid', positional: true, required: true }]);
      expect(data.command_options).toMatchObject([{ name: 'with-comments', default: false }]);
      expect(data.common_options.map((option: any) => option.name)).toEqual(['format', 'trace', 'verbose', 'help']);
      expect(data.columns).toEqual(['title', 'url']);
      expect(data).not.toHaveProperty('args');
    } finally {
      process.argv = argv;
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('renders browser namespace structured help from Commander metadata', () => {
    const argv = process.argv;
    try {
      const program = createProgram('', '');
      const browser = program.commands.find(cmd => cmd.name() === 'browser');
      expect(browser).toBeTruthy();

      process.argv = ['node', 'webcmd', 'browser', '--session', 'test', '--help', '-f', 'yaml'];
      const data = yaml.load(browser!.helpInformation()) as any;

      expect(data.namespace).toBe('browser');
      expect(data.command).toBe('webcmd browser');
      expect(data.description).toBe('Run Playwright programs against named browser sessions');
      expect(data.command_count).toBe(8);
      expect(data.commands.map((cmd: any) => cmd.name)).toEqual(['bind', 'close', 'fork', 'init', 'run', 'snapshot', 'tabs', 'verify']);
      // `--session` is now a hidden internal option; user-facing surface is the
      // <session> positional declared via `.usage()`. Structured help drops
      // hidden options, so namespace_options shouldn't expose it.
      expect(data.namespace_options).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'session' }),
      ]));
      expect(data.namespace_options).toEqual([]);
      expect(data.usage).toBe('webcmd browser <session> <command> [options]');
      expect(data.global_options).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'version',
          flags: '-V, --version',
        }),
        expect.objectContaining({
          name: 'profile',
          flags: '--profile <name>',
          takes_value: 'required',
        }),
      ]));

      const bind = data.commands.find((cmd: any) => cmd.name === 'bind');
      // Structured help command/usage paths include the <session> positional so
      // agents construct the correct full invocation. `name` is the leaf
      // identifier (placeholder positionals are stripped).
      expect(bind).toMatchObject({
        command: 'webcmd browser <session> bind',
        usage: 'webcmd browser <session> bind [options]',
        positionals: [],
      });
      expect(bind.command_options.map((option: any) => option.name)).toEqual(['page']);
      expect(data.structured_help).toMatchObject({
        formats: ['yaml', 'json'],
        usage: 'webcmd browser --help -f yaml',
      });
    } finally {
      process.argv = argv;
    }
  });

  it('renders daemon namespace structured help with leaves and global options', () => {
    const argv = process.argv;
    try {
      const program = createProgram('', '');
      const daemon = program.commands.find(cmd => cmd.name() === 'daemon')!;
      expect(daemon).toBeTruthy();

      process.argv = ['node', 'webcmd', 'daemon', '--help', '-f', 'yaml'];
      const data = yaml.load(daemon.helpInformation()) as any;

      expect(data).toMatchObject({
        namespace: 'daemon',
        command: 'webcmd daemon',
        usage: 'webcmd daemon <command> [args] [options]',
        description: 'Manage the webcmd daemon',
        command_count: 3,
        namespace_options: [],
        structured_help: { usage: 'webcmd daemon --help -f yaml' },
      });
      expect(data.commands.map((cmd: any) => cmd.name)).toEqual(['restart', 'status', 'stop']);
      expect(data.global_options.map((option: any) => option.name)).toEqual(expect.arrayContaining(['version', 'profile']));
    } finally {
      process.argv = argv;
    }
  });

  it('renders plugin namespace structured help with positional + option leaves', () => {
    const argv = process.argv;
    try {
      const program = createProgram('', '');
      const plugin = program.commands.find(cmd => cmd.name() === 'plugin')!;
      expect(plugin).toBeTruthy();

      process.argv = ['node', 'webcmd', 'plugin', '--help', '-f', 'yaml'];
      const data = yaml.load(plugin.helpInformation()) as any;

      expect(data).toMatchObject({
        namespace: 'plugin',
        command: 'webcmd plugin',
        description: 'Manage webcmd plugins',
        namespace_options: [],
      });
      expect(data.commands.map((cmd: any) => cmd.name)).toEqual(['catalog add', 'catalog list', 'catalog remove', 'create', 'install', 'list', 'search', 'uninstall', 'update']);
      const update = data.commands.find((cmd: any) => cmd.name === 'update');
      expect(update).toMatchObject({
        usage: 'webcmd plugin update [name] [options]',
        positionals: [{ name: 'name' }],
      });
      expect(update.command_options.map((option: any) => option.name)).toEqual(['all', 'force']);
    } finally {
      process.argv = argv;
    }
  });

  it('uses the shared plugin search and install grammar', () => {
    const program = createProgram('', '');
    const plugin = program.commands.find(cmd => cmd.name() === 'plugin')!;
    const search = plugin.commands.find(cmd => cmd.name() === 'search')!;
    const install = plugin.commands.find(cmd => cmd.name() === 'install')!;

    expect(search.usage()).toBe('[options] [query]');
    expect(search.options.map(option => option.flags)).toContain('-f, --format <fmt>');
    expect(install.usage()).toBe('[options] <source>');
    expect(install.description()).toBe('Install a plugin from a git repository');
  });

  it('renders adapter namespace structured help preserving original description after applyRootSubcommandSummaries', () => {
    const argv = process.argv;
    try {
      const program = createProgram('', '');
      const adapter = program.commands.find(cmd => cmd.name() === 'adapter')!;
      expect(adapter).toBeTruthy();

      process.argv = ['node', 'webcmd', 'adapter', '--help', '-f', 'yaml'];
      const data = yaml.load(adapter.helpInformation()) as any;

      // applyRootSubcommandSummaries() rewrites .description() to a child-name listing;
      // structured help must surface the original product description via the snapshot.
      expect(data.description).toBe('Manage CLI adapters');
      expect(data.commands.map((cmd: any) => cmd.name)).toEqual(['override', 'path', 'reset', 'source get', 'source put', 'status']);
      const reset = data.commands.find((cmd: any) => cmd.name === 'reset');
      expect(reset).toMatchObject({
        usage: 'webcmd adapter reset [site] [options]',
        positionals: [{ name: 'site' }],
      });
      expect(reset.command_options.map((option: any) => option.name)).toEqual(['all']);
    } finally {
      process.argv = argv;
    }
  });

  it('renders profile namespace structured help including required positionals', () => {
    const argv = process.argv;
    try {
      const program = createProgram('', '');
      const profile = program.commands.find(cmd => cmd.name() === 'profile')!;
      expect(profile).toBeTruthy();

      process.argv = ['node', 'webcmd', 'profile', '--help', '-f', 'yaml'];
      const data = yaml.load(profile.helpInformation()) as any;

      expect(data).toMatchObject({
        namespace: 'profile',
        description: 'Manage webcmd browser runtime profiles',
        command_count: 3,
      });
      expect(data.commands.map((cmd: any) => cmd.name)).toEqual(['list', 'rename', 'use']);
      const list = data.commands.find((cmd: any) => cmd.name === 'list');
      expect(list).toMatchObject({
        description: 'List Chrome and Chromium profiles available through the Cloak runtime',
      });
      const rename = data.commands.find((cmd: any) => cmd.name === 'rename');
      expect(rename).toMatchObject({
        usage: 'webcmd profile rename <contextId> <alias> [options]',
        description: 'Assign a local alias to an available Cloak profile',
        positionals: [
          { name: 'contextId', required: true },
          { name: 'alias', required: true },
        ],
      });
      const use = data.commands.find((cmd: any) => cmd.name === 'use');
      expect(use).toMatchObject({
        description: 'Set the default Cloak profile for future commands',
      });
    } finally {
      process.argv = argv;
    }
  });
});

describe('resolveBrowserVerifyInvocation', () => {
  it('prefers the built entry declared in package metadata', () => {
    const projectRoot = path.join('repo-root');
    const exists = new Set([
      path.join(projectRoot, 'dist', 'src', 'main.js'),
    ]);

    expect(resolveBrowserVerifyInvocation({
      projectRoot,
      readFile: () => JSON.stringify({ bin: { webcmd: 'dist/src/main.js' } }),
      fileExists: (candidate) => exists.has(candidate),
    })).toEqual({
      binary: process.execPath,
      args: [path.join(projectRoot, 'dist', 'src', 'main.js')],
      cwd: projectRoot,
    });
  });

  it('falls back to compatibility built-entry candidates when package metadata is unavailable', () => {
    const projectRoot = path.join('repo-root');
    const exists = new Set([
      path.join(projectRoot, 'dist', 'src', 'main.js'),
    ]);

    expect(resolveBrowserVerifyInvocation({
      projectRoot,
      readFile: () => { throw new Error('no package json'); },
      fileExists: (candidate) => exists.has(candidate),
    })).toEqual({
      binary: process.execPath,
      args: [path.join(projectRoot, 'dist', 'src', 'main.js')],
      cwd: projectRoot,
    });
  });

  it('falls back to the local tsx binary in source checkouts on Windows', () => {
    const projectRoot = path.join('repo-root');
    const exists = new Set([
      path.join(projectRoot, 'src', 'main.ts'),
      path.join(projectRoot, 'node_modules', '.bin', 'tsx.cmd'),
    ]);

    expect(resolveBrowserVerifyInvocation({
      projectRoot,
      platform: 'win32',
      fileExists: (candidate) => exists.has(candidate),
    })).toEqual({
      binary: path.join(projectRoot, 'node_modules', '.bin', 'tsx.cmd'),
      args: [path.join(projectRoot, 'src', 'main.ts')],
      cwd: projectRoot,
      shell: true,
    });
  });

  it('falls back to npx tsx when local tsx is unavailable', () => {
    const projectRoot = path.join('repo-root');
    const exists = new Set([
      path.join(projectRoot, 'src', 'main.ts'),
    ]);

    expect(resolveBrowserVerifyInvocation({
      projectRoot,
      platform: 'linux',
      fileExists: (candidate) => exists.has(candidate),
    })).toEqual({
      binary: 'npx',
      args: ['tsx', path.join(projectRoot, 'src', 'main.ts')],
      cwd: projectRoot,
    });
  });
});

describe('selectFreshByTimestamp', () => {
  it('uses timestamp watermarks so rolled buffers still emit new messages', () => {
    const first = selectFreshByTimestamp([
      { timestamp: 1, text: 'a' },
      { timestamp: 2, text: 'b' },
    ], 0);
    expect(first.fresh.map((item) => item.text)).toEqual(['a', 'b']);
    expect(first.lastSeenTs).toBe(2);

    const rolled = selectFreshByTimestamp([
      { timestamp: 2, text: 'b' },
      { timestamp: 3, text: 'c' },
    ], first.lastSeenTs);
    expect(rolled.fresh.map((item) => item.text)).toEqual(['c']);
    expect(rolled.lastSeenTs).toBe(3);
  });
});

describe('resolveSitemapAvailabilityForUrl', () => {
  function registryFor(site: string, domain: string): Map<string, any> {
    return new Map([[`${site}:read`, {
      site,
      name: 'read',
      access: 'read',
      description: 'read',
      domain,
      browser: false,
      args: [],
    }]]);
  }

  it('detects local sitemap overlays using adapter registry domain matches', () => {
    const homeDir = path.join(os.tmpdir(), 'webcmd-sitemap-home');
    const packageRoot = path.join(os.tmpdir(), 'webcmd-sitemap-package');
    const localSitemap = path.join(homeDir, '.webcmd', 'sites', 'hackernews', 'sitemap');
    const exists = new Set([localSitemap]);

    const report = resolveSitemapAvailabilityForUrl('https://news.ycombinator.com/item?id=1', {
      homeDir,
      packageRoot,
      registry: registryFor('hackernews', 'news.ycombinator.com'),
      fileExists: (candidate) => exists.has(candidate),
    });

    expect(report).toMatchObject({
      site: 'hackernews',
      available: true,
      source: 'local',
      paths: { local: localSitemap },
    });
    expect(report?.hint).toContain('webcmd-browser-sitemap');
  });

  it('reports global+local when both sitemap layers exist', () => {
    const homeDir = path.join(os.tmpdir(), 'webcmd-sitemap-home');
    const packageRoot = path.join(os.tmpdir(), 'webcmd-sitemap-package');
    const localSitemap = path.join(homeDir, '.webcmd', 'sites', 'twitter', 'sitemap.md');
    const globalSitemap = path.join(packageRoot, 'sitemaps', 'twitter');
    const exists = new Set([localSitemap, globalSitemap]);

    const report = resolveSitemapAvailabilityForUrl('https://x.com/webcmd', {
      homeDir,
      packageRoot,
      registry: registryFor('twitter', 'x.com'),
      fileExists: (candidate) => exists.has(candidate),
    });

    expect(report).toMatchObject({
      site: 'twitter',
      source: 'local+global',
      paths: { local: localSitemap, global: globalSitemap },
    });
  });

  it('returns null when no sitemap layer exists', () => {
    const report = resolveSitemapAvailabilityForUrl('https://example.com/', {
      homeDir: path.join(os.tmpdir(), 'webcmd-sitemap-home'),
      packageRoot: path.join(os.tmpdir(), 'webcmd-sitemap-package'),
      registry: new Map(),
      fileExists: () => false,
    });

    expect(report).toBeNull();
  });
});

describe('browser verify', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    mockExecFileSync.mockReset().mockReturnValue('[]');
  });

  it('passes --trace through to the adapter subprocess', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-verify-trace-'));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;

    try {
      const adapterDir = path.join(fakeHome, '.webcmd', 'clis', 'hn');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(path.join(adapterDir, 'top.js'), 'export default {};\n', 'utf-8');

      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'verify', 'hn/top', '--no-fixture', '--trace', 'retain-on-failure']);

      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
      const [, execArgs] = mockExecFileSync.mock.calls[0] as [string, string[]];
      expect(execArgs.slice(-6)).toEqual(['hn', 'top', '--trace', 'retain-on-failure', '--format', 'json']);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('uses --seed-args when no fixture args exist', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-verify-seed-'));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;

    try {
      const adapterDir = path.join(fakeHome, '.webcmd', 'clis', 'hn');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(path.join(adapterDir, 'top.js'), 'export default {};\n', 'utf-8');

      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'verify', 'hn/top', '--no-fixture', '--seed-args', 'webcmd-verify']);

      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
      const [, execArgs] = mockExecFileSync.mock.calls[0] as [string, string[]];
      expect(execArgs.slice(-5)).toEqual(['hn', 'top', 'webcmd-verify', '--format', 'json']);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('writes --seed-args into a starter fixture', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-verify-write-seed-'));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    mockExecFileSync.mockReturnValue(JSON.stringify([{ title: 'ok' }]));

    try {
      const adapterDir = path.join(fakeHome, '.webcmd', 'clis', 'hn');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(path.join(adapterDir, 'top.js'), 'export default {};\n', 'utf-8');

      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'verify', 'hn/top', '--write-fixture', '--seed-args', 'webcmd-verify']);

      const fixtureFile = path.join(fakeHome, '.webcmd', 'sites', 'hn', 'verify', 'top.json');
      const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf-8'));
      expect(fixture.args).toEqual(['webcmd-verify']);
      expect(fixture.expect.columns).toEqual(['title']);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('fails before fixture handling when output row shape is not agent-native', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-verify-shape-'));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    mockExecFileSync.mockReturnValue(JSON.stringify([{ title: 'ok', author: { user_id: 'u1' } }]));
    const consoleLogSpy = vi.mocked(console.log);
    consoleLogSpy.mockClear();

    try {
      const adapterDir = path.join(fakeHome, '.webcmd', 'clis', 'hn');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(path.join(adapterDir, 'top.js'), 'export default {};\n', 'utf-8');

      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'verify', 'hn/top', '--no-fixture']);

      expect(process.exitCode).toBe(1);
      const output = consoleLogSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(output).toContain('Adapter output violates row shape conventions');
      expect(output).toContain('author.user_id');
    } finally {
      consoleLogSpy.mockClear();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

describe('profile list', () => {
  const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    process.exitCode = undefined;
    stdoutSpy.mockClear();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('reports stale daemon instead of no profiles when status lacks profile support', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        pid: 123,
        uptime: 1,
        daemonVersion: '1.7.6',
        runtimeConnected: true,
        runtimeName: 'Cloak',
        runtimeVersion: '1.0.3',
        pending: 0,
        memoryMB: 20,
        port: 9777,
      }),
    } as Response);
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', 'profile', 'list']);

    const output = stdoutSpy.mock.calls.flat().join('\n');
    expect(output).toContain('stale');
    expect(output).toContain('webcmd daemon restart');
    expect(output).not.toContain('No Cloak profiles available');
  });

  it('uses runtime profile wording when current daemon status has no profiles', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        pid: 123,
        uptime: 1,
        daemonVersion: PKG_VERSION,
        runtimeConnected: false,
        runtimeName: 'Cloak',
        profiles: [],
        pending: 0,
        memoryMB: 20,
        port: 9777,
      }),
    } as Response);
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', 'profile', 'list']);

    const output = stdoutSpy.mock.calls.flat().join('\n');
    expect(output).toContain('No Cloak runtime profiles are active');
    expect(output).toContain('Run a browser-backed command or webcmd <site> login to create one');
    expect(output).not.toContain(`Browser ${'Bridge'}`);
    expect(output).not.toContain(`Webcmd ${'extension'}`);
    expect(output).not.toContain('webcmd daemon restart');
  });
});

describe('browser raw session commands', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  beforeEach(() => {
    process.exitCode = undefined;
    consoleLogSpy.mockClear();
    stderrSpy.mockClear();
    mockBrowserConnect.mockClear();
    mockListExistingBrowserTabs.mockReset().mockResolvedValue([]);
    mockSendCommand.mockReset().mockResolvedValue({ ok: true });
  });

  it('lists tabs without allocating a local browser runtime', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'tabs']);

    expect(mockBrowserConnect).not.toHaveBeenCalled();
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(mockListExistingBrowserTabs).toHaveBeenCalledWith('test', {});
    expect(consoleLogSpy).toHaveBeenLastCalledWith('[]');
  });

  it('sends tabs directly when a runtime already exists', async () => {
    mockListExistingBrowserTabs.mockResolvedValue([{ page: 'page-123' }]);
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'tabs']);

    expect(mockBrowserConnect).not.toHaveBeenCalled();
    expect(mockListExistingBrowserTabs).toHaveBeenCalledWith('test', {});
  });

  it('binds only an explicit stable page id', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'bind', '--page', 'page-123']);

    expect(mockSendCommand).toHaveBeenCalledWith('bind', {
      session: 'test', surface: 'browser', page: 'page-123',
    });
    await expect(program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'bind', '--index', '0']))
      .rejects.toThrow(/process\.exit unexpectedly called/);
    await expect(program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'bind', '--page', '   ']))
      .rejects.toThrow(/process\.exit unexpectedly called/);
  });

  it('sends snapshot inspection options to the browser runtime', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'snapshot', '--snapshot-mode', 'read', '--ref', 'e12', '--max-output', '1000']);

    expect(mockSendCommand).toHaveBeenCalledWith('snapshot', {
      session: 'test', surface: 'browser', snapshotMode: 'read', ref: 'e12', maxOutputChars: 1000,
    });
  });

  it('reads program files for run and rejects mutually exclusive input', async () => {
    const sourcePath = path.join(os.tmpdir(), `webcmd-run-${Date.now()}.js`);
    fs.writeFileSync(sourcePath, 'return 42;', 'utf8');
    try {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'run', '--file', sourcePath]);
      expect(mockSendCommand).toHaveBeenCalledWith('run', {
        session: 'test', surface: 'browser', source: 'return 42;', snapshotMode: 'act',
      });

      await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'run', '--stdin', '--file', sourcePath]);
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBeDefined();

      process.exitCode = undefined;
      fs.writeFileSync(sourcePath, '', 'utf8');
      await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'run', '--file', sourcePath]);
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBeDefined();
    } finally {
      fs.rmSync(sourcePath, { force: true });
    }
  });

  it('closes the named session through the daemon', async () => {
    const program = createProgram('', '');
    await program.parseAsync(['node', 'webcmd', 'browser', '--session', 'test', 'close']);
    expect(mockSendCommand).toHaveBeenCalledWith('close-window', { session: 'test', surface: 'browser' });
  });
});

// Shared helper for the selector-first describe blocks below.
// Each block spies console.log, mocks the IPage surface it touches, and
// parses the last stringified call to inspect the JSON envelope — the
// canonical agent-facing contract for the selector-first commands.
function installSelectorFirstTestHarness(label: string, pageOverrides: () => Partial<IPage>) {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  function lastLogArg(): unknown {
    const calls = consoleLogSpy.mock.calls;
    if (calls.length === 0) throw new Error('expected console.log call');
    return calls[calls.length - 1][0];
  }
  function lastJsonLog(): any {
    const arg = lastLogArg();
    if (typeof arg !== 'string') throw new Error(`expected string arg, got ${typeof arg}`);
    return JSON.parse(arg);
  }

  beforeEach(() => {
    process.exitCode = undefined;
    process.env.WEBCMD_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `webcmd-${label}-`));
    consoleLogSpy.mockClear();
    mockBrowserConnect.mockClear();
    mockBrowserClose.mockReset().mockResolvedValue(undefined);

    browserState.page = {
      setActivePage: vi.fn(),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
      tabs: vi.fn().mockResolvedValue([{ page: 'tab-1', active: true }]),
      session: 'test',
      ...pageOverrides(),
    } as unknown as IPage;
  });

  return { lastJsonLog };
}

describe('findPackageRoot', () => {
  it('walks up from dist/src to the package root', () => {
    const packageRoot = path.join('repo-root');
    const cliFile = path.join(packageRoot, 'dist', 'src', 'cli.js');
    const exists = new Set([
      path.join(packageRoot, 'package.json'),
    ]);

    expect(findPackageRoot(cliFile, (candidate) => exists.has(candidate))).toBe(packageRoot);
  });

  it('walks up from src to the package root', () => {
    const packageRoot = path.join('repo-root');
    const cliFile = path.join(packageRoot, 'src', 'cli.ts');
    const exists = new Set([
      path.join(packageRoot, 'package.json'),
    ]);

    expect(findPackageRoot(cliFile, (candidate) => exists.has(candidate))).toBe(packageRoot);
  });
});

describe('normalizeVerifyRows', () => {
  it('returns an empty array for null / primitives', () => {
    expect(normalizeVerifyRows(null)).toEqual([]);
    expect(normalizeVerifyRows(undefined)).toEqual([]);
    expect(normalizeVerifyRows('hello')).toEqual([]);
  });

  it('passes through array-of-objects', () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(normalizeVerifyRows(rows)).toEqual(rows);
  });

  it('wraps array-of-primitives as { value } rows', () => {
    expect(normalizeVerifyRows([1, 'two', null])).toEqual([
      { value: 1 }, { value: 'two' }, { value: null },
    ]);
  });

  it('unwraps common envelope shapes', () => {
    expect(normalizeVerifyRows({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(normalizeVerifyRows({ items: [{ b: 2 }] })).toEqual([{ b: 2 }]);
    expect(normalizeVerifyRows({ data: [{ c: 3 }] })).toEqual([{ c: 3 }]);
    expect(normalizeVerifyRows({ results: [{ d: 4 }] })).toEqual([{ d: 4 }]);
  });

  it('wraps a single object as a one-row array', () => {
    expect(normalizeVerifyRows({ ok: true })).toEqual([{ ok: true }]);
  });
});

describe('renderVerifyPreview', () => {
  it('emits a placeholder for empty rows', () => {
    expect(renderVerifyPreview([])).toContain('no rows');
  });

  it('prints column headers followed by row cells', () => {
    const out = renderVerifyPreview([{ a: 'x', b: 1 }, { a: 'y', b: 2 }]);
    const lines = out.split('\n');
    expect(lines[0]).toContain('a');
    expect(lines[0]).toContain('b');
    expect(lines.some((l) => l.includes('x') && l.includes('1'))).toBe(true);
    expect(lines.some((l) => l.includes('y') && l.includes('2'))).toBe(true);
  });

  it('truncates long cells and reports hidden rows / columns', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      a: i, b: 'x'.repeat(100), c: i, d: i, e: i, f: i, g: i, h: i,
    }));
    const out = renderVerifyPreview(rows, { maxRows: 5, maxCols: 3, cellMax: 10 });
    expect(out).toContain('and 10 more row');
    expect(out).toContain('more column');
    // cell gets truncated
    expect(out).toContain('xxxxxxxxxx');
    expect(out).not.toContain('xxxxxxxxxxx'); // never 11 consecutive
  });
});
