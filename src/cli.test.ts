import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { cli, getRegistry, runWithDiscoverySource, Strategy } from './registry.js';
import { BrowserCommandError } from './browser/daemon-client.js';
import { getDaemonRunContext } from './session-lease.js';
import type { IPage } from './types.js';
import { TargetError } from './browser/target-errors.js';
import { PKG_VERSION } from './version.js';
import { EXIT_CODES } from './errors.js';
import { classifyAdapter, getInstalledRootHelpPresentation } from './help.js';
import {
  commandListPresentation,
  formatRootHelp,
  toPresentableCommand,
} from './command-presentation.js';
import { parseOutputFormat } from './command-surface.js';
import { render as renderOutput } from './output.js';
import * as pluginModule from './plugin.js';
import * as discoveryModule from './discovery.js';

const {
  mockBrowserConnect,
  mockBrowserClose,
  mockBindTab,
  mockListExistingBrowserTabs,
  mockReleaseSiteSessionLease,
  mockSendCommand,
  mockExecFileSync,
  browserState,
} = vi.hoisted(() => ({
  mockBrowserConnect: vi.fn(),
  mockBrowserClose: vi.fn(),
  mockBindTab: vi.fn(),
  mockListExistingBrowserTabs: vi.fn(),
  mockReleaseSiteSessionLease: vi.fn(),
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
    releaseSiteSessionLease: mockReleaseSiteSessionLease,
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

import { handleProgramParseError } from './cli-error-report.js';
import { createProgram, findPackageRoot, loadAntigravityServe, normalizeVerifyRows, renderVerifyPreview, resolveBrowserVerifyInvocation, selectFreshByTimestamp } from './cli.js';

const realHome = process.env.HOME;
const realConfigDir = process.env.WEBCMD_CONFIG_DIR;
let isolatedCliTestHome: string;

beforeEach(() => {
  isolatedCliTestHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cli-home-'));
  process.env.HOME = isolatedCliTestHome;
  process.env.WEBCMD_CONFIG_DIR = path.join(isolatedCliTestHome, '.webcmd');
});

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realConfigDir === undefined) delete process.env.WEBCMD_CONFIG_DIR;
  else process.env.WEBCMD_CONFIG_DIR = realConfigDir;
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

describe('site-memory and local adapter authoring', () => {
  it('keeps adapter help pointed at create vs override commands', () => {
    const program = createProgram('', '');
    const browserInit = program.commands.find(cmd => cmd.name() === 'browser')!
      .commands.find(cmd => cmd.name() === 'init')!;
    const adapter = program.commands.find(cmd => cmd.name() === 'adapter')!;

    expect(browserInit.helpInformation()).toContain('Create a new private adapter: webcmd browser init <site>/<command>');
    const adapterHelp = adapter.helpInformation();
    expect(adapterHelp).toMatch(/Override installed command: webcmd adapter\s+override\s+<site>\/<command>/);
    expect(adapterHelp).toMatch(/Locate local source: webcmd adapter path\s+<site>\/<command>/);
  });

  it('writes site-memory reads only when --output is requested', async () => {
    const output = path.join(isolatedCliTestHome, 'memory.json');
    const program = createProgram('', '');
    await program.parseAsync(['node', 'webcmd', 'site', 'note', 'add', 'github', '--text', 'Uses GraphQL']);
    await program.parseAsync(['node', 'webcmd', 'site', 'memory', 'show', 'github', '--output', output]);

    expect(fs.readFileSync(output, 'utf8')).toContain('Uses GraphQL');
  });

  it('rejects unresolved local adapter source paths', async () => {
    await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'adapter', 'path', 'missing/search']))
      .rejects.toThrow(/Adapter source is unavailable/);
  });

  it('accepts adapter path as two tokens', async () => {
    const key = 'split-source/search';
    const source = path.join(isolatedCliTestHome, 'split-search.js');
    fs.writeFileSync(source, 'export default {};');
    getRegistry().set(key, {
      site: 'split-source', name: 'search', access: 'read', description: 'split', args: [], source,
    } as never);
    try {
      await createProgram('', '').parseAsync(['node', 'webcmd', 'adapter', 'path', 'split-source', 'search']);
    } finally {
      getRegistry().delete(key);
    }
  });

  it('rejects local adapter source writes while directing users to the source path', async () => {
    const key = 'local-source/search';
    const source = path.join(isolatedCliTestHome, 'search.js');
    const output = path.join(isolatedCliTestHome, 'copy.js');
    fs.writeFileSync(source, 'export default {};');
    fs.writeFileSync(output, 'export default { updated: true };');
    getRegistry().set(key, {
      site: 'local-source', name: 'search', access: 'read', description: 'local source', args: [], source,
    } as never);
    try {
      await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'adapter', 'source', 'get', key, '--output', output]))
        .rejects.toThrow(`webcmd adapter path ${key}`);
      await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'adapter', 'source', 'put', key, output]))
        .rejects.toThrow(`webcmd adapter path ${key}`);
    } finally {
      getRegistry().delete(key);
    }
  });

  it('rejects a registered adapter whose source was deleted', async () => {
    const key = 'stale-source/search';
    const source = path.join(isolatedCliTestHome, 'deleted-source.js');
    fs.writeFileSync(source, 'export default {};');
    fs.rmSync(source);
    getRegistry().set(key, {
      site: 'stale-source', name: 'search', access: 'read', description: 'stale', args: [], source,
    } as never);
    try {
      await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'adapter', 'path', key]))
        .rejects.toThrow(/Adapter source is unavailable/);
    } finally {
      getRegistry().delete(key);
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
      { command: 'linkedin/search', kind: 'override', plugin: 'linkedin', reconciliationNeeded: true, orphaned: false, loadError: null },
      { command: 'local/run', kind: 'user', plugin: null, reconciliationNeeded: false, orphaned: false, loadError: null },
      { command: 'old/search', kind: 'override', plugin: 'old', reconciliationNeeded: false, orphaned: true, loadError: null },
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
    expect(descriptionFor(program, 'profile')).toBe('create, list, rename, use');
    expect(descriptionFor(program, 'daemon')).toBe('restart, status, stop');
    expect(descriptionFor(program, 'external')).toBe('install, list, register');
  });

  it('exposes add and remove without an install command', () => {
    const skills = createProgram('', '').commands.find((command) => command.name() === 'skills')!;

    expect(skills.commands.map((command) => command.name())).toEqual(['list', 'add', 'update', 'remove']);
    expect(skills.commands.find((command) => command.name() === 'add')?.aliases()).toEqual([]);
  });

  it('binds update and convention-audit actions to their own commands', () => {
    const program = createProgram('', '');
    const update = program.commands.find((command) => command.name() === 'update')!;
    const audit = program.commands.find((command) => command.name() === 'convention-audit')!;

    expect((update as unknown as { _actionHandler?: unknown })._actionHandler).toEqual(expect.any(Function));
    expect((audit as unknown as { _actionHandler?: unknown })._actionHandler).toEqual(expect.any(Function));
    expect((update as unknown as { _actionHandler?: unknown })._actionHandler)
      .not.toBe((audit as unknown as { _actionHandler?: unknown })._actionHandler);
  });

  it('keeps legacy local adapters manageable without claiming a bundled baseline', () => {
    const adapter = createProgram('', '').commands.find((command) => command.name() === 'adapter')!;

    expect(adapter.commands.map((command) => command.name())).toEqual(['status', 'reset', 'override', 'source', 'path']);
    expect(adapter.helpInformation()).not.toMatch(/official|baseline|eject/i);
  });

  it('describes local adapter source commands as path lookup, not source mutation', () => {
    const adapter = createProgram('', '').commands.find((command) => command.name() === 'adapter')!;
    const source = adapter.commands.find((command) => command.name() === 'source')!;

    expect(source.description()).toBe('Inspect local adapter source paths; hosted mode reads or writes source');
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

  it('suggests canonical discovery commands for unambiguous root noun mistakes', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    const program = createProgram('', '');
    program.outputHelp = vi.fn();

    try {
      await program.parseAsync(['catalog'], { from: 'user' });

      expect(stderr.mock.calls.map(([line]) => line).join('\n')).toContain([
        'Unknown command "catalog".',
        'Did you mean: webcmd plugin catalog list',
      ].join('\n'));
      expect(program.outputHelp).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = previousExitCode;
      stderr.mockRestore();
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
        const normalized = parseOutputFormat(format);
        const presentation = commandListPresentation([
          { ...toPresentableCommand(command), origin: 'builtin' },
        ], normalized);

        const outputSpy = vi.mocked(console.log);
        outputSpy.mockClear();
        const program = createProgram('', '');
        await program.parseAsync(['node', 'webcmd', 'list', '-f', format]);
        const actual = outputSpy.mock.calls.flat().join('\n');

        outputSpy.mockClear();
        renderOutput(presentation.rows, {
          fmt: normalized,
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
      expect(data.common_options.map((option: any) => option.name)).toEqual(['format', 'json', 'trace', 'verbose', 'help']);
      expect(data.columns).toEqual(['title', 'url']);
      expect(data).not.toHaveProperty('args');
    } finally {
      process.argv = argv;
      registry.clear();
      for (const [key, value] of snapshot) registry.set(key, value);
    }
  });

  it('points the retired browser fork subcommand at adapter override', () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => { errors.push(String(msg)); });
    const previousExitCode = process.exitCode;
    // A structural failure is thrown now, not printed from inside the parser;
    // handleProgramParseError turns it into bytes exactly as runCli does.
    const run = (argv: string[]): string => {
      let output = '';
      try {
        createProgram('', '').parse(argv, { from: 'user' });
      } catch (err) {
        handleProgramParseError(err, { write: (value: string) => { output += value; return true; } } as never);
      }
      return `${output}${errors.join('\n')}`;
    };
    try {
      expect(run(['browser', 'fork', 'hackernews/top'])).toContain('webcmd adapter override <site>/<command>');
      expect(process.exitCode).toBe(EXIT_CODES.USAGE_ERROR);

      errors.length = 0;
      const nonsense = run(['browser', 'nonsense']);
      expect(nonsense).toContain("error: unknown command 'nonsense'");
      expect(nonsense).toContain('help: valid subcommands for `webcmd browser`:');
    } finally {
      spy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it('renders browser namespace structured help from Commander metadata', () => {
    const argv = process.argv;
    try {
      const program = createProgram('', '');
      const browser = program.commands.find(cmd => cmd.name() === 'browser');
      expect(browser).toBeTruthy();

      process.argv = ['node', 'webcmd', '--session', 'work-k7', 'browser', '--help', '-f', 'yaml'];
      const data = yaml.load(browser!.helpInformation()) as any;

      expect(data.namespace).toBe('browser');
      expect(data.command).toBe('webcmd browser');
      expect(data.description).toBe('Run Playwright programs against an explicit browser Session');
      expect(data.command_count).toBe(7);
      expect(data.commands.map((cmd: any) => cmd.name)).toEqual(['bind', 'close', 'init', 'run', 'snapshot', 'tabs', 'verify']);
      expect(data.namespace_options).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'session' }),
      ]));
      expect(data.namespace_options).toEqual([]);
      expect(data.usage).toBe('webcmd browser <command> [args] [options]');
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
        expect.objectContaining({
          name: 'session',
          flags: '--session <session-id>',
          takes_value: 'required',
        }),
      ]));

      const bind = data.commands.find((cmd: any) => cmd.name === 'bind');
      expect(bind).toMatchObject({
        command: 'webcmd browser bind',
        usage: 'webcmd browser bind [options]',
        positionals: [],
      });
      expect(bind.command_options.map((option: any) => option.name)).toEqual(['page', 'verbose', 'format', 'json']);
      expect(data.structured_help).toMatchObject({
        formats: ['yaml', 'json'],
        usage: 'webcmd browser --help -f yaml',
      });
    } finally {
      process.argv = argv;
    }
  });

  it('shows agent examples and the --json alias on browser run help', () => {
    const program = createProgram('', '');
    const browser = program.commands.find(cmd => cmd.name() === 'browser')!;
    const run = browser.commands.find(cmd => cmd.name() === 'run')!;
    const help = run.helpInformation();

    expect(help).toContain('--json');
    expect(help).toContain("await page.goto('https://example.com')");
    expect(help).toContain("await page.goto('data:text/html,");
    expect(help).toContain("await download.saveAs(download.suggestedFilename())");
    expect(help).toContain("await page.locator('input[type=file]').setInputFiles('/tmp/upload.pdf')");
    expect(help).toContain("const popupPromise = context.waitForEvent('page', { timeout: 5000 })");
    expect(help).toContain('Node require/fs are not available inside browser run');
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
      expect(update.command_options.map((option: any) => option.name)).toEqual(['all', 'force', 'format', 'json']);
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
    expect(search.description()).toBe('Search the plugin catalog for installable plugins. Not web search.');
    expect(search.registeredArguments[0]?.description).toContain('not a web search');
    expect(search.options.map(option => option.flags)).toContain('-f, --format <fmt>');
    expect(install.usage()).toBe('[options] <source>');
    expect(install.description()).toBe('Install a plugin from a git repository');
    expect(install.registeredArguments[0]?.description).toContain('github:user/repo/<plugin>');
    expect(install.options.map(option => option.long)).toContain('--all');
  });

  it('labels empty plugin search JSON as catalog discovery, not web search', async () => {
    const catalog = await import('./plugin-catalog.js');
    const search = vi.spyOn(catalog, 'searchCatalogPlugins').mockResolvedValue({ plugins: [], errors: [] });
    const read = vi.spyOn(catalog, 'readCatalog').mockReturnValue({ version: 1, sources: [] });
    const log = vi.mocked(console.log);
    const previousExitCode = process.exitCode;
    log.mockClear();
    try {
      await createProgram('', '').parseAsync(['node', 'webcmd', 'plugin', 'search', 'tls fingerprint', '-f', 'json']);

      const payload = JSON.parse(log.mock.calls.flat().join('\n'));
      expect(payload).toMatchObject({
        kind: 'plugin-catalog',
        query: 'tls fingerprint',
        total: 0,
        plugins: [],
        errors: [],
      });
      expect(payload.hint).toContain('not web pages');
      expect(payload.hint).toContain('webcmd web fetch --url "https://html.duckduckgo.com/html/?q=tls%20fingerprint"');
      expect(search).toHaveBeenCalled();
    } finally {
      process.exitCode = previousExitCode;
      search.mockRestore();
      read.mockRestore();
    }
  });

  it('prints catalog-not-web copy for an empty plugin search table', async () => {
    const catalog = await import('./plugin-catalog.js');
    const search = vi.spyOn(catalog, 'searchCatalogPlugins').mockResolvedValue({ plugins: [], errors: [] });
    const read = vi.spyOn(catalog, 'readCatalog').mockReturnValue({ version: 1, sources: [] });
    const log = vi.mocked(console.log);
    const previousExitCode = process.exitCode;
    log.mockClear();
    try {
      await createProgram('', '').parseAsync(['node', 'webcmd', 'plugin', 'search', 'ja3', '-f', 'table']);

      expect(log.mock.calls.flat().join('\n')).toContain('No marketplace plugins matched "ja3". This command searches the plugin catalog, not the web.');
      expect(log.mock.calls.flat().join('\n')).toContain('not web pages');
    } finally {
      process.exitCode = previousExitCode;
      search.mockRestore();
      read.mockRestore();
    }
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
      expect(reset.command_options.map((option: any) => option.name)).toEqual(['all', 'format', 'json']);
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
        command_count: 4,
      });
      expect(data.commands.map((cmd: any) => cmd.name)).toEqual(['create', 'list', 'rename', 'use']);
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

