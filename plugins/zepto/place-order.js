import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, HOME_URL, SITE, ZEPTO_NAV_OPTIONS, safeGoto } from './utils.js';

function parseConfirm(raw) {
  return raw === true || raw === 'true' || raw === '1' || raw === 1;
}

function placeOrderEvaluate() {
  return `
    (() => {
      const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
      const button = Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => /^(place order|pay now|make payment)$/i.test(clean(node.innerText || node.textContent || node.getAttribute('aria-label'))));
      if (!button) return { ok: false, status: 'blocked', message: 'No final place-order/payment button is visible.' };
      button.click();
      return { ok: true, status: 'submitted', message: 'Clicked final Zepto order/payment button.' };
    })()
  `;
}

cli({
  site: SITE,
  name: 'place-order',
  access: 'write',
  description: 'Submit a real Zepto order only when --confirm true is passed',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'confirm', type: 'boolean', default: false, help: 'Required. Set true to submit a real Zepto order/payment action.' },
  ],
  columns: ['status', 'confirmed', 'message'],
  func: async (page, kwargs) => {
    if (!parseConfirm(kwargs.confirm)) {
      return [{ status: 'no-op', confirmed: false, message: 'Pass --confirm true to submit a real Zepto order/payment action.' }];
    }
    await safeGoto(page, HOME_URL, 'zepto place-order', ZEPTO_NAV_OPTIONS);
    const result = await page.evaluate(placeOrderEvaluate()).catch((error) => {
      throw new CommandExecutionError(`zepto place-order failed: ${error?.message || error}`);
    });
    if (!result?.ok) throw new CommandExecutionError(result?.message || 'No final Zepto place-order/payment button is visible.');
    return [{ status: result.status || 'submitted', confirmed: true, message: result.message || 'Submitted Zepto order.' }];
  },
});

export const __test__ = { placeOrderEvaluate };
