import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, HOME_URL, normalizeLocationState, safeGoto, SITE } from './utils.js';

const LOCATION_EVALUATE = `
  (() => {
    const read = (key) => localStorage.getItem(key) || sessionStorage.getItem(key) || '';
    return {
      selectedAddressInfo: read('selectedAddressInfo'),
      selected_address_id: read('selected_address_id'),
      pin: read('pin') || read('pincode'),
    };
  })()
`;

cli({
  site: SITE,
  name: 'location',
  access: 'read',
  description: 'Show the selected BigBasket delivery location',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['selected', 'label', 'area', 'city', 'pincode', 'source'],
  func: async (page) => {
    await safeGoto(page, HOME_URL, 'bigbasket location');
    if (page.wait) await page.wait(1);
    return [normalizeLocationState(await page.evaluate(LOCATION_EVALUATE))];
  },
});
