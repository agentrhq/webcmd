import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, HOME_URL, SITE, ZEPTO_NAV_OPTIONS, normalizeLocationState, readLocationEvaluate, safeGoto } from './utils.js';

cli({
  site: SITE,
  name: 'location',
  access: 'read',
  description: 'Show the selected Zepto delivery location',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['selected', 'label', 'area', 'city', 'pincode', 'hasCoordinates', 'source'],
  func: async (page) => {
    await safeGoto(page, HOME_URL, 'zepto location', ZEPTO_NAV_OPTIONS);
    if (page.wait) await page.wait(1);
    return [normalizeLocationState(await page.evaluate(readLocationEvaluate()))];
  },
});
