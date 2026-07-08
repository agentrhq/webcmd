import { AuthRequiredError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CART_URL, DOMAIN, parseMoney, safeGoto, SITE } from './utils.js';

export const CHECKOUT_REVIEW_EVALUATE = `
  (async () => {
    const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
    const initialText = clean(document.body?.innerText || '');
    if (/Login\\/ Sign up|Login\\/ Sign Up|Enter Phone number|Using OTP/i.test(initialText)) {
      return { ok: false, stage: 'login', url: location.href };
    }
    const button = Array.from(document.querySelectorAll('button, [role="button"], a')).find((node) => {
      const label = clean(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title'));
      return /checkout|proceed/i.test(label);
    });
    if (button) {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const text = clean(document.body?.innerText || '');
    const money = text.match(/(?:₹|Rs\\.?)[\\s\\d,.]+/gi) || [];
    const addressReady = /address|deliver/i.test(text) && !/add\\s+address|select\\s+address/i.test(text);
    const deliveryReady = /delivery|slot/i.test(text) && !/select\\s+(?:delivery|slot)/i.test(text);
    const paymentReady = /payment|upi|card|cash/i.test(text);
    const stage = /login|sign\\s*in|mobile number/i.test(text) ? 'login' :
      /address/i.test(text) ? 'address' :
      /delivery|slot/i.test(text) ? 'delivery' :
      /payment|upi|card|cash/i.test(text) ? 'payment-review' :
      'cart';
    return {
      ok: Boolean(button || /checkout|payment|address|delivery/i.test(text)),
      stage,
      cart_total: money[money.length - 1] || '',
      address_ready: addressReady,
      delivery_ready: deliveryReady,
      payment_ready: paymentReady,
      next_action: paymentReady ? 'Review payment options manually; command stops before final submission.' : 'Complete the visible checkout requirement manually.',
      url: location.href,
    };
  })()
`;

cli({
  site: SITE,
  name: 'checkout',
  access: 'write',
  description: 'Open BigBasket checkout review without placing an order',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['ok', 'stage', 'cart_total', 'address_ready', 'delivery_ready', 'payment_ready', 'next_action', 'url'],
  func: async (page) => {
    await safeGoto(page, CART_URL, 'bigbasket checkout');
    if (page.wait) await page.wait(2);
    const result = await page.evaluate(CHECKOUT_REVIEW_EVALUATE);
    if ((result?.stage === 'login' && result?.ok === false) || result?.authRequired === true) {
      throw new AuthRequiredError('bigbasket.com', 'Log into BigBasket in the Webcmd browser session to open checkout review.');
    }
    return [{
      ok: Boolean(result?.ok),
      stage: result?.stage || 'cart',
      cart_total: parseMoney(result?.cart_total),
      address_ready: Boolean(result?.address_ready),
      delivery_ready: Boolean(result?.delivery_ready),
      payment_ready: Boolean(result?.payment_ready),
      next_action: result?.next_action || 'Open BigBasket checkout manually.',
      url: result?.url || CART_URL,
    }];
  },
});
