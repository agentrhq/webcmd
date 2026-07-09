import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { PRACTO } from './utils.js';

cli({
  site: 'practo',
  name: 'login',
  access: 'write',
  description: 'Open Practo login for manual sign-in',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  siteSession: 'persistent',
  args: [],
  columns: ['status', 'site', 'message'],
  func: async (page) => {
    await page.goto(`${PRACTO}/login`);
    return [{ status: 'opened', site: 'practo', message: 'Finish login in the browser, then run `webcmd practo whoami`.' }];
  },
});
