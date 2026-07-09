import { AuthRequiredError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, SITE, ZEPTO_NAV_OPTIONS, buildSearchUrl, normalizeProductRow, parseLimitArg, productCardsEvaluate, safeGoto } from './utils.js';

cli({
  site: SITE,
  name: 'search',
  access: 'read',
  description: 'Search Zepto products',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum products to return (max 50)' },
  ],
  columns: ['rank', 'product_id', 'title', 'brand', 'pack_size', 'price', 'mrp', 'availability', 'url'],
  func: async (page, kwargs) => {
    const url = buildSearchUrl(kwargs.query);
    const limit = parseLimitArg(kwargs.limit, 20, 50);
    await safeGoto(page, url, 'zepto search', ZEPTO_NAV_OPTIONS);
    if (page.wait) await page.wait(2);
    const result = await page.evaluate(productCardsEvaluate(limit));
    if (result?.authRequired) throw new AuthRequiredError(DOMAIN, 'Log into Zepto in the Webcmd browser session to search products.');
    const rows = (result?.rows || []).map(normalizeProductRow).filter((row) => row.product_id && row.title);
    if (!rows.length) throw new EmptyResultError('zepto search', `No Zepto products matched "${kwargs.query}".`);
    return rows;
  },
});
