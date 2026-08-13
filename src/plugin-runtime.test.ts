import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from './errors.js';
import { getRegistry } from './registry-api.js';
import {
  clampInt,
  emptySearchResults,
  makeDumpCommand,
  makeNewCommand,
  makeScreenshotCommand,
  makeStatusCommand,
  registerSiteAuthCommands,
  requireBoundedInteger,
  requireNonEmptyQuery,
  requireNonNegativeInteger,
  requireRows,
  requireSearchQuery,
  runBrowserStep,
  toHttpsUrl,
  unwrapBrowserResult,
} from './plugin-runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function runBrowserCommand(command: { func?: unknown }, page: unknown, kwargs: Record<string, unknown> = {}) {
  return (command.func as (page: unknown, kwargs: Record<string, unknown>) => Promise<unknown>)(page, kwargs);
}

describe('core CLI manifest v0.5.3', () => {
  it('freezes the bundled command surface before plugin migration', () => {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'test/fixtures/core-cli-manifest-v0.5.3.json'),
      'utf8',
    )) as Array<{ site: string; name: string }>;
    const keys = manifest.map(({ site, name }) => `${site}/${name}`);

    expect(manifest).toHaveLength(780);
    expect(new Set(manifest.map(({ site }) => site)).size).toBe(108);
    expect(new Set(keys).size).toBe(780);
    expect(keys.filter((key) => key.startsWith('linkedin/'))).toEqual([]);
  });
});

describe('plugin runtime search helpers', () => {
  it('normalizes and validates command arguments', () => {
    expect(clampInt('4.9', 1, 2, 4)).toBe(4);
    expect(clampInt('nope', 1, 2, 4)).toBe(1);
    expect(requireNonEmptyQuery('  hello  ')).toBe('hello');
    expect(requireSearchQuery('  hello  ')).toBe('hello');
    expect(requireBoundedInteger(undefined, 2, 1, 3, 'limit')).toBe(2);
    expect(requireNonNegativeInteger(undefined, 0, 'offset')).toBe(0);

    expect(() => requireNonEmptyQuery(' ')).toThrow(ArgumentError);
    expect(() => requireSearchQuery(' ')).toThrow(ArgumentError);
    expect(() => requireBoundedInteger('2.5', 1, 1, 3, 'limit')).toThrow(ArgumentError);
    expect(() => requireNonNegativeInteger(-1, 0, 'offset')).toThrow(ArgumentError);
  });

  it('normalizes browser data and typed errors without changing their identity', async () => {
    const rows = [{ title: 'one' }];
    const argumentError = new ArgumentError('bad query');
    const codedFunction = Object.assign(() => undefined, { code: 'CUSTOM' });

    expect(unwrapBrowserResult({ session: 'x', data: rows })).toBe(rows);
    expect(unwrapBrowserResult(rows)).toBe(rows);
    expect(requireRows({ session: 'x', data: rows }, 'search')).toBe(rows);
    expect(() => requireRows({}, 'search')).toThrow(CommandExecutionError);
    expect(toHttpsUrl('/path', 'https://example.com/base')).toBe('https://example.com/path');
    expect(toHttpsUrl('javascript:alert(1)', 'https://example.com')).toBe('');
    expect(emptySearchResults('example', 'needle')).toBeInstanceOf(EmptyResultError);
    await expect(runBrowserStep('search', async () => 'ok')).resolves.toBe('ok');
    await expect(runBrowserStep('search', async () => { throw argumentError; })).rejects.toBe(argumentError);
    await expect(runBrowserStep('search', async () => { throw codedFunction; })).rejects.toBe(codedFunction);
    await expect(runBrowserStep('search', async () => { throw new Error('broke'); }))
      .rejects.toThrow('search failed: broke');
    await expect(runBrowserStep('search', async () => { throw { message: 'browser failed' }; }))
      .rejects.toThrow('search failed: browser failed');
  });
});

