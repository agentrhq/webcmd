import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, ensureCartHasItems, ensureLoggedIn, openCartPanel, readCartState, summarizeCartResponse } from './utils.js';

function buildPlaceOrderEvaluate() {
  return `
    (async () => {
      const finalLabels = [/^place order$/i, /^pay( now)?$/i, /^cash on delivery$/i];
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const target = buttons.find((node) => {
        const text = (node.innerText || node.textContent || '').trim().replace(/\\s+/g, ' ');
        return text && finalLabels.some((pattern) => pattern.test(text));
      });
      if (!target) {
        return { ok: false, status: 'blocked', message: 'No final place-order/payment button is visible. Complete address/payment selection in the browser checkout first.' };
      }
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const text = document.body.innerText || '';
      const orderMatch = text.match(/order(?:\\s+id)?[:#\\s-]*([A-Z0-9-]{6,})/i);
      if (/payment failed|try again|could not/i.test(text)) {
        return { ok: false, status: 'failed', message: 'Blinkit reported a payment/order failure', url: location.href };
      }
      return { ok: true, status: orderMatch ? 'placed' : 'submitted', orderId: orderMatch?.[1] || '', url: location.href };
    })()
  `;
}

cli({
  site: 'blinkit',
  name: 'place-order',
  access: 'write',
  description: 'Submit the visible Blinkit final order/payment action. Requires --confirm.',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  args: [
    { name: 'confirm', type: 'bool', default: false, help: 'Required acknowledgement that this may place/pay for a real order' },
  ],
  columns: ['status', 'confirmed', 'itemCount', 'payable', 'orderId', 'url', 'message'],
  func: async (page, kwargs) => {
    if (!kwargs.confirm) {
      return [{
        status: 'no-op',
        confirmed: false,
        message: 'Pass --confirm to submit a real Blinkit order/payment action.',
      }];
    }
    if (kwargs.confirm !== true) throw new ArgumentError('--confirm must be a boolean flag');

    await openCartPanel(page);
    const state = await readCartState(page);
    ensureLoggedIn(state, 'blinkit place-order');
    const summary = summarizeCartResponse(state);
    ensureCartHasItems(summary);
    if (summary.checkoutBlocked) throw new CommandExecutionError('Blinkit checkout is blocked for this cart');

    const result = await page.evaluate(buildPlaceOrderEvaluate()).catch((error) => {
      throw new CommandExecutionError(`blinkit place-order failed: ${error?.message || error}`);
    });
    if (!result?.status) throw new CommandExecutionError('blinkit place-order returned no status');
    return [{
      status: result.status,
      confirmed: true,
      itemCount: summary.itemCount,
      payable: summary.payable,
      orderId: result.orderId || '',
      url: result.url || '',
      message: result.message || '',
    }];
  },
});

export const __test__ = {
  buildPlaceOrderEvaluate,
};
