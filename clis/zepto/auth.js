import { AuthRequiredError, TimeoutError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, HOME_URL, SITE, ZEPTO_NAV_OPTIONS, safeGoto } from './utils.js';

function authEvaluate() {
  return `
    (() => {
      const text = document.body?.innerText || '';
      const loggedIn = !/\\bLogin\\b/i.test(text) && !/please login/i.test(text);
      return { loggedIn };
    })()
  `;
}

function openLoginEvaluate() {
  return `
    (() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const button = buttons.find((node) => /\\blogin\\b/i.test(node.innerText || node.textContent || node.getAttribute('aria-label') || ''));
      button?.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return Boolean(button);
    })()
  `;
}

cli({
  site: SITE,
  name: 'login',
  access: 'write',
  description: 'Open Zepto login and wait until the browser session is authenticated',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  siteSession: 'persistent',
  args: [
    { name: 'timeout', type: 'int', default: 300, help: 'Maximum seconds to wait for the user to finish login' },
  ],
  columns: ['status', 'logged_in', 'site'],
  func: async (page, kwargs) => {
    await safeGoto(page, HOME_URL, 'zepto login', ZEPTO_NAV_OPTIONS);
    if ((await page.evaluate(authEvaluate()).catch(() => ({ loggedIn: false }))).loggedIn) {
      return [{ status: 'already_logged_in', logged_in: true, site: SITE }];
    }
    await page.evaluate(openLoginEvaluate()).catch(() => false);
    const timeout = Number(kwargs.timeout ?? 300);
    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
      await page.wait(2);
      if ((await page.evaluate(authEvaluate()).catch(() => ({ loggedIn: false }))).loggedIn) {
        return [{ status: 'login_complete', logged_in: true, site: SITE }];
      }
    }
    throw new TimeoutError('zepto login', timeout, 'Run webcmd zepto login and complete the login dialog in the browser.');
  },
});

export const __test__ = { authEvaluate, openLoginEvaluate };