describe('plugin runtime desktop command factories', () => {
  it('creates screenshot, status, new, and dump commands with their existing behavior', async () => {
    const site = `runtime-test-${process.pid}`;
    const output = `/tmp/${site}.txt`;
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce('<html>snapshot</html>')
        .mockResolvedValueOnce('https://example.com')
        .mockResolvedValueOnce('Example')
        .mockResolvedValueOnce('<body>dump</body>'),
      snapshot: vi.fn()
        .mockResolvedValueOnce({ tree: 'snapshot' })
        .mockResolvedValueOnce({ tree: 'dump' }),
      pressKey: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
    };
    const screenshot = makeScreenshotCommand(site, 'Runtime Test');
    const status = makeStatusCommand(site, 'Runtime Test');
    const create = makeNewCommand(site, 'Runtime Test');
    const dump = makeDumpCommand(site);

    try {
      await expect(runBrowserCommand(screenshot, page, { output })).resolves.toEqual([
        { Status: 'Success', File: `/tmp/${site}-dom.html` },
        { Status: 'Success', File: `/tmp/${site}-a11y.txt` },
      ]);
      await expect(runBrowserCommand(status, page)).resolves.toEqual([
        { Status: 'Connected', Url: 'https://example.com', Title: 'Example' },
      ]);
      await expect(runBrowserCommand(create, page)).resolves.toEqual([{ Status: 'Success' }]);
      await expect(runBrowserCommand(dump, page)).resolves.toEqual([{
        action: 'Dom extraction finished',
        files: `/tmp/${site}-dom.html, /tmp/${site}-snapshot.json`,
      }]);

      expect(fs.readFileSync(`/tmp/${site}-a11y.txt`, 'utf8')).toBe('{\n  "tree": "snapshot"\n}');
      expect(fs.readFileSync(`/tmp/${site}-dom.html`, 'utf8')).toBe('<body>dump</body>');
      expect(fs.readFileSync(`/tmp/${site}-snapshot.json`, 'utf8')).toBe('{\n  "tree": "dump"\n}');
      expect(page.pressKey).toHaveBeenCalledWith(process.platform === 'darwin' ? 'Meta+N' : 'Control+N');
      expect(page.wait).toHaveBeenCalledWith(1);
    } finally {
      for (const file of [`/tmp/${site}-dom.html`, `/tmp/${site}-a11y.txt`, `/tmp/${site}-snapshot.json`]) {
        fs.rmSync(file, { force: true });
      }
    }
  });
});

function pageMock() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
  };
}

