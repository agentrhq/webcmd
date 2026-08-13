import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, SITE, ZEPTO_NAV_OPTIONS, cleanText, normalizeProductRow, resolveProductInput, safeGoto } from './utils.js';

function productEvaluate(productId) {
  return `
    (() => {
      const productId = ${JSON.stringify(productId)};
      const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
      const text = clean(document.body?.innerText || document.body?.textContent || '');
      const prices = Array.from(document.querySelectorAll('span,div'))
        .map((node) => clean(node.textContent))
        .filter((value) => /^₹\\s*\\d/i.test(value));
      const title = clean(document.querySelector('h1')?.textContent)
        || text.split('\\n').map(clean).find((line) => /[A-Za-z]/.test(line) && !/Delivery|Search|Login|Cart|Home|₹|Add to Cart/i.test(line))
        || '';
      return {
        product_id: productId,
        title,
        brand: clean(Array.from(document.querySelectorAll('div,span')).find((node) => clean(node.textContent) === 'Brand')?.nextElementSibling?.textContent),
        pack_size: text.match(/\\b\\d+(?:\\.\\d+)?\\s*(?:kg|g|ml|l|pcs?|pack)\\b/i)?.[0] || '',
        price: prices[0] || '',
        mrp: prices[1] || '',
        availability: /out of stock|unavailable/i.test(text) ? 'Out of stock' : '',
        url: location.href,
      };
    })()
  `;
}

cli({
  site: SITE,
  name: 'product',
  access: 'read',
  description: 'Read Zepto product details',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'product', required: true, positional: true, help: 'Product URL from Zepto search results' },
  ],
  columns: ['product_id', 'title', 'brand', 'pack_size', 'price', 'mrp', 'availability', 'url'],
  func: async (page, kwargs) => {
    const product = resolveProductInput(kwargs.product);
    await safeGoto(page, product.url, 'zepto product', ZEPTO_NAV_OPTIONS);
    if (page.wait) await page.wait(2);
    const row = normalizeProductRow(await page.evaluate(productEvaluate(product.productId)), 0);
    if (!row.product_id || !cleanText(row.title)) throw new EmptyResultError('zepto product', `No product details found for ${product.productId}.`);
    return [row];
  },
});
