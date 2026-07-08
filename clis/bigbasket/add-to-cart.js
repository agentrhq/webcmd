import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, parseQuantityArg, resolveProductInput, safeGoto, SITE } from './utils.js';

function addToCartEvaluate(productId, quantity) {
  return `
    (async () => {
      const productId = ${JSON.stringify(productId)};
      const quantity = ${Number(quantity) || 1};
      const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
      const text = clean(document.body?.innerText || '');
      if (/select\\s+(?:size|weight|pack|option)|choose\\s+(?:size|weight|pack|option)/i.test(text)) {
        return { ok: false, message: 'OPTION_REQUIRED' };
      }

      const quantityInput = document.querySelector('input[type="number"], input[aria-label*="quantity" i]');
      if (quantityInput && quantity > 1) {
        quantityInput.value = String(quantity);
        quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
        quantityInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const button = buttons.find((node) => {
        const label = clean(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title'));
        return /^(add|add to basket|add to cart|basket)$/i.test(label) || /add\\s*(to)?\\s*(basket|cart)/i.test(label);
      });
      if (!button) return { ok: false, message: 'ADD_BUTTON_NOT_FOUND' };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const afterText = clean(document.body?.innerText || '');
      const ok = /added|basket|cart/i.test(afterText) && !/failed|error/i.test(afterText);
      return {
        ok,
        message: ok ? 'SUCCESS' : 'UNCONFIRMED',
        product_id: productId,
        url: location.href,
      };
    })()
  `;
}

cli({
  site: SITE,
  name: 'add-to-cart',
  access: 'write',
  description: 'Add a BigBasket product to cart',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'product', required: true, positional: true, help: 'Product ID or URL' },
    { name: 'quantity', type: 'int', default: 1, help: 'Quantity to add (max 20)' },
  ],
  columns: ['ok', 'product_id', 'quantity', 'url', 'message'],
  func: async (page, kwargs) => {
    const product = resolveProductInput(kwargs.product);
    const quantity = parseQuantityArg(kwargs.quantity, 1, 20);
    await safeGoto(page, product.url, 'bigbasket add-to-cart');
    if (page.wait) await page.wait(2);
    const result = await page.evaluate(addToCartEvaluate(product.productId, quantity)).catch((error) => {
      throw new CommandExecutionError(`bigbasket add-to-cart evaluation failed: ${error?.message || error}`);
    });
    if (result?.message === 'OPTION_REQUIRED') {
      throw new CommandExecutionError('This BigBasket product requires option selection and is not supported in v1.');
    }
    if (result?.message === 'ADD_BUTTON_NOT_FOUND') {
      throw new CommandExecutionError('Could not find a BigBasket add-to-cart button.');
    }
    if (!result?.ok) {
      throw new CommandExecutionError('Failed to confirm BigBasket add-to-cart success.');
    }
    return [{
      ok: true,
      product_id: product.productId,
      quantity,
      url: result.url || product.url,
      message: 'Added to cart',
    }];
  },
});
