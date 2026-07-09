import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, openCartPanel, readCartState, summarizeCartResponse } from './utils.js';

cli({
  site: 'blinkit',
  name: 'checkout',
  access: 'read',
  description: 'Review Blinkit checkout totals and blockers without placing an order',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  args: [],
  columns: ['status', 'itemCount', 'itemsTotal', 'deliveryCharge', 'handlingCharge', 'payable', 'cartState', 'checkoutBlocked', 'validations'],
  func: async (page) => {
    await openCartPanel(page);
    const state = await readCartState(page);
    const summary = summarizeCartResponse(state);
    return [{
      status: state.loggedIn ? summary.status : 'login_required',
      itemCount: summary.itemCount,
      itemsTotal: summary.itemsTotal,
      deliveryCharge: summary.deliveryCharge,
      handlingCharge: summary.handlingCharge,
      payable: summary.payable,
      cartState: summary.cartState,
      checkoutBlocked: summary.checkoutBlocked,
      validations: summary.validations,
    }];
  },
});
