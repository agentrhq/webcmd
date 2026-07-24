import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverClis, discoverPlugins, ensureUserCliCompatShims, ensureUserAdapters, PLUGINS_DIR } from './discovery.js';
import { executeCommand } from './execution.js';
import { getRegistry, cli, Strategy } from './registry.js';
import { clearAllHooks, onAfterExecute } from './hooks.js';
import * as runtime from './runtime.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('discoverClis', () => {
  it('handles non-existent directories gracefully', async () => {
    // Should not throw for missing directories
    await expect(discoverClis(path.join(os.tmpdir(), 'nonexistent-webcmd-test-dir'))).resolves.not.toThrow();
  });

  it('imports only CLI command modules during filesystem discovery', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcmd-discovery-'));
    const siteDir = path.join(tempRoot, 'temp-site');
    const helperPath = path.join(siteDir, 'helper.js');
    const commandPath = path.join(siteDir, 'hello.js');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(helperPath, `
globalThis.__webcmd_helper_loaded__ = true;
export const helper = true;
`);
      await fs.promises.writeFile(commandPath, `
import { cli, Strategy } from '${pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href}';
cli({
  site: 'temp-site',
  name: 'hello', access: 'read',
  description: 'hello command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true }],
});
`);

      delete (globalThis as { __webcmd_helper_loaded__?: unknown }).__webcmd_helper_loaded__;
      await discoverClis(tempRoot);

      expect((globalThis as { __webcmd_helper_loaded__?: unknown }).__webcmd_helper_loaded__).toBeUndefined();
      expect(getRegistry().get('temp-site/hello')).toBeDefined();
    } finally {
      delete (globalThis as { __webcmd_helper_loaded__?: unknown }).__webcmd_helper_loaded__;
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('falls back to filesystem discovery when the manifest is invalid', async () => {
    const tempBuildRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcmd-manifest-fallback-'));
    const distDir = path.join(tempBuildRoot, 'dist');
    const siteDir = path.join(distDir, 'fallback-site');
    const commandPath = path.join(siteDir, 'hello.js');
    const manifestPath = path.join(tempBuildRoot, 'cli-manifest.json');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(manifestPath, '{ invalid json');
      await fs.promises.writeFile(commandPath, `
import { cli, Strategy } from '${pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href}';
cli({
  site: 'fallback-site',
  name: 'hello', access: 'read',
  description: 'hello command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true }],
});
`);

      await discoverClis(distDir);

      expect(getRegistry().get('fallback-site/hello')).toBeDefined();
    } finally {
      await fs.promises.rm(tempBuildRoot, { recursive: true, force: true });
    }
  });

  it('preserves freshPage from manifest before lazy command import', async () => {
    const site = `manifest-fresh-${Date.now()}`;
    const tempBuildRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcmd-manifest-fresh-'));
    const distDir = path.join(tempBuildRoot, 'dist');
    const siteDir = path.join(distDir, site);
    const commandPath = path.join(siteDir, 'checkout.js');
    const manifestPath = path.join(tempBuildRoot, 'cli-manifest.json');
    const sessionOpts: Array<{ freshPage?: boolean; siteSession?: string; session?: string }> = [];
    const mockPage = { closeWindow: vi.fn().mockResolvedValue(undefined) } as any;

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(manifestPath, `${JSON.stringify([
        {
          site,
          name: 'checkout',
          description: 'fresh checkout',
          access: 'write',
          strategy: 'public',
          browser: true,
          args: [],
          type: 'js',
          modulePath: `${site}/checkout.js`,
          sourceFile: `${site}/checkout.js`,
          siteSession: 'persistent',
          freshPage: true,
        },
      ], null, 2)}\n`);
      await fs.promises.writeFile(commandPath, `
import { cli, Strategy } from '${pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href}';
cli({
  site: '${site}',
  name: 'checkout', access: 'write',
  description: 'fresh checkout',
  browser: true,
  strategy: Strategy.PUBLIC,
  siteSession: 'persistent',
  freshPage: true,
  func: async () => [{ ok: true }],
});
`);

      await discoverClis(distDir);
      const cmd = getRegistry().get(`${site}/checkout`);
      expect(cmd?.freshPage).toBe(true);

      vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
        sessionOpts.push(opts ?? {});
        return fn(mockPage);
      });

      await expect(executeCommand(cmd!, {})).resolves.toEqual([{ ok: true }]);

      expect(sessionOpts).toHaveLength(1);
      expect(sessionOpts[0]).toMatchObject({
        session: `site:${site}`,
        siteSession: 'persistent',
        freshPage: true,
      });
    } finally {
      vi.restoreAllMocks();
      getRegistry().delete(`${site}/checkout`);
      await fs.promises.rm(tempBuildRoot, { recursive: true, force: true });
    }
  });

  it('loads user CLI modules via package exports symlink', async () => {
    const tempWebcmdRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcmd-user-clis-'));
    const userClisDir = path.join(tempWebcmdRoot, 'clis');
    const siteDir = path.join(userClisDir, 'legacy-site');
    const commandPath = path.join(siteDir, 'hello.js');

    try {
      await ensureUserCliCompatShims(tempWebcmdRoot);
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(commandPath, `
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { htmlToMarkdown } from '@agentrhq/webcmd/utils';

cli({
  site: 'legacy-site',
  name: 'hello', access: 'read',
  description: 'hello command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true, errorName: new CommandExecutionError('boom').name, markdown: htmlToMarkdown('<p>hello</p>') }],
});
`);

      await discoverClis(userClisDir);

      const cmd = getRegistry().get('legacy-site/hello');
      expect(cmd).toBeDefined();
      await expect(executeCommand(cmd!, {})).resolves.toEqual([{ ok: true, errorName: 'CommandExecutionError', markdown: 'hello' }]);
    } finally {
      await fs.promises.rm(tempWebcmdRoot, { recursive: true, force: true });
    }
  });
});

