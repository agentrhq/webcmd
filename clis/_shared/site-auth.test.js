import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { registerSiteAuthCommands } from './site-auth.js';

function pageMock() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
  };
}

describe('site auth command helper', () => {
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
    const login = getRegistry().get('auth-helper-registration/login');
    expect(login).toMatchObject({
      access: 'write',
      browser: true,
      navigateBefore: false,
      defaultWindowMode: 'foreground',
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
    const cmd = getRegistry().get('auth-helper-whoami/whoami');
    const page = pageMock();

    await expect(cmd.func(page, {})).resolves.toEqual([{
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
    const login = getRegistry().get('auth-helper-authenticated/login');
    const page = pageMock();

    await expect(login.func(page, {})).resolves.toEqual([{
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

    await expect(getRegistry().get('auth-helper-canonical/whoami').func(page, {}))
      .resolves.toEqual([identity]);
    await expect(getRegistry().get('auth-helper-canonical/login').func(page, {}))
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
    const login = getRegistry().get('auth-helper-login/login');
    const page = pageMock();

    expect(login.args).toEqual([]);
    expect(login.columns).toEqual([
      'status', 'logged_in', 'site', 'username', 'action', 'verify_command',
    ]);
    await expect(login.func(page, {})).resolves.toEqual([{
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
    const login = getRegistry().get('auth-helper-custom-login/login');
    const page = pageMock();

    await login.func(page, {});
    expect(openLogin).toHaveBeenCalledOnce();
    expect(page.goto).not.toHaveBeenCalled();
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

    await expect(getRegistry().get('auth-helper-probe-error/login').func(pageMock(), {}))
      .rejects.toThrow('probe broke');
    await expect(getRegistry().get('auth-helper-open-error/login').func(pageMock(), {}))
      .rejects.toThrow('open broke');
  });
});