describe('site auth command helper', () => {
  it('can register login without claiming a site-owned whoami command', () => {
    registerSiteAuthCommands({
      site: 'auth-helper-login-only',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      registerWhoami: false,
      verify: async () => ({ username: 'alice' }),
    });

    expect(getRegistry().has('auth-helper-login-only/whoami')).toBe(false);
    expect(getRegistry().has('auth-helper-login-only/login')).toBe(true);
  });

  it('registers whoami aliases and foreground login columns', () => {
    registerSiteAuthCommands({
      site: 'auth-helper-registration',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      whoamiAliases: ['auth-status'],
      verify: async () => ({ username: 'alice' }),
    });

    expect(getRegistry().get('auth-helper-registration/whoami')).toMatchObject({
      access: 'read',
      browser: true,
      navigateBefore: false,
      aliases: ['auth-status'],
      columns: ['logged_in', 'site', 'username'],
    });
    expect(getRegistry().get('auth-helper-registration/auth-status'))
      .toBe(getRegistry().get('auth-helper-registration/whoami'));
    expect(getRegistry().get('auth-helper-registration/whoami'))
      .toMatchObject({ _authVerification: true });
    const login = getRegistry().get('auth-helper-registration/login')!;
    expect(login).toMatchObject({
      access: 'write',
      browser: true,
      navigateBefore: false,
      siteSession: 'persistent',
    });
    expect(login.args).toEqual([]);
    expect(login.columns).toEqual([
      'status', 'logged_in', 'site', 'username', 'action', 'verify_command',
    ]);
  });

  it('whoami returns normalized identity without opening login', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-whoami',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      verify: async () => ({ username: 'alice' }),
    });
    const cmd = getRegistry().get('auth-helper-whoami/whoami')!;
    const page = pageMock();

    await expect(runBrowserCommand(cmd, page)).resolves.toEqual([{
      logged_in: true,
      site: 'auth-helper-whoami',
      username: 'alice',
    }]);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('login returns the existing authenticated identity', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-authenticated',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      verify: async () => ({ username: 'alice' }),
    });
    const login = getRegistry().get('auth-helper-authenticated/login')!;
    const page = pageMock();

    await expect(runBrowserCommand(login, page)).resolves.toEqual([{
      status: 'already_logged_in',
      logged_in: true,
      site: 'auth-helper-authenticated',
      username: 'alice',
      action: '',
      verify_command: '',
    }]);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('completes and canonicalizes successful identity rows', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-canonical',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username', 'name'],
      verify: async () => ({
        logged_in: false,
        site: 'wrong-site',
        username: 'alice',
        extra: 'preserved',
      }),
    });
    const page = pageMock();
    const identity = {
      logged_in: true,
      site: 'auth-helper-canonical',
      username: 'alice',
      name: '',
      extra: 'preserved',
    };

    await expect(runBrowserCommand(getRegistry().get('auth-helper-canonical/whoami')!, page))
      .resolves.toEqual([identity]);
    await expect(runBrowserCommand(getRegistry().get('auth-helper-canonical/login')!, page))
      .resolves.toEqual([{
        status: 'already_logged_in',
        ...identity,
        action: '',
        verify_command: '',
      }]);
  });

  it('opens the default login URL and returns an immediate handoff', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-login',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      verify: async () => { throw new AuthRequiredError('example.com', 'missing'); },
    });
    const login = getRegistry().get('auth-helper-login/login')!;
    const page = pageMock();

    expect(login.args).toEqual([]);
    expect(login.columns).toEqual([
      'status', 'logged_in', 'site', 'username', 'action', 'verify_command',
    ]);
    await expect(runBrowserCommand(login, page)).resolves.toEqual([{
      status: 'action_required',
      logged_in: false,
      site: 'auth-helper-login',
      username: '',
      action: 'Complete sign-in in the opened Webcmd browser, then tell the agent when you are done.',
      verify_command: 'webcmd auth-helper-login whoami',
    }]);
    expect(page.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(page.wait).not.toHaveBeenCalled();
  });

  it('uses a custom opener for the immediate handoff', async () => {
    const openLogin = vi.fn().mockResolvedValue(undefined);
    registerSiteAuthCommands({
      site: 'auth-helper-custom-login',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      verify: async () => { throw new AuthRequiredError('example.com', 'missing'); },
      openLogin,
    });
    const login = getRegistry().get('auth-helper-custom-login/login')!;
    const page = pageMock();

    await runBrowserCommand(login, page);
    expect(openLogin).toHaveBeenCalledOnce();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('keeps optional auth-status hooks tolerant of empty responses', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-hooks',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      verify: async () => ({ username: 'alice' }),
      quickCheck: async () => null as never,
      refresh: async () => null as never,
    });
    const hooks = getRegistry().get('auth-helper-hooks/whoami')!.authStatus!;

    await expect(hooks.quickCheck!(pageMock() as never, {})).resolves.toEqual({ logged_in: false });
    await expect(hooks.refresh!(pageMock() as never, {})).resolves.toEqual({ touched: true });
  });

  it('uses defaults when optional auth callbacks are not functions', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-optional-callbacks',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      verify: async () => { throw new AuthRequiredError('example.com', 'missing'); },
      openLogin: true as never,
      quickCheck: true as never,
      refresh: true as never,
    });
    const whoami = getRegistry().get('auth-helper-optional-callbacks/whoami')!;
    const login = getRegistry().get('auth-helper-optional-callbacks/login')!;
    const page = pageMock();

    expect(whoami.authStatus).toEqual({});
    await expect(runBrowserCommand(login, page)).resolves.toMatchObject([{ status: 'action_required' }]);
    expect(page.goto).toHaveBeenCalledWith('https://example.com/login');
  });

  it('propagates non-auth probe and opener errors', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-probe-error',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      verify: async () => { throw new Error('probe broke'); },
    });
    registerSiteAuthCommands({
      site: 'auth-helper-open-error',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      verify: async () => { throw new AuthRequiredError('example.com', 'missing'); },
      openLogin: async () => { throw new Error('open broke'); },
    });

    await expect(runBrowserCommand(getRegistry().get('auth-helper-probe-error/login')!, pageMock()))
      .rejects.toThrow('probe broke');
    await expect(runBrowserCommand(getRegistry().get('auth-helper-open-error/login')!, pageMock()))
      .rejects.toThrow('open broke');
  });
});
