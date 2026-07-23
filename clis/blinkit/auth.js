import { AuthRequiredError } from '@agentrhq/webcmd/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { BASE, DOMAIN } from './utils.js';

async function probeBlinkitIdentity(page) {
  const probe = await page.evaluate(`
    (() => {
      const readJson = (key) => {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
      };
      const state = window.__reduxStore__?.getState?.();
      const auth = state?.data?.auth || readJson('auth') || {};
      const user = state?.data?.user || readJson('user') || {};
      const text = document.body.innerText || '';
      if (!auth.accessToken && /^Login$/m.test(text)) return { kind: 'auth', detail: 'Blinkit login button is still visible' };
      if (!auth.accessToken) return { kind: 'auth', detail: 'Blinkit auth access token missing' };
      return {
        ok: true,
        phone: auth.phoneNumber || user.phone || user.profile?.phone || '',
        user_id: user.id || user.user_id || user.profile?.id || ''
      };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError(DOMAIN, probe.detail);
  return { phone: probe?.phone || '', user_id: probe?.user_id || '' };
}

function buildOpenLoginEvaluate() {
  return `
    (() => {
      const readJson = (key) => {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
      };
      const state = window.__reduxStore__?.getState?.();
      const auth = state?.data?.auth || readJson('auth') || {};
      if (auth.accessToken) return { opened: false, detail: 'already_logged_in' };

      const dialogText = document.querySelector('[role="dialog"]')?.innerText || '';
      if (/Enter mobile number|Log in or Sign up/i.test(dialogText)) {
        return { opened: true, detail: 'login_dialog_visible' };
      }

      const target = Array.from(document.querySelectorAll('button, [role="button"], a, div'))
        .find((node) => (node.innerText || node.textContent || '').trim() === 'Login');
      target?.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return { opened: Boolean(target), detail: target ? 'clicked_login' : 'login_button_missing' };
    })()
  `;
}

registerSiteAuthCommands({
  site: 'blinkit',
  domain: DOMAIN,
  loginUrl: BASE,
  columns: ['phone', 'user_id'],
  verify: async (page) => {
    await page.goto(BASE);
    await page.wait(1);
    return probeBlinkitIdentity(page);
  },
  openLogin: async (page) => {
    await page.goto(BASE);
    await page.wait(1);
    const result = await page.evaluate(buildOpenLoginEvaluate());
    if (!result?.opened) throw new Error(`Blinkit login dialog did not open: ${result?.detail || 'unknown reason'}`);
  },
});

export const __test__ = {
  buildOpenLoginEvaluate,
  probeBlinkitIdentity,
};
