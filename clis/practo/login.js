import { AuthRequiredError, TimeoutError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { PRACTO, probeIdentity } from './utils.js';

const DEFAULT_TIMEOUT_SECONDS = 300;

function isAuthRequired(error) {
  return error instanceof AuthRequiredError;
}

cli({
  site: 'practo',
  name: 'login',
  access: 'write',
  description: 'Open Practo login and wait until the browser session is authenticated',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  siteSession: 'persistent',
  args: [
    { name: 'timeout', type: 'int', default: DEFAULT_TIMEOUT_SECONDS, help: 'Maximum seconds to wait for the user to finish login' },
  ],
  columns: ['status', 'logged_in', 'site', 'name'],
  func: async (page, kwargs) => {
    try {
      const rows = await probeIdentity(page);
      return [{ status: 'already_logged_in', ...rows[0] }];
    } catch (error) {
      if (!isAuthRequired(error)) throw error;
    }

    await page.goto(`${PRACTO}/login`, { waitUntil: 'none', settleMs: 1500 });
    const timeout = Number(kwargs.timeout ?? DEFAULT_TIMEOUT_SECONDS);
    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
      await page.wait(2);
      try {
        const rows = await probeIdentity(page);
        return [{ status: 'login_complete', ...rows[0] }];
      } catch (error) {
        if (!isAuthRequired(error)) throw error;
      }
    }
    throw new TimeoutError('practo login', timeout, 'Complete Practo login in the browser, then retry.');
  },
});
