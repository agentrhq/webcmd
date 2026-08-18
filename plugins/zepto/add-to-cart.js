import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CART_EVALUATE, DOMAIN, SITE, ZEPTO_NAV_OPTIONS, parseQuantityArg, resolveProductInput, safeGoto } from './utils.js';

function addToCartEvaluate(quantity) {
  return `
    (async () => {
      const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
      const findButton = (pattern) => Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => pattern.test(clean(node.innerText || node.textContent || node.getAttribute('aria-label'))));
      let button = findButton(/^(ADD|Add to Cart)$/i);
      if (!button) return { ok: false, message: 'ADD_BUTTON_NOT_FOUND' };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 800));
      for (let i = 1; i < ${Number(quantity) || 1}; i += 1) {
        const plus = findButton(/increase quantity by one|\\+|add/i);
        plus?.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      const cart = (${CART_EVALUATE});
      const itemCount = (cart.rows || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      return { ok: true, message: 'Added to cart', item_count: itemCount };
    })()
  `;
}

cli({
  site: SITE,
  name: 'add-to-cart',
  access: 'write',
  description: 'Add a Zepto product to cart',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'product', required: true, positional: true, help: 'Product URL from Zepto search results' },
    { name: 'quantity', type: 'int', default: 1, help: 'Quantity to add (max 12)' },
  ],
  columns: ['ok', 'product_id', 'quantity', 'item_count', 'message'],
  func: async (page, kwargs) => {
    const product = resolveProductInput(kwargs.product);
    const quantity = parseQuantityArg(kwargs.quantity, 1, 12);
    await safeGoto(page, product.url, 'zepto add-to-cart', ZEPTO_NAV_OPTIONS);
    if (page.wait) await page.wait(2);
    const result = await page.evaluate(addToCartEvaluate(quantity)).catch((error) => {
      throw new CommandExecutionError(`zepto add-to-cart failed: ${error?.message || error}`);
    });
    if (!result?.ok) throw new CommandExecutionError(result?.message === 'ADD_BUTTON_NOT_FOUND' ? 'Could not find a Zepto add-to-cart button.' : 'Failed to add Zepto item to cart.');
    return [{ ok: true, product_id: product.productId, quantity, item_count: Number(result.item_count || 0), message: 'Added to cart' }];
  },
});

export const __test__ = { addToCartEvaluate };
