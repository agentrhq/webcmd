import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { PRACTO, probeIdentity } from './utils.js';

registerSiteAuthCommands({
  site: 'practo',
  domain: 'www.practo.com',
  loginUrl: `${PRACTO}/login`,
  columns: ['name'],
  whoamiAliases: ['auth-status'],
  quickCheck: async (page) => {
    try {
      const rows = await probeIdentity(page);
      return { logged_in: true, name: rows[0].name };
    } catch {
      return { logged_in: false };
    }
  },
  verify: async (page) => (await probeIdentity(page))[0],
  openLogin: async (page) => {
    await page.goto(`${PRACTO}/login`, { waitUntil: 'none', settleMs: 1500 });
  },
});
