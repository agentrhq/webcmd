import { AuthRequiredError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const LOGIN_ACTION = 'Complete sign-in in the opened Webcmd browser, then tell the agent when you are done.';

function identityColumns(config) {
  return config.columns ?? ['id', 'username', 'name'];
}

function blankIdentity(config) {
  return Object.fromEntries(identityColumns(config).map((column) => [column, '']));
}

function normalizeIdentity(config, identity) {
  const row = identity && typeof identity === 'object' && !Array.isArray(identity)
    ? identity
    : {};
  return { ...blankIdentity(config), ...row, logged_in: true, site: config.site };
}

async function tryProbe(config, page) {
  return normalizeIdentity(config, await config.verify(page, { phase: 'identity' }));
}

function commandColumns(config) {
  return ['logged_in', 'site', ...identityColumns(config)];
}

function loginColumns(config) {
  return ['status', ...commandColumns(config), 'action', 'verify_command'];
}

function registerSiteAuthCommands(config) {
  const openLogin = async (page) => { await page.goto(config.loginUrl); };

  cli({
    site: config.site,
    name: 'whoami',
    access: 'read',
    description: config.whoamiDescription,
    domain: config.domain,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [],
    columns: commandColumns(config),
    func: async (page) => [await tryProbe(config, page)],
  });

  cli({
    site: config.site,
    name: 'login',
    access: 'write',
    description: config.loginDescription,
    domain: config.domain,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
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
        if (!(error instanceof AuthRequiredError)) throw error;
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

function unwrapBrowserResult(value) {
  if (
    value
    && typeof value === 'object'
    && typeof value.session === 'string'
    && Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    return value.data;
  }
  return value;
}

async function verifyLumaIdentity(page) {
  await page.goto('https://luma.com/settings');
  await page.wait(1);

  const evaluated = await page.evaluate(`() => {
    const pageUrl = location.href;
    const title = document.title || '';
    const firstName = document.querySelector('input[name="first_name"]')?.value?.trim() || '';
    const lastName = document.querySelector('input[name="last_name"]')?.value?.trim() || '';
    const name = [firstName, lastName].filter(Boolean).join(' ');
    const pageText = document.body?.innerText || '';
    const email = pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0] || '';
    return { pageUrl, title, name, email };
  }`);
  const identity = unwrapBrowserResult(evaluated);

  if (
    !identity
    || /\/signin(?:\?|$)/.test(String(identity.pageUrl || ''))
    || identity.title !== 'Account Settings · Luma'
    || (!identity.name && !identity.email)
  ) {
    throw new AuthRequiredError('luma.com', 'Could not detect a logged-in Luma account');
  }

  return {
    name: identity.name || '',
    email: identity.email || '',
    url: 'https://luma.com/settings',
  };
}

registerSiteAuthCommands({
  site: 'luma',
  domain: 'luma.com',
  loginUrl: 'https://luma.com/signin?next=%2Fhome',
  columns: ['name', 'email', 'url'],
  loginDescription: 'Open Luma sign in',
  whoamiDescription: 'Show the current logged-in Luma account',
  verify: verifyLumaIdentity,
});