describe('local learning command registration', () => {
  it('registers site memory context, candidate, and checkpoint on the local program', () => {
    const program = createProgram('', '');
    for (const path of [
      ['site', 'memory', 'context'],
      ['site', 'memory', 'candidate', 'add'],
      ['site', 'memory', 'candidate', 'search'],
      ['site', 'memory', 'candidate', 'show'],
      ['site', 'memory', 'candidate', 'list'],
      ['site', 'memory', 'checkpoint'],
      ['site', 'memory', 'classify'],
    ]) {
      let command: ReturnType<typeof createProgram> | undefined = program;
      for (const segment of path) command = command?.commands.find(child => child.name() === segment) as typeof program | undefined;
      expect(command, path.join(' ')).toBeDefined();
    }
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
      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'verify', 'hn/top', '--no-fixture', '--trace', 'retain-on-failure']);

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
      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'verify', 'hn/top', '--no-fixture', '--seed-args', 'webcmd-verify']);

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
      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'verify', 'hn/top', '--write-fixture', '--seed-args', 'webcmd-verify']);

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
      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'verify', 'hn/top', '--no-fixture']);

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

  it('rejects a wide row by default but passes with a raised --max-top-level-keys', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-verify-wide-'));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    const wideRow = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`col${i}`, i]));
    mockExecFileSync.mockReturnValue(JSON.stringify([wideRow]));
    const consoleLogSpy = vi.mocked(console.log);
    consoleLogSpy.mockClear();

    try {
      const adapterDir = path.join(fakeHome, '.webcmd', 'clis', 'hn');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(path.join(adapterDir, 'top.js'), 'export default {};\n', 'utf-8');

      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', '--session', 'test', 'browser', 'verify', 'hn/top', '--no-fixture']);
      expect(process.exitCode).toBe(1);
      let output = consoleLogSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(output).toContain('row has 20 top-level keys, expected at most 12');

      process.exitCode = undefined;
      consoleLogSpy.mockClear();
      const program2 = createProgram('', '');
      await program2.parseAsync(['node', 'webcmd', '--session', 'test', 'browser', 'verify', 'hn/top', '--no-fixture', '--max-top-level-keys', '20']);
      expect(process.exitCode).toBeUndefined();
      output = consoleLogSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(output).not.toContain('violates row shape conventions');
    } finally {
      consoleLogSpy.mockClear();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('rejects a non-positive --max-top-level-keys', async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-verify-badflag-'));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;

    try {
      const adapterDir = path.join(fakeHome, '.webcmd', 'clis', 'hn');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(path.join(adapterDir, 'top.js'), 'export default {};\n', 'utf-8');

      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', '--session', 'test', 'browser', 'verify', 'hn/top', '--no-fixture', '--max-top-level-keys', '0']);

      expect(process.exitCode).toBe(2);
      expect(mockExecFileSync).not.toHaveBeenCalled();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  describe('structured output', () => {
    const consoleLogSpy = vi.mocked(console.log);

    /**
     * Runs `browser verify` against a throwaway adapter under a temp HOME and
     * returns whatever reached stdout. Every structured-output case needs the
     * same scaffolding; only the adapter rows and argv differ.
     */
    const runVerify = async (
      slug: string,
      adapterOutput: string,
      argv: string[],
      seedFixture?: unknown,
    ): Promise<string> => {
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), `webcmd-browser-verify-${slug}-`));
      process.env.HOME = fakeHome;
      process.env.USERPROFILE = fakeHome;
      mockExecFileSync.mockReturnValue(adapterOutput);
      consoleLogSpy.mockClear();

      try {
        const adapterDir = path.join(fakeHome, '.webcmd', 'clis', 'hn');
        fs.mkdirSync(adapterDir, { recursive: true });
        fs.writeFileSync(path.join(adapterDir, 'top.js'), 'export default {};\n', 'utf-8');

        if (seedFixture !== undefined) {
          const verifyDir = path.join(fakeHome, '.webcmd', 'sites', 'hn', 'verify');
          fs.mkdirSync(verifyDir, { recursive: true });
          fs.writeFileSync(path.join(verifyDir, 'top.json'), JSON.stringify(seedFixture), 'utf-8');
        }

        await createProgram('', '').parseAsync(['node', 'webcmd', '--session', 'test', 'browser', 'verify', 'hn/top', ...argv]);
        return consoleLogSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      } finally {
        consoleLogSpy.mockClear();
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(fakeHome, { recursive: true, force: true });
      }
    };

    it('reports a fixture-less pass as a structured report with no prose', async () => {
      const stdout = await runVerify('json-pass', JSON.stringify([{ title: 'ok' }]), ['--no-fixture', '-f', 'json']);

      expect(process.exitCode).toBeUndefined();
      const report = JSON.parse(stdout);
      expect(report).toMatchObject({
        ok: true,
        site: 'hn',
        command: 'top',
        rowCount: 1,
        fixture: { exists: false, action: 'none' },
      });
      expect(report.memory).toMatchObject({ ok: false });
      // The emoji progress report is the table rendering; it must not leak into JSON.
      expect(stdout).not.toContain('🔍');
      expect(stdout).not.toContain('Verifying');
    });

    it('reports row-shape violations as structured failures', async () => {
      const stdout = await runVerify(
        'json-shape',
        JSON.stringify([{ title: 'ok', author: { user_id: 'u1' } }]),
        ['--no-fixture', '-f', 'json'],
      );

      expect(process.exitCode).toBe(1);
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(false);
      expect(report.rowCount).toBe(1);
      expect(report.shapeFailures).toEqual(
        expect.arrayContaining([expect.objectContaining({ rule: 'shapeNestedId' })]),
      );
      expect(stdout).not.toContain('violates row shape conventions');
    });

    it('reports fixture mismatches as structured failures', async () => {
      const stdout = await runVerify(
        'json-mismatch',
        JSON.stringify([{ title: 'actual' }]),
        ['-f', 'json'],
        { expect: { columns: ['title'], rowCount: { min: 5 } } },
      );

      expect(process.exitCode).toBe(1);
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(false);
      expect(report.fixture).toMatchObject({ exists: true });
      expect(report.matchFailures).toEqual(
        expect.arrayContaining([expect.objectContaining({ rule: 'rowCount' })]),
      );
    });

    it('reports a missing adapter as a structured error', async () => {
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-verify-json-missing-'));
      process.env.HOME = fakeHome;
      process.env.USERPROFILE = fakeHome;
      consoleLogSpy.mockClear();

      try {
        await createProgram('', '').parseAsync(['node', 'webcmd', '--session', 'test', 'browser', 'verify', 'hn/top', '-f', 'json']);

        expect(process.exitCode).toBe(1);
        const report = JSON.parse(consoleLogSpy.mock.calls.map((args) => args.join(' ')).join('\n'));
        expect(report).toMatchObject({
          ok: false,
          site: 'hn',
          command: 'top',
          error: { code: 'ADAPTER_NOT_FOUND' },
        });
      } finally {
        consoleLogSpy.mockClear();
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(fakeHome, { recursive: true, force: true });
      }
    });

    it('rejects an unsupported format before running the adapter', async () => {
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-verify-json-badfmt-'));
      process.env.HOME = fakeHome;
      process.env.USERPROFILE = fakeHome;

      try {
        const adapterDir = path.join(fakeHome, '.webcmd', 'clis', 'hn');
        fs.mkdirSync(adapterDir, { recursive: true });
        fs.writeFileSync(path.join(adapterDir, 'top.js'), 'export default {};\n', 'utf-8');

        await createProgram('', '').parseAsync(['node', 'webcmd', '--session', 'test', 'browser', 'verify', 'hn/top', '--no-fixture', '-f', 'xml']);

        expect(process.exitCode).toBe(2);
        expect(mockExecFileSync).not.toHaveBeenCalled();
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(fakeHome, { recursive: true, force: true });
      }
    });
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

describe('structured output for data-returning built-ins', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    process.exitCode = undefined;
    consoleLogSpy.mockClear();
    vi.stubGlobal('fetch', vi.fn());
  });

  const stdout = () => consoleLogSpy.mock.calls.flat().join('\n');

  // Later describes in this file install their own console.error spy at
  // collection time, which would shadow a describe-level one here. Spy inside
  // the test and restore, matching the local Session format tests below.
  const captureStderr = async (run: () => Promise<void>): Promise<string> => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await run();
      return spy.mock.calls.flat().join('\n');
    } finally {
      spy.mockRestore();
    }
  };

  const daemonStatusResponse = (overrides: Record<string, unknown> = {}) => ({
    ok: true,
    json: async () => ({
      ok: true,
      pid: 123,
      uptime: 12,
      daemonVersion: PKG_VERSION,
      runtimeConnected: true,
      runtimeName: 'Cloak',
      runtimeVersion: '1.0.3',
      profiles: [],
      pending: 0,
      memoryMB: 20,
      port: 9777,
      ...overrides,
    }),
  } as Response);

  it('renders validate as JSON without the human report', async () => {
    await createProgram('', '').parseAsync(['node', 'webcmd', 'validate', '-f', 'json']);

    expect(JSON.parse(stdout())).toMatchObject({
      ok: expect.any(Boolean),
      errors: expect.any(Number),
      warnings: expect.any(Number),
      commands: expect.any(Number),
    });
  });

  it('rejects validate for an unknown target instead of passing zero commands', async () => {
    await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'validate', 'nope']))
      .rejects.toThrow(/No command matches "nope"/);
  });

  it('sets a non-zero exit code when validate finds command errors', async () => {
    const key = 'validate-fail-exit/broken';
    getRegistry().set(key, {
      site: 'validate-fail-exit', name: 'broken', access: 'read', description: 'broken', args: [],
    } as never);
    try {
      await createProgram('', '').parseAsync(['node', 'webcmd', 'validate', 'validate-fail-exit']);
      expect(process.exitCode).toBe(1);
      expect(stdout()).toContain('FAIL');
    } finally {
      getRegistry().delete(key);
    }
  });

  it('keeps the human validate report when no format is requested', async () => {
    await createProgram('', '').parseAsync(['node', 'webcmd', 'validate']);

    expect(() => JSON.parse(stdout())).toThrow();
  });

  it('renders verify as YAML and still sets the report exit code', async () => {
    await createProgram('', '').parseAsync(['node', 'webcmd', 'verify', '-f', 'yaml']);

    const parsed = yaml.load(stdout()) as { ok: boolean; validation: unknown };
    expect(parsed).toMatchObject({ ok: expect.any(Boolean) });
    expect(parsed.validation).toBeDefined();
    expect(process.exitCode).toBe(parsed.ok ? 0 : 1);
  });

  it('renders the same skill rows for bare skills and skills list', async () => {
    await createProgram('', '').parseAsync(['node', 'webcmd', 'skills', '-f', 'json']);
    const bare = JSON.parse(stdout());
    consoleLogSpy.mockClear();

    await createProgram('', '').parseAsync(['node', 'webcmd', 'skills', 'list', '-f', 'json']);
    expect(JSON.parse(stdout())).toEqual(bare);
  });

  it('renders daemon status as JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(daemonStatusResponse());

    await createProgram('', '').parseAsync(['node', 'webcmd', 'daemon', 'status', '-f', 'json']);

    expect(JSON.parse(stdout())).toMatchObject({
      running: true,
      stale: false,
      pid: 123,
      port: 9777,
      runtimeConnected: true,
      runtimeName: 'Cloak',
    });
  });

  it('reports a stopped daemon as structured data rather than prose', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    await createProgram('', '').parseAsync(['node', 'webcmd', 'daemon', 'status', '-f', 'json']);

    expect(JSON.parse(stdout())).toEqual({ running: false });
  });

  it('renders profile list rows and marks disconnected saved profiles', async () => {
    vi.mocked(fetch).mockResolvedValue(daemonStatusResponse({
      profiles: [{ contextId: 'ctx_live', runtimeConnected: true, runtimeVersion: '1.0.3', pending: 0 }],
    }));

    await createProgram('', '').parseAsync(['node', 'webcmd', 'profile', 'list', '-f', 'json']);

    expect(JSON.parse(stdout())).toEqual([
      { contextId: 'ctx_live', alias: '', default: false, connected: true, runtimeVersion: '1.0.3' },
    ]);
  });

  it('rejects profile use of an unknown name and enumerates valid profiles', async () => {
    vi.mocked(fetch).mockResolvedValue(daemonStatusResponse({
      profiles: [{ contextId: 'ctx_live', runtimeConnected: true, runtimeVersion: '1.0.3', pending: 0 }],
    }));

    await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'profile', 'use', '__audit_nope__']))
      .rejects.toThrow(/No profile matches "__audit_nope__". Valid profiles: ctx_live/);
  });

  it('sets the default from a connected profile', async () => {
    vi.mocked(fetch).mockResolvedValue(daemonStatusResponse({
      profiles: [{ contextId: 'ctx_live', runtimeConnected: true, runtimeVersion: '1.0.3', pending: 0 }],
    }));

    await createProgram('', '').parseAsync(['node', 'webcmd', 'profile', 'use', 'ctx_live']);

    expect(stdout()).toContain('Default Cloak profile: ctx_live');
  });

  it('sets the default from a saved alias when the daemon is down', async () => {
    fs.mkdirSync(process.env.WEBCMD_CONFIG_DIR!, { recursive: true });
    fs.writeFileSync(path.join(process.env.WEBCMD_CONFIG_DIR!, 'browser-profiles.json'), JSON.stringify({
      version: 1,
      aliases: { work: 'ctx_work' },
    }));
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    await createProgram('', '').parseAsync(['node', 'webcmd', 'profile', 'use', 'work']);

    expect(stdout()).toContain('Default Cloak profile: ctx_work');
  });

  it('fails structured profile list with DAEMON_UNAVAILABLE instead of an empty array', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const stderr = await captureStderr(async () => {
      await createProgram('', '').parseAsync(['node', 'webcmd', 'profile', 'list', '-f', 'json']);
    });

    expect(process.exitCode).toBe(1);
    expect(stdout()).toBe('');
    expect(stderr).toContain('Daemon is not running; profile list is incomplete.');
    expect(stderr).toContain('Run webcmd doctor after opening Chrome.');
  });

  it.each([
    ['validate'],
    ['verify'],
    ['skills'],
    ['doctor'],
    ['daemon', 'status'],
    ['profile', 'list'],
  ])('rejects an unsupported format for %s', async (...command) => {
    const stderr = await captureStderr(async () => {
      await createProgram('', '').parseAsync(['node', 'webcmd', ...command, '-f', 'xml']);
    });

    expect(process.exitCode).toBe(2);
    expect(stderr).toContain('Unknown output format "xml"');
    expect(stdout()).toBe('');
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
    mockReleaseSiteSessionLease.mockReset().mockResolvedValue(undefined);
    mockSendCommand.mockReset().mockResolvedValue({ ok: true });
  });

  it.each([
    { argv: ['browser', 'tabs'], code: 'SESSION_REQUIRED' },
    { argv: ['--session', 'work', 'browser', 'tabs'], code: 'INVALID_SESSION_SELECTOR' },
  ])('rejects an unusable raw selector with exit 2 before daemon dispatch: $code', async ({ argv, code }) => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', ...argv]);

    expect(process.exitCode).toBe(2);
    expect(mockListExistingBrowserTabs).not.toHaveBeenCalled();
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.flat().join('')).toContain(code);
  });

  it('lists tabs without allocating a local browser runtime', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'tabs']);

    expect(mockBrowserConnect).not.toHaveBeenCalled();
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(mockListExistingBrowserTabs).toHaveBeenCalledWith('work-k7', {});
    expect(consoleLogSpy).toHaveBeenLastCalledWith('[]');
  });

  it('sends tabs directly when a runtime already exists', async () => {
    mockListExistingBrowserTabs.mockResolvedValue([{ page: 'page-123' }]);
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'tabs']);

    expect(mockBrowserConnect).not.toHaveBeenCalled();
    expect(mockListExistingBrowserTabs).toHaveBeenCalledWith('work-k7', {});
  });

  it('binds only an explicit stable page id', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'bind', '--page', 'page-123']);

    expect(mockSendCommand).toHaveBeenCalledWith('bind', {
      session: 'work-k7', surface: 'browser', page: 'page-123',
    });
    await expect(program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'bind', '--index', '0']))
      .rejects.toThrow(/process\.exit unexpectedly called/);
    await expect(program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'bind', '--page', '   ']))
      .rejects.toThrow(/process\.exit unexpectedly called/);
  });

  it('sends snapshot inspection options to the browser runtime', async () => {
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'snapshot', '--snapshot-mode', 'read', '--ref', 'e12', '--max-output', '1000']);

    expect(mockSendCommand).toHaveBeenCalledWith('snapshot', {
      session: 'work-k7', surface: 'browser', snapshotMode: 'read', ref: 'e12', maxOutputChars: 1000,
    });
  });

  // The CDP client already gates diagnostics on isVerbose(), but the raw browser
  // leaves rejected -v, so those diagnostics were unreachable from the CLI (#174).
  describe('raw browser verbose flag', () => {
    afterEach(() => {
      delete process.env.WEBCMD_VERBOSE;
    });

    it.each(['tabs', 'snapshot', 'close'])('accepts -v on browser %s', async (leaf) => {
      delete process.env.WEBCMD_VERBOSE;
      const program = createProgram('', '');

      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', leaf, '-v']);

      expect(process.exitCode).toBeUndefined();
      expect(process.env.WEBCMD_VERBOSE).toBe('1');
    });

    it('accepts -v on browser bind', async () => {
      delete process.env.WEBCMD_VERBOSE;
      const program = createProgram('', '');

      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'bind', '--page', 'page-123', '-v']);

      expect(process.env.WEBCMD_VERBOSE).toBe('1');
      expect(mockSendCommand).toHaveBeenCalledWith('bind', {
        session: 'work-k7', surface: 'browser', page: 'page-123',
      });
    });

    it('leaves verbose mode off when the flag is absent', async () => {
      delete process.env.WEBCMD_VERBOSE;
      const program = createProgram('', '');

      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'tabs']);

      expect(process.env.WEBCMD_VERBOSE).toBeUndefined();
    });

    // Structural check so `run` is covered too: it needs a program source, so it
    // cannot reach the action body from argv alone.
    //
    // Filesystem-only leaves stay without the flag: there are no diagnostics
    // behind it, and advertising one would be the no-op #174 set out to remove.
    it('declares the flag on bridge leaves and withholds it from filesystem-only ones', () => {
      const program = createProgram('', '');
      const browser = program.commands.find(command => command.name() === 'browser');
      const flagsFor = (name: string) => browser?.commands
        .find(command => command.name() === name)
        ?.options.map(option => option.long) ?? [];

      for (const leaf of ['tabs', 'bind', 'run', 'snapshot', 'close']) {
        expect(flagsFor(leaf)).toContain('--verbose');
      }
      for (const leaf of ['init', 'fork']) {
        expect(flagsFor(leaf)).not.toContain('--verbose');
      }
    });
  });

  it('binds raw browser daemon operations to one logical run', async () => {
    let run = getDaemonRunContext();
    mockSendCommand.mockImplementation(async () => {
      run = getDaemonRunContext();
      return { ok: true };
    });
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'snapshot']);

    expect(run).toMatchObject({
      runId: expect.stringMatching(/^run_/),
      command: 'browser/snapshot',
    });
    expect(getDaemonRunContext()).toBeUndefined();
  });

  it('keeps the raw browser lease when the daemon outcome is unknown', async () => {
    mockSendCommand.mockRejectedValue(new BrowserCommandError('Result unknown', 'command_result_unknown'));
    const program = createProgram('', '');

    await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'snapshot']);

    expect(process.exitCode).toBe(1);
    expect(mockReleaseSiteSessionLease).not.toHaveBeenCalled();
  });

  it('reads program files for run and rejects mutually exclusive input', async () => {
    const sourcePath = path.join(os.tmpdir(), `webcmd-run-${Date.now()}.js`);
    fs.writeFileSync(sourcePath, 'return 42;', 'utf8');
    try {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'run', '--file', sourcePath]);
      expect(mockSendCommand).toHaveBeenCalledWith('run', {
        session: 'work-k7', surface: 'browser', source: 'return 42;', snapshotMode: 'act',
      });

      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'run', '--stdin', '--file', sourcePath]);
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBeDefined();

      process.exitCode = undefined;
      fs.writeFileSync(sourcePath, '', 'utf8');
      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'run', '--file', sourcePath]);
      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBeDefined();
    } finally {
      fs.rmSync(sourcePath, { force: true });
    }
  });

  it('accepts --json on browser run without changing the JSON daemon request', async () => {
    const sourcePath = path.join(os.tmpdir(), `webcmd-run-${Date.now()}.js`);
    fs.writeFileSync(sourcePath, 'return 42;', 'utf8');
    try {
      const program = createProgram('', '');
      await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'run', '--file', sourcePath, '--json']);

      expect(mockSendCommand).toHaveBeenCalledWith('run', {
        session: 'work-k7', surface: 'browser', source: 'return 42;', snapshotMode: 'act',
      });
    } finally {
      fs.rmSync(sourcePath, { force: true });
    }
  });

  it('closes the named session through the daemon', async () => {
    const program = createProgram('', '');
    await program.parseAsync(['node', 'webcmd', '--session', 'work-k7', 'browser', 'close']);
    expect(mockSendCommand).toHaveBeenCalledWith('close-window', { session: 'work-k7', surface: 'browser' });
  });
});

