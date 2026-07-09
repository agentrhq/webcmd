import { AuthRequiredError, TimeoutError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BASE, DOMAIN } from './utils.js';

const DEFAULT_TIMEOUT_SECONDS = 300;

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

cli({
  site: 'blinkit',
  name: 'login',
  access: 'write',
  description: 'Open Blinkit login and wait until the browser session is authenticated',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  siteSession: 'persistent',
  args: [
    { name: 'timeout', type: 'int', default: DEFAULT_TIMEOUT_SECONDS, help: 'Maximum seconds to wait for the user to finish login' },
  ],
  columns: ['status', 'logged_in', 'phone', 'user_id'],
  func: async (page, kwargs) => {
    await page.goto(BASE);
    await page.wait(1);
    try {
      const identity = await probeBlinkitIdentity(page);
      return [{ status: 'already_logged_in', logged_in: true, ...identity }];
    } catch (error) {
      if (!(error instanceof AuthRequiredError)) throw error;
    }

    const opened = await page.evaluate(buildOpenLoginEvaluate()).catch(() => null);
    const timeoutSeconds = Number(kwargs.timeout ?? DEFAULT_TIMEOUT_SECONDS);
    const deadline = Date.now() + timeoutSeconds * 1000;
    let lastMessage = opened?.opened ? '' : opened?.detail || '';
    while (Date.now() < deadline) {
      await page.wait(2);
      try {
        const identity = await probeBlinkitIdentity(page);
        return [{ status: 'login_complete', logged_in: true, ...identity }];
      } catch (error) {
        if (!(error instanceof AuthRequiredError)) throw error;
        lastMessage = error.message;
      }
    }
    throw new TimeoutError('blinkit login', timeoutSeconds, lastMessage || 'Finish OTP login in the opened Blinkit tab and retry.');
  },
});

export const __test__ = {
  buildOpenLoginEvaluate,
  probeBlinkitIdentity,
};
