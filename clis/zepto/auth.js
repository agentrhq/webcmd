import { AuthRequiredError } from '@agentrhq/webcmd/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
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

async function verifyZeptoIdentity(page) {
  await safeGoto(page, HOME_URL, 'zepto login', ZEPTO_NAV_OPTIONS);
  const result = await page.evaluate(authEvaluate());
  if (!result.loggedIn) throw new AuthRequiredError(DOMAIN, 'Zepto login is required');
  return {};
}

registerSiteAuthCommands({
  site: SITE,
  domain: DOMAIN,
  loginUrl: HOME_URL,
  columns: [],
  verify: verifyZeptoIdentity,
  openLogin: async (page) => {
    await safeGoto(page, HOME_URL, 'zepto login', ZEPTO_NAV_OPTIONS);
    const opened = await page.evaluate(openLoginEvaluate());
    if (!opened) throw new Error('Zepto login dialog did not open');
  },
});

export const __test__ = { authEvaluate, openLoginEvaluate };
