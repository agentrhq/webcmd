import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, openCartPanel, readCartState, summarizeCartResponse } from './utils.js';

cli({
  site: 'blinkit',
  name: 'cart',
  access: 'read',
  description: 'Show the current Blinkit cart',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['status', 'productId', 'name', 'variant', 'price', 'quantity', 'total', 'itemCount', 'payable', 'cartState'],
  func: async (page) => {
    await openCartPanel(page);
    const summary = summarizeCartResponse(await readCartState(page));
    if (!summary.items.length) {
      return [{ status: 'empty', itemCount: 0, payable: summary.payable, cartState: summary.cartState }];
    }
    return summary.items.map((item) => ({
      status: summary.status,
      productId: item.productId,
      name: item.name,
      variant: item.variant,
      price: item.price,
      quantity: item.quantity,
      total: item.total,
      itemCount: summary.itemCount,
      payable: summary.payable,
      cartState: summary.cartState,
    }));
  },
});
