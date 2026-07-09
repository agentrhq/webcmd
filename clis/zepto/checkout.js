import { AuthRequiredError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CART_EVALUATE, DOMAIN, HOME_URL, SITE, ZEPTO_NAV_OPTIONS, safeGoto } from './utils.js';

const CHECKOUT_EVALUATE = `
  (async () => {
    const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
    const bodyText = clean(document.body?.innerText || document.body?.textContent || '');
    if (/please login|\\bLogin\\b/i.test(bodyText) && /cart is empty|please login/i.test(bodyText)) {
      return { ok: false, stage: 'login', url: location.href };
    }
    const cartButton = Array.from(document.querySelectorAll('button, [role="button"], a')).find((node) => /\\bCart\\b/i.test(clean(node.innerText || node.textContent || node.getAttribute('aria-label'))));
    cartButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const text = clean(document.body?.innerText || document.body?.textContent || '');
    const checkoutButton = Array.from(document.querySelectorAll('button, [role="button"], a')).find((node) => /checkout|proceed|continue/i.test(clean(node.innerText || node.textContent || node.getAttribute('aria-label'))));
    checkoutButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const finalText = clean(document.body?.innerText || document.body?.textContent || '');
    const cart = (${CART_EVALUATE});
    return {
      ok: Boolean(cartButton || checkoutButton || /checkout|payment|address|delivery/i.test(finalText || text)),
      stage: /login|sign\\s*in|please login/i.test(finalText) ? 'login' :
        /address/i.test(finalText) ? 'address' :
        /payment|upi|card|cash/i.test(finalText) ? 'payment-review' :
        /cart is empty/i.test(finalText) ? 'empty' :
        'cart',
      url: location.href,
      item_count: (cart.rows || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    };
  })()
`;

cli({
  site: SITE,
  name: 'checkout',
  access: 'write',
  description: 'Open Zepto checkout review without placing an order',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['ok', 'stage', 'item_count', 'next_action', 'url'],
  func: async (page) => {
    await safeGoto(page, HOME_URL, 'zepto checkout', ZEPTO_NAV_OPTIONS);
    if (page.wait) await page.wait(1);
    const result = await page.evaluate(CHECKOUT_EVALUATE);
    if (result?.stage === 'login') throw new AuthRequiredError(DOMAIN, 'Log into Zepto in the Webcmd browser session to open checkout.');
    return [{
      ok: Boolean(result?.ok),
      stage: result?.stage || 'cart',
      item_count: Number(result?.item_count || 0),
      next_action: 'Complete visible checkout requirements manually; command stops before final submission.',
      url: result?.url || HOME_URL,
    }];
  },
});

export const __test__ = { CHECKOUT_EVALUATE };
