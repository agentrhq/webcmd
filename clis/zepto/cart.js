import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CART_EVALUATE, DOMAIN, HOME_URL, SITE, ZEPTO_NAV_OPTIONS, normalizeCartRows, safeGoto } from './utils.js';

cli({
  site: SITE,
  name: 'cart',
  access: 'read',
  description: 'Read Zepto cart line items',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['rank', 'product_id', 'title', 'pack_size', 'quantity', 'price', 'mrp', 'availability'],
  func: async (page) => {
    await safeGoto(page, HOME_URL, 'zepto cart', ZEPTO_NAV_OPTIONS);
    if (page.wait) await page.wait(1);
    const rows = normalizeCartRows(await page.evaluate(CART_EVALUATE));
    if (!rows.length) throw new EmptyResultError('zepto cart', 'Zepto cart is empty or no visible cart items were found.');
    return rows;
  },
});
