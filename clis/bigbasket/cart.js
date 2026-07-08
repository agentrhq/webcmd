import { AuthRequiredError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CART_URL, DOMAIN, parseMoney, safeGoto, SITE, toBigBasketUrl } from './utils.js';

export const CART_EVALUATE = `
  (() => {
    const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
    const bodyText = clean(document.body?.innerText || document.body?.textContent || '');
    if (/Login\\/ Sign up|Login\\/ Sign Up|Enter Phone number|Using OTP/i.test(bodyText)) {
      return { authRequired: true, rows: [], href: location.href };
    }
    if (!/my basket|basket|cart|checkout|subtotal|total/i.test(bodyText) || /My Smart Basket/i.test(bodyText)) {
      return { rows: [], notCart: true, href: location.href, text: bodyText };
    }
    const itemRoots = Array.from(document.querySelectorAll('[data-testid*="cart"], [class*="Cart"], [class*="cart"], [class*="Basket"], [class*="basket"], li, article'))
      .filter((node) => /₹|rs\\.?|qty|quantity/i.test(clean(node.textContent || '')));
    const seen = new Set();
    const rows = [];

    for (const root of itemRoots) {
      const bucket = root.closest('section, [class*="Recommendation"], [class*="recommend"], [class*="Carousel"], [class*="carousel"]');
      if (/before you checkout|recommend|you may also like|frequently bought/i.test(clean(bucket?.textContent || ''))) continue;
      const link = root.querySelector('a[href*="/pd/"]');
      const href = link?.href || link?.getAttribute('href') || '';
      if (/beforeyoucheckout/i.test(href)) continue;
      const productId = href.match(/\\/pd\\/(\\d{4,})/)?.[1] || '';
      const title = clean(link?.textContent) || clean(root.querySelector('h1,h2,h3,[class*="name"],[class*="Name"]')?.textContent);
      if (!productId || !title || seen.has(productId)) continue;
      seen.add(productId);
      const text = clean(root.textContent || '');
      const money = text.match(/(?:₹|Rs\\.?)[\\s\\d,.]+/gi) || [];
      const quantity = Number(text.match(/(?:qty|quantity)\\D*(\\d+)/i)?.[1] || 1);
      rows.push({
        product_id: productId,
        title,
        quantity,
        price: money[0] || '',
        line_total: money[money.length - 1] || money[0] || '',
        availability: /out of stock|unavailable/i.test(text) ? 'Out of stock' : '',
        url: href,
      });
    }
    return { rows, href: location.href, text: bodyText };
  })()
`;

cli({
  site: SITE,
  name: 'cart',
  access: 'read',
  description: 'Read BigBasket cart line items',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['product_id', 'title', 'quantity', 'price', 'line_total', 'availability', 'url'],
  func: async (page) => {
    await safeGoto(page, CART_URL, 'bigbasket cart');
    if (page.wait) await page.wait(2);
    const result = await page.evaluate(CART_EVALUATE);
    if (result?.authRequired) {
      throw new AuthRequiredError('bigbasket.com', 'Log into BigBasket in the Webcmd browser session to read cart items.');
    }
    const rows = (result?.rows || []).map((row) => ({
      product_id: row.product_id || '',
      title: row.title || '',
      quantity: row.quantity || 1,
      price: parseMoney(row.price),
      line_total: parseMoney(row.line_total),
      availability: row.availability || '',
      url: toBigBasketUrl(row.url),
    })).filter((row) => row.product_id && row.title);
    if (!rows.length) {
      const hint = result?.notCart
        ? 'BigBasket did not expose a cart view in the current session.'
        : 'BigBasket cart is empty or no visible cart items were found.';
      throw new EmptyResultError('bigbasket cart', hint);
    }
    return rows;
  },
});
