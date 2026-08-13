import { AuthRequiredError, ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { hasAmazonInAuthCookie, buildProductUrl } from './parsers.js';
import { gotoAmazon, SITE, DOMAIN } from './shared.js';

async function assertAuthenticated(page) {
  const cookies = await page.getCookies({ url: 'https://www.amazon.in/' });
  if (!hasAmazonInAuthCookie(cookies.map((cookie) => cookie.name))) {
    throw new AuthRequiredError(DOMAIN, 'Amazon.in login is required before changing the cart');
  }
}

async function selectVariant(page, dimension, requested) {
  if (!requested) return '';
  const result = await page.evaluateWithArgs(`
    (() => {
      const current = (document.querySelector(
        '#inline-twister-expanded-dimension-text-' + dimension + '_name, #variation_' + dimension + '_name .selection'
      )?.textContent || '').trim();
      if (current.toLowerCase() === requested.toLowerCase()) return { current, changed: false };
      const options = [...document.querySelectorAll(
        '#inline-twister-expander-content-' + dimension + '_name span[id^="' + dimension + '_name_"]:not([id$="-announce"])'
      )].filter((node) => !node.classList.contains('aok-hidden'));
      const matches = options.filter((node) => {
        const label = dimension === 'color' ? (node.querySelector('img')?.alt || '') : (node.textContent || '').trim();
        return label.toLowerCase() === requested.toLowerCase();
      });
      if (matches.length !== 1) return { current, changed: false, matches: matches.length };
      (matches[0].querySelector('input') || matches[0]).click();
      return { current, changed: true, matches: 1 };
    })()
  `, { dimension, requested });
  if (!result?.changed && result?.current?.toLowerCase() !== requested.toLowerCase()) {
    throw new ArgumentError(`${dimension === 'color' ? 'colour' : dimension} "${requested}" is not uniquely available`);
  }
  if (result.changed) await page.sleep(2);
  const selected = await page.evaluateWithArgs(`
    (() => (document.querySelector(
      '#inline-twister-expanded-dimension-text-' + dimension + '_name, ' +
      '#variation_' + dimension + '_name .selection'
    )?.textContent || '').trim())()
  `, { dimension });
  if (selected.toLowerCase() !== requested.toLowerCase()) {
    throw new CommandExecutionError(`Amazon did not select ${dimension} "${requested}"`);
  }
  return selected;
}

cli({
  site: SITE,
  name: 'cart-add',
  access: 'write',
  description: 'Add one confirmed Amazon.in product variant to the cart',
  domain: DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  freshPage: true,
  args: [
    { name: 'input', required: true, positional: true, help: 'Amazon.in product URL or ASIN' },
    { name: 'size', help: 'Exact visible size label' },
    { name: 'colour', help: 'Exact visible colour label' },
  ],
  columns: ['status', 'asin', 'title', 'size', 'colour', 'action'],
  func: async (page, args) => {
    let url;
    try { url = buildProductUrl(args.input); } catch (error) { throw new ArgumentError(error.message); }
    await gotoAmazon(page, url, 'cart product');
    await assertAuthenticated(page);
    await selectVariant(page, 'color', args.colour);
    await selectVariant(page, 'size', args.size);
    const selected = await page.evaluate(`
      (() => ({
        asin: (location.pathname.match(/\\/dp\\/([A-Z0-9]{10})/i)?.[1] || document.querySelector('#ASIN')?.value || '').toUpperCase(),
        title: (document.querySelector('#productTitle')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      }))()
    `);
    if (!selected.asin || !selected.title) throw new CommandExecutionError('Amazon product selection could not be verified');
    await page.evaluate(`
      (() => document.querySelector('#add-to-cart-button')?.click())()
    `);
    await page.sleep(2.5);
    const confirmed = await page.evaluate(`
      (() => ({
        url: location.href,
        text: document.body?.innerText || '',
        confirmation: Boolean(document.querySelector('#huc-v2-order-row, #attachDisplayAddBaseAlert')),
      }))()
    `);
    if (!confirmed.confirmation && !/added to cart|added to your cart/i.test(confirmed.text)) {
      throw new CommandExecutionError('Amazon.in did not confirm the item was added to cart');
    }
    return [{ status: 'added', asin: selected.asin, title: selected.title, size: args.size || '', colour: args.colour || '', action: 'Item added to the authenticated Amazon.in cart.' }];
  },
});
