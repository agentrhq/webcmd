import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, gotoBlinkit, normalizeLocationState } from './utils.js';

const LOCATION_EVALUATE = `
  (() => {
    const readJson = (key) => {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
    };
    return window.__reduxStore__?.getState?.()?.data?.location || readJson('location') || {};
  })()
`;

cli({
  site: 'blinkit',
  name: 'location',
  access: 'read',
  description: 'Show the selected Blinkit delivery location',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['selected', 'label', 'area', 'city', 'pincode', 'hasCoordinates', 'source'],
  func: async (page) => {
    await gotoBlinkit(page, '/');
    if (page.wait) await page.wait(1);
    return [normalizeLocationState(await page.evaluate(LOCATION_EVALUATE))];
  },
});