describe('browser Session lifecycle commands', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    process.exitCode = undefined;
    consoleLogSpy.mockClear();
    mockSendCommand.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('daemon offline')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires a readable name when creating a Session', async () => {
    await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'create']))
      .rejects.toThrow('process.exit unexpectedly called with "1"');
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it('sends the raw readable name to the durable selected Profile', async () => {
    mockSendCommand.mockResolvedValue({
      id: 'work-project-k7',
      kind: 'explicit',
      profileId: 'work',
      runtimeState: 'idle',
    });

    await createProgram('', '').parseAsync(['node', 'webcmd', 'profile', 'create', 'work']);
    consoleLogSpy.mockClear();
    await createProgram('', '').parseAsync(['node', 'webcmd', '--profile', 'work', 'session', 'create', 'Work Project']);

    expect(mockSendCommand).toHaveBeenCalledWith('session-create', {
      contextId: 'work',
      sessionName: 'Work Project',
    });
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('work-project-k7');
  });

  it('keeps the same readable Session ID valid in two Profiles', async () => {
    const baseDir = path.join(isolatedCliTestHome, '.webcmd');
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), JSON.stringify({
      version: 2,
      sessions: ['default', 'work'].map((profileId) => ({
        id: 'work-project-k7',
        profileId,
        kind: 'explicit',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        lastUsedAt: '2026-08-11T00:00:00.000Z',
      })),
    }), { mode: 0o600 });
    await createProgram('', '').parseAsync(['node', 'webcmd', 'profile', 'create', 'work']);
    consoleLogSpy.mockClear();

    await createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'list', '-f', 'json']);
    expect(JSON.parse(consoleLogSpy.mock.calls.flat().join('\n'))).toEqual([
      expect.objectContaining({ id: 'work-project-k7', profileId: 'default' }),
    ]);

    consoleLogSpy.mockClear();
    await createProgram('', '').parseAsync(['node', 'webcmd', '--profile', 'work', 'session', 'list', '-f', 'json']);
    expect(JSON.parse(consoleLogSpy.mock.calls.flat().join('\n'))).toEqual([
      expect.objectContaining({ id: 'work-project-k7', profileId: 'work' }),
    ]);
  });

  it('reports a missing selected-Profile Session without cross-Profile owner guidance', async () => {
    const baseDir = path.join(isolatedCliTestHome, '.webcmd');
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), JSON.stringify({
      version: 2,
      sessions: [{
        id: 'work-project-k7',
        profileId: 'work',
        kind: 'explicit',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        lastUsedAt: '2026-08-11T00:00:00.000Z',
      }],
    }), { mode: 0o600 });
    mockSendCommand.mockRejectedValueOnce(new Error('daemon unavailable'));

    await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'close', 'work-project-k7']))
      .rejects.toMatchObject({
        code: 'SESSION_NOT_FOUND',
        hint: expect.stringContaining('webcmd --profile default session list'),
      });
  });

  it.each(['session_uuid', 'work-abcdef'])('rejects legacy raw browser selectors: %s', async (selector) => {
    await createProgram('', '').parseAsync(['node', 'webcmd', '--session', selector, 'browser', 'tabs', '-f', 'json']);

    expect(mockListExistingBrowserTabs).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT_CODES.USAGE_ERROR);
  });

  it('creates a Session through the daemon mutation path', async () => {
    mockSendCommand.mockResolvedValue({
      id: 'work-project-k7',
      kind: 'explicit',
      profileId: 'default',
      runtimeState: 'idle',
    });

    await createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'create', 'Work Project']);

    expect(mockSendCommand).toHaveBeenCalledWith('session-create', { contextId: 'default', sessionName: 'Work Project' });
    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('work-project-k7');
    expect(output).toContain('runtimeState');
    expect(output).not.toContain('profileId');
  });

  it('creates a session under a newly created profile', async () => {
    mockSendCommand.mockResolvedValue({
      id: 'eval-k7',
      kind: 'explicit',
      profileId: 'eval-a',
      runtimeState: 'idle',
    });
    await createProgram('', '').parseAsync(['node', 'webcmd', 'profile', 'create', 'eval-a']);
    await createProgram('', '').parseAsync(['node', 'webcmd', '--profile', 'eval-a', 'session', 'create', 'Eval']);
    expect(mockSendCommand).toHaveBeenCalledWith('session-create', { contextId: 'eval-a', sessionName: 'Eval' });
  });

  it('rejects an unknown --profile on session create with PROFILE_NOT_FOUND', async () => {
    await expect(createProgram('', '').parseAsync(['node', 'webcmd', '--profile', 'does-not-exist', 'session', 'create', 'Work']))
      .rejects.toMatchObject({
        code: 'PROFILE_NOT_FOUND',
        message: expect.stringContaining('does-not-exist'),
        hint: expect.stringMatching(/profile create[\s\S]*profile list/),
      });
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it('lists persisted Sessions without creating the adapter default when daemon is absent', async () => {
    const baseDir = path.join(isolatedCliTestHome, '.webcmd');
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), JSON.stringify({
      version: 2,
      sessions: [{
        id: 'existing-k7',
        profileId: 'default',
        kind: 'explicit',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        lastUsedAt: '2026-08-11T00:00:00.000Z',
      }],
    }), { mode: 0o600 });

    await createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'list', '-f', 'json']);

    expect(mockSendCommand).not.toHaveBeenCalled();
    const rows = JSON.parse(consoleLogSpy.mock.calls.flat().join('\n'));
    expect(rows).toEqual([expect.objectContaining({ id: 'existing-k7', runtimeState: 'idle' })]);
  });

  it('closes an idle persisted Session as a no-op when daemon is absent', async () => {
    mockSendCommand.mockRejectedValueOnce(new Error('daemon unavailable'));
    const baseDir = path.join(isolatedCliTestHome, '.webcmd');
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), JSON.stringify({
      version: 2,
      sessions: [{
        id: 'work-project-k7',
        profileId: 'default',
        kind: 'explicit',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        lastUsedAt: '2026-08-11T00:00:00.000Z',
      }],
    }), { mode: 0o600 });

    await createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'close', 'work-project-k7', '-f', 'json']);

    expect(mockSendCommand).toHaveBeenCalledWith('session-close', {
      contextId: 'default',
      session: 'work-project-k7',
      force: false,
    });
    expect(JSON.parse(consoleLogSpy.mock.calls.flat().join('\n'))).toMatchObject({
      closed: false,
      alreadyIdle: true,
      session: 'work-project-k7',
    });
  });

  it('keeps missing Session guidance scoped to the selected Profile', async () => {
    mockSendCommand.mockRejectedValueOnce(new Error('daemon unavailable'));
    const baseDir = path.join(isolatedCliTestHome, '.webcmd');
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), JSON.stringify({
      version: 2,
      sessions: [{
        id: 'work-project-k7',
        profileId: 'work',
        kind: 'explicit',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        lastUsedAt: '2026-08-11T00:00:00.000Z',
      }],
    }), { mode: 0o600 });

    await expect(
      createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'close', 'work-project-k7', '-f', 'json']),
    ).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
      hint: expect.stringContaining('webcmd --profile default session list'),
    });
  });

  it('reports a missing Session instead of claiming close cleanup completed', async () => {
    mockSendCommand.mockRejectedValueOnce(new Error('daemon unavailable'));

    await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'close', 'missing-k7', '-f', 'json']))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('accepts a readable Session ID from the root --session selector', async () => {
    mockSendCommand.mockRejectedValueOnce(new Error('daemon unavailable'));

    await expect(createProgram('', '').parseAsync(['node', 'webcmd', '--session', 'missing-k7', 'session', 'close', '-f', 'json']))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('rejects a malformed Session selector as a usage error', async () => {
    await expect(createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'close', 'badid']))
      .rejects.toMatchObject({ code: 'INVALID_SESSION_SELECTOR', exitCode: 2 });
  });

  it.each([
    ['create', 'Work'],
    ['list'],
    ['close', 'work-project-k7'],
  ])('rejects an unsupported format before local Session %s side effects', async (...subcommand) => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await createProgram('', '').parseAsync(['node', 'webcmd', 'session', ...subcommand, '-f', 'xml']);

      expect(process.exitCode).toBe(2);
      expect(consoleErrorSpy.mock.calls.flat().join('\n')).toContain('Unknown output format "xml"');
      expect(mockSendCommand).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('normalizes aliases and case across local Session create/list/close', async () => {
    mockSendCommand.mockImplementation(async (command) => command === 'session-create'
      ? { id: 'work-project-k7', kind: 'explicit', runtimeState: 'idle' }
      : { closed: true, session: 'work-project-k7' });

    await createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'create', 'Work Project', '-f', 'JSON']);
    expect(JSON.parse(consoleLogSpy.mock.calls.flat().join('\n'))).toMatchObject({ id: 'work-project-k7' });

    consoleLogSpy.mockClear();
    await createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'list', '-f', 'YML']);
    expect(yaml.load(consoleLogSpy.mock.calls.flat().join('\n'))).toEqual([]);

    consoleLogSpy.mockClear();
    await createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'close', 'work-project-k7', '-f', 'Markdown']);
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('| closed | session |');
  });

  it.each(['JSON', 'YML'])('keeps an empty local Session list machine-readable with explicit %s', async (format) => {
    await createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'list', '-f', format]);

    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(format === 'JSON' ? JSON.parse(output) : yaml.load(output)).toEqual([]);
  });

  it('keeps an explicit empty local Session table outside a TTY', async () => {
    await createProgram('', '').parseAsync(['node', 'webcmd', 'session', 'list', '-f', 'table']);

    const output = consoleLogSpy.mock.calls.flat().join('\n');
    expect(output).toContain('(no data)');
    expect(output).not.toContain('No browser Sessions found');
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
      session: 'work-k7',
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

describe('builtin output formats', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  async function run(...args: string[]) {
    await createProgram('', '').parseAsync(['node', 'webcmd', ...args]);
    return {
      stdout: stdoutSpy.mock.calls.flat().join('\n'),
      stderr: stderrSpy.mock.calls.flat().join('\n'),
      exitCode: process.exitCode,
    };
  }

  it.each(['xml', 'jsonl'])('rejects unsupported builtin format %s with usage exit 2', async (format) => {
    const result = await run('skills', 'list', '-f', format);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(`Unknown output format "${format}"`);
  });

  it('keeps explicit table output as a table outside a TTY', async () => {
    const result = await run('skills', 'list', '-f', 'table');
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain('webcmd/skills/list');
  });

  it('normalizes aliases and case for root list', async () => {
    const yamlResult = await run('list', '-f', 'yaml');
    stdoutSpy.mockClear();
    const aliasResult = await run('list', '-f', 'YML');
    expect(aliasResult.exitCode).toBeUndefined();
    expect(aliasResult.stdout).toBe(yamlResult.stdout);
  });

  it('sets a nonzero exit code when external install reports failure', async () => {
    const result = await run('external', 'install', 'ntn', '-f', 'json');

    expect(result.exitCode).toBe(EXIT_CODES.SERVICE_UNAVAIL);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, action: 'install', cli: 'ntn' });
  });

  it('renders an empty plugin list as structured data', async () => {
    const list = vi.spyOn(pluginModule, 'listPlugins').mockReturnValue([] as never);
    try {
      const result = await run('plugin', 'list', '-f', 'yaml');
      expect(result.exitCode).toBeUndefined();
      expect(yaml.load(result.stdout)).toEqual([]);
    } finally {
      list.mockRestore();
    }
  });
});
