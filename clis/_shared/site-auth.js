import { AuthRequiredError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const LOGIN_ACTION = 'Complete sign-in in the opened Webcmd browser, then tell the agent when you are done.';

function normalizeIdentity(config, identity) {
  const row = identity && typeof identity === 'object' && !Array.isArray(identity)
    ? identity
    : {};
  return { ...blankIdentity(config), ...row, logged_in: true, site: config.site };
}

function isAuthRequired(error) {
  return error instanceof AuthRequiredError;
}

async function tryProbe(config, page) {
  return normalizeIdentity(config, await config.verify(page, { phase: 'identity' }));
}

function identityColumns(config) {
  return config.columns ?? ['id', 'username', 'name'];
}

function blankIdentity(config) {
  return Object.fromEntries(identityColumns(config).map((column) => [column, '']));
}

function commandColumns(config) {
  return ['logged_in', 'site', ...identityColumns(config)];
}

function loginColumns(config) {
  return ['status', ...commandColumns(config), 'action', 'verify_command'];
}

function normalizeQuickCheck(result) {
  if (typeof result === 'boolean') return { logged_in: result };
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { logged_in: !!result.logged_in, ...result };
  }
  return { logged_in: false };
}

function normalizeRefreshResult(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  return { touched: true };
}

export function registerSiteAuthCommands(config) {
  if (!config?.site || !config?.domain || !config?.loginUrl || typeof config.verify !== 'function') {
    throw new Error('registerSiteAuthCommands requires site, domain, loginUrl, and verify(page)');
  }
  // Sites whose login is a modal/flow rather than a page can pass
  // openLogin(page) to bring the login UI up; default is a plain navigation.
  const openLogin = typeof config.openLogin === 'function'
    ? config.openLogin
    : async (page) => { await page.goto(config.loginUrl); };

  cli({
    site: config.site,
    name: 'whoami',
    access: 'read',
    description: config.whoamiDescription ?? `Show the current logged-in ${config.site} account`,
    domain: config.domain,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    aliases: config.whoamiAliases ?? [],
    args: [],
    columns: commandColumns(config),
    authStatus: {
      ...(typeof config.quickCheck === 'function'
        ? { quickCheck: async (page) => normalizeQuickCheck(await config.quickCheck(page)) }
        : {}),
      ...(typeof config.refresh === 'function'
        ? { refresh: async (page, kwargs) => normalizeRefreshResult(await config.refresh(page, kwargs)) }
        : {}),
    },
    func: async (page) => [await tryProbe(config, page)],
  });

  cli({
    site: config.site,
    name: 'login',
    access: 'write',
    description: config.loginDescription ?? `Open ${config.site} login`,
    domain: config.domain,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    siteSession: 'persistent',
    args: [],
    columns: loginColumns(config),
    func: async (page) => {
      try {
        return [{
          status: 'already_logged_in',
          ...await tryProbe(config, page),
          action: '',
          verify_command: '',
        }];
      } catch (error) {
        if (!isAuthRequired(error)) throw error;
      }

      await openLogin(page);
      return [{
        status: 'action_required',
        logged_in: false,
        site: config.site,
        ...blankIdentity(config),
        action: LOGIN_ACTION,
        verify_command: `webcmd ${config.site} whoami`,
      }];
    },
  });
}
