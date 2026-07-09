import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { probeIdentity } from './utils.js';

cli({
  site: 'practo',
  name: 'whoami',
  aliases: ['auth-status'],
  access: 'read',
  description: 'Show whether the current browser session is logged into Practo',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [],
  columns: ['logged_in', 'site', 'name'],
  authStatus: {
    quickCheck: async (page) => {
      try {
        const rows = await probeIdentity(page);
        return { logged_in: true, name: rows[0].name };
      } catch {
        return { logged_in: false };
      }
    },
  },
  func: probeIdentity,
});
