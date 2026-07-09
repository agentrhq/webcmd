import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { buildSearchUrl, DOMAIN, normalizeProductRow, parseLimitArg, productCardsEvaluate, safeGoto, SITE } from './utils.js';

cli({
  site: SITE,
  name: 'search',
  access: 'read',
  description: 'Search BigBasket products',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum products to return (max 50)' },
  ],
  columns: ['rank', 'product_id', 'title', 'brand', 'pack_size', 'price', 'mrp', 'discount', 'availability', 'url'],
  func: async (page, kwargs) => {
    const url = buildSearchUrl(kwargs.query);
    const limit = parseLimitArg(kwargs.limit, 20, 50);
    await safeGoto(page, url, 'bigbasket search');
    if (page.wait) await page.wait(2);
    const result = await page.evaluate(productCardsEvaluate(limit));
    const rows = (result?.rows || []).map(normalizeProductRow).filter((row) => row.product_id && row.title);
    if (!rows.length) {
      throw new EmptyResultError('bigbasket search', `No BigBasket products matched "${kwargs.query}".`);
    }
    return rows;
  },
});
