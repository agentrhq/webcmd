import { AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { classifyCheckoutSnapshot } from './parsers.js';
import { DOMAIN, SITE } from './shared.js';

cli({
  site: SITE,
  name: 'checkout-status',
  access: 'read',
  description: 'Read the current Amazon.in checkout or payment state without clicking',
  domain: DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [],
  columns: ['status', 'order_id', 'total', 'payment_method', 'action'],
  func: async (page) => {
    const snapshot = await page.evaluate(`
      (() => {
        const body = document.body?.innerText || '';
        const rows = [...document.querySelectorAll('#subtotals-marketplace-table li')];
        const total = rows.find((node) => /^Order Total:/i.test((node.textContent || '').trim()));
        const selectedPayment = document.querySelector('#selected-payment-methods-list-container');
        const checkedPayment = document.querySelector(
          '#checkout-paymentOptionPanel input[type="radio"]:checked, input[name*="payment"]:checked'
        );
        const payment = selectedPayment ||
          checkedPayment?.closest('label, [data-testid*="payment"], .pmts-instrument-box');
        const order = document.querySelector('[data-order-id], #orderDetails, .order-number');
        return {
          url: location.href,
          paymentText: payment?.textContent || '',
          text: [
            total?.textContent || '',
            order?.textContent || '',
            body,
          ].join('\\n'),
        };
      })()
    `);
    try {
      const row = classifyCheckoutSnapshot(snapshot);
      if (row.status === 'login_required') throw new AuthRequiredError(DOMAIN);
      return [row];
    } catch (error) {
      if (error instanceof AuthRequiredError) throw error;
      throw new CommandExecutionError(
        `Amazon checkout status could not be classified: ${error.message}`,
        'Keep the checkout or payment page open in the persistent Webcmd browser and retry.',
      );
    }
  },
});