describe('ensureUserAdapters', () => {
  it('creates user clis directory without triggering full copy', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcmd-ensure-'));
    const clisDir = path.join(tempDir, 'clis');
    try {
      // Patch USER_CLIS_DIR is not easy, so we test the function behavior indirectly:
      // ensureUserAdapters should not throw and should be very fast (no fetch script)
      const start = Date.now();
      await ensureUserAdapters();
      const elapsed = Date.now() - start;
      // Should complete quickly (< 1s) since it only creates a directory
      expect(elapsed).toBeLessThan(1000);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('discoverClis handles empty user directory gracefully', async () => {
    const emptyDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webcmd-empty-'));
    try {
      // Should not throw for an empty directory (no adapters to discover)
      await expect(discoverClis(emptyDir)).resolves.not.toThrow();
    } finally {
      await fs.promises.rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('discoverPlugins', () => {
  const testPluginDir = path.join(PLUGINS_DIR, '__test-plugin__');
  const yamlPath = path.join(testPluginDir, 'greeting.yaml');
  const brokenPluginPath = path.join(testPluginDir, 'broken.js');
  const symlinkTargetDir = path.join(os.tmpdir(), '__test-plugin-symlink-target__');
  const symlinkPluginDir = path.join(PLUGINS_DIR, '__test-plugin-symlink__');
  const brokenSymlinkDir = path.join(PLUGINS_DIR, '__test-plugin-broken__');
  const dirSymlinkType: fs.symlink.Type = process.platform === 'win32' ? 'junction' : 'dir';

  afterEach(async () => {
    try { await fs.promises.rm(testPluginDir, { recursive: true }); } catch {}
    try { await fs.promises.rm(symlinkPluginDir, { recursive: true, force: true }); } catch {}
    try { await fs.promises.rm(symlinkTargetDir, { recursive: true, force: true }); } catch {}
    try { await fs.promises.rm(brokenSymlinkDir, { recursive: true, force: true }); } catch {}
  });

  it('ignores YAML files in plugin directories (YAML format removed)', async () => {
    await fs.promises.mkdir(testPluginDir, { recursive: true });
    await fs.promises.writeFile(yamlPath, `
site: __test-plugin__
name: greeting
description: Test plugin greeting
strategy: public
browser: false
`);

    await discoverPlugins();

    const registry = getRegistry();
    const cmd = registry.get('__test-plugin__/greeting');
    expect(cmd).toBeUndefined();
  });

  it('handles non-existent plugins directory gracefully', async () => {
    // discoverPlugins should not throw if ~/.webcmd/plugins/ does not exist
    await expect(discoverPlugins()).resolves.not.toThrow();
  });

  it('keeps broken plugin diagnostics quiet unless verbose logging is enabled', async () => {
    await fs.promises.mkdir(testPluginDir, { recursive: true });
    await fs.promises.writeFile(brokenPluginPath, `
throw new Error('broken plugin fixture');
// cli(
`);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      delete process.env.WEBCMD_VERBOSE;
      await discoverPlugins();
      expect(stderrSpy.mock.calls.flat().join('')).not.toContain('broken plugin fixture');

      stderrSpy.mockClear();
      process.env.WEBCMD_VERBOSE = '1';
      await discoverPlugins();
      expect(stderrSpy.mock.calls.flat().join('')).toContain(
        '[verbose] Plugin __test-plugin__/broken.js: broken plugin fixture',
      );
    } finally {
      delete process.env.WEBCMD_VERBOSE;
      stderrSpy.mockRestore();
    }
  });

  it('continues registering commands from valid installed plugins', async () => {
    const commandName = `working-${Date.now()}`;
    const commandPath = path.join(testPluginDir, 'working.js');
    await fs.promises.mkdir(testPluginDir, { recursive: true });
    await fs.promises.writeFile(commandPath, `
import { cli, Strategy } from '${pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href}';
cli({
  site: '__test-plugin__',
  name: '${commandName}', access: 'read',
  description: 'working plugin command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true }],
});
`);

    await discoverPlugins();

    expect(getRegistry().get(`__test-plugin__/${commandName}`)).toBeDefined();
  });

  it('ignores YAML files in symlinked plugin directories (YAML format removed)', async () => {
    await fs.promises.mkdir(PLUGINS_DIR, { recursive: true });
    await fs.promises.mkdir(symlinkTargetDir, { recursive: true });
    await fs.promises.writeFile(path.join(symlinkTargetDir, 'hello.yaml'), `
site: __test-plugin-symlink__
name: hello
description: Test plugin greeting via symlink
strategy: public
browser: false
`);
    await fs.promises.symlink(symlinkTargetDir, symlinkPluginDir, dirSymlinkType);

    await discoverPlugins();

    const cmd = getRegistry().get('__test-plugin-symlink__/hello');
    expect(cmd).toBeUndefined();
  });

  it('skips broken plugin symlinks without throwing', async () => {
    await fs.promises.mkdir(PLUGINS_DIR, { recursive: true });
    await fs.promises.symlink(path.join(os.tmpdir(), '__missing-plugin-target__'), brokenSymlinkDir, dirSymlinkType);

    await expect(discoverPlugins()).resolves.not.toThrow();
    expect(getRegistry().get('__test-plugin-broken__/hello')).toBeUndefined();
  });
});

describe('executeCommand', () => {
  beforeEach(() => {
    clearAllHooks();
    vi.unstubAllEnvs();
  });

  it('accepts kebab-case option names after Commander camelCases them', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'kebab-arg-test', access: 'read',
      description: 'test command with kebab-case arg',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'note-id', required: true, help: 'Note ID' },
      ],
      func: async (kwargs) => [{ noteId: kwargs['note-id'] }],
    });

    const result = await executeCommand(cmd, { 'note-id': 'abc123' });
    expect(result).toEqual([{ noteId: 'abc123' }]);
  });

  it('executes a command with func', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'func-test', access: 'read',
      description: 'test command with func',
      browser: false,
      strategy: Strategy.PUBLIC,
      func: async (kwargs) => {
        return [{ title: kwargs.query ?? 'default' }];
      },
    });

    const result = await executeCommand(cmd, { query: 'hello' });
    expect(result).toEqual([{ title: 'hello' }]);
  });

  it('executes a command with pipeline', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'pipe-test', access: 'read',
      description: 'test command with pipeline',
      browser: false,
      strategy: Strategy.PUBLIC,
      pipeline: [
        { evaluate: '() => [{ n: 1 }, { n: 2 }, { n: 3 }]' },
        { limit: '2' },
      ],
    });

    // Pipeline commands require page for evaluate step, so we'll test the error path
    await expect(executeCommand(cmd, {})).rejects.toThrow();
  });

  it('throws for command with no func or pipeline', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'empty-test', access: 'read',
      description: 'empty command',
      browser: false,
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow('has no func or pipeline');
  });

  it('passes debug flag to func', async () => {
    let receivedDebug = false;
    const cmd = cli({
      site: 'test-engine',
      name: 'debug-test', access: 'read',
      description: 'debug test',
      browser: false,
      func: async (_kwargs, debug) => {
        receivedDebug = debug ?? false;
        return [];
      },
    });

    await executeCommand(cmd, {}, true);
    expect(receivedDebug).toBe(true);
  });

  it('fires onAfterExecute even when command execution throws', async () => {
    const seen: Array<{ error?: unknown; finishedAt?: number }> = [];
    onAfterExecute((ctx) => {
      seen.push({ error: ctx.error, finishedAt: ctx.finishedAt });
    });

    const cmd = cli({
      site: 'test-engine',
      name: 'failing-test', access: 'read',
      description: 'failing command',
      browser: false,
      strategy: Strategy.PUBLIC,
      func: async () => {
        throw new Error('boom');
      },
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow('boom');
    expect(seen).toHaveLength(1);
    expect(seen[0].error).toBeInstanceOf(Error);
    expect((seen[0].error as Error).message).toBe('boom');
    expect(typeof seen[0].finishedAt).toBe('number');
  });

  it('uses launcher for registered Electron apps (chatwise)', async () => {
    // Mock the launcher to return a fake endpoint (avoids real HTTP/process calls)
    const launcher = await import('./launcher.js');
    const spy = vi.spyOn(launcher, 'resolveElectronEndpoint')
      .mockResolvedValue('http://127.0.0.1:9228');

    const cmd = cli({
      site: 'chatwise',
      name: 'status', access: 'read',
      description: 'chatwise status',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    // CDPBridge.connect() will fail (no actual CDP server), but the launcher
    // should have been called with 'chatwise'.
    await expect(executeCommand(cmd, {})).rejects.toThrow();
    expect(spy).toHaveBeenCalledWith('chatwise');
    spy.mockRestore();
  });
});
