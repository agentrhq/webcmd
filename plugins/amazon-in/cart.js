import { AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { hasAmazonInAuthCookie } from './parsers.js';
import { gotoAmazon, SITE, DOMAIN } from './shared.js';

const CART_URL = 'https://www.amazon.in/gp/cart/view.html';

cli({
  site: SITE,
  name: 'cart',
  access: 'read',
  description: 'Read the authenticated Amazon.in cart',
  domain: DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  freshPage: true,
  args: [],
  columns: ['asin', 'title', 'price', 'quantity', 'product_url'],
  func: async (page) => {
    await gotoAmazon(page, CART_URL, 'cart');
    try {
      await page.wait({ selector: '#sc-active-cart .sc-list-item', timeout: 20 });
    } catch {
      await page.sleep(1);
    }
    const cookies = await page.getCookies({ url: 'https://www.amazon.in/' });
    if (!hasAmazonInAuthCookie(cookies.map((cookie) => cookie.name))) {
      throw new AuthRequiredError(DOMAIN, 'Amazon.in login is required before reading the cart');
    }
    const payload = await page.evaluate(`
      (() => {
        const text = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
        const rows = [...document.querySelectorAll('#sc-active-cart .sc-list-item')].map((item) => {
          const asin = item.getAttribute('data-asin') || item.querySelector('[data-asin]')?.getAttribute('data-asin') || '';
          const title = text(item.querySelector('.sc-product-title') || item.querySelector('.a-truncate-cut, [data-name]'))
            .replace(/Opens in a new tab/gi, '').trim();
          const price = text(item.querySelector('.sc-price, .a-price .a-offscreen'));
          const quantity = Number(item.querySelector('select[name^="quantity"], input[name^="quantity"]')?.value || 1);
          return { asin, title, price, quantity };
        }).filter((row) => row.asin && row.title);
        return { rows, empty: /your amazon cart is empty|no items in your cart/i.test(document.body?.innerText || '') };
      })()
    `);
    if (payload.rows.length > 0) {
      return payload.rows.map((row) => ({
        asin: row.asin,
        title: row.title,
        price: Number(row.price.replaceAll('₹', '').replaceAll(',', '')) || null,
        quantity: Number.isInteger(row.quantity) && row.quantity > 0 ? row.quantity : 1,
        product_url: `https://www.amazon.in/dp/${row.asin}`,
      }));
    }
    if (payload.empty) return [];
    throw new CommandExecutionError('Amazon.in cart exposed no recognizable items', 'The cart page may have changed or a login challenge may be visible.');
  },
});
