import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, normalizeProductRow, parseLimitArg, productCardsEvaluate, resolveCategoryUrl, safeGoto, SITE } from './utils.js';

cli({
  site: SITE,
  name: 'category',
  access: 'read',
  description: 'Read BigBasket category product cards',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'category', required: true, positional: true, help: 'Category URL or slug' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum products to return (max 50)' },
  ],
  columns: ['rank', 'product_id', 'title', 'brand', 'pack_size', 'price', 'mrp', 'discount', 'availability', 'url'],
  func: async (page, kwargs) => {
    const url = resolveCategoryUrl(kwargs.category);
    const limit = parseLimitArg(kwargs.limit, 20, 50);
    await safeGoto(page, url, 'bigbasket category');
    if (page.wait) await page.wait(2);
    const result = await page.evaluate(productCardsEvaluate(limit));
    const rows = (result?.rows || []).map(normalizeProductRow).filter((row) => row.product_id && row.title);
    if (!rows.length) {
      throw new EmptyResultError('bigbasket category', `No BigBasket products found at ${url}.`);
    }
    return rows;
  },
});
