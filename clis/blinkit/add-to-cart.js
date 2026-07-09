import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  DOMAIN,
  ensureCartHasItems,
  openCartPanel,
  parseQuantity,
  readCartState,
  requireProductId,
  resolveCoordinates,
  summarizeCartResponse,
} from './utils.js';

function buildCartItemEvaluate(productId, lat, lon) {
  return `
    (async () => {
      const headers = { lat: ${JSON.stringify(lat)}, lon: ${JSON.stringify(lon)}, app_client: 'consumer_web' };
      const resp = await fetch('/v1/layout/product/' + ${JSON.stringify(productId)}, { method: 'POST', credentials: 'include', headers });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json) return { ok: false, status: resp.status };
      const snippets = json?.response?.snippets || [];
      const strip = snippets.find((snippet) => snippet?.widget_type === 'product_atc_strip')?.data || {};
      const action = strip.stepper_data_v2?.increment_actions?.default?.find((item) => item?.add_to_cart)
        || strip.rfc_actions_v2?.default?.find((item) => item?.remove_from_cart);
      const cartItem = action?.add_to_cart?.cart_item || action?.remove_from_cart?.cart_item || null;
      return [Boolean(cartItem), resp.status, cartItem, strip.inventory, strip.is_sold_out === true];
    })()
  `;
}

function buildWriteCartEvaluate(cartItem, quantity) {
  return `
    (() => {
      const cartItem = ${JSON.stringify(cartItem)};
      const quantity = ${quantity};
      const readJson = (key, fallback) => {
        try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch { return fallback; }
      };
      const cart = readJson('cart', { count: 0, total: 0, chargeableDeliveryCost: 0, items: {}, promoInfo: [], paymentMode: null, step: [], version: 1, promo_id: '', CartAddressScreenVisible: false, uniqueSkuInCart: 0, cart_type: '', cart_state: 'invalid' });
      const id = String(cartItem.product_id);
      const current = cart.items?.[id]?.quantity || 0;
      cart.items = cart.items || {};
      cart.items[id] = {
        product: {
          product_id: cartItem.product_id,
          price: cartItem.price,
          image_url: cartItem.image_url,
          unit: cartItem.unit,
          mrp: cartItem.mrp,
          group_id: cartItem.group_id,
          merchant_id: cartItem.merchant_id,
          name: cartItem.product_name || cartItem.display_name,
          brand: cartItem.brand
        },
        quantity: current + quantity
      };
      const values = Object.values(cart.items);
      cart.count = values.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      cart.total = values.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.product?.price || 0), 0);
      cart.uniqueSkuInCart = values.length;
      cart.version = 1;
      localStorage.setItem('cart', JSON.stringify(cart));
      window.__reduxStore__?.dispatch?.({ type: 'SYNC_CART', cart });
      return [true, id, cart.items[id].quantity, cart.count, cart.total];
    })()
  `;
}

cli({
  site: 'blinkit',
  name: 'add-to-cart',
  access: 'write',
  description: 'Add a Blinkit product to cart',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'productId', required: true, positional: true, help: 'Blinkit product id' },
    { name: 'quantity', type: 'int', default: 1, help: 'Quantity to add (default 1, max 12)' },
    { name: 'lat', help: 'Delivery latitude (defaults to current Blinkit browser location)' },
    { name: 'lon', help: 'Delivery longitude (defaults to current Blinkit browser location)' },
  ],
  columns: ['status', 'productId', 'quantity', 'itemCount', 'itemsTotal', 'payable', 'message'],
  func: async (page, kwargs) => {
    const productId = requireProductId(kwargs.productId);
    const quantity = parseQuantity(kwargs.quantity);

    await page.goto(`https://blinkit.com/prn/x/prid/${productId}`).catch((error) => {
      throw new CommandExecutionError(`blinkit add-to-cart navigation failed: ${error?.message || error}`);
    });
    const { lat, lon } = await resolveCoordinates(page, kwargs);
    const found = await page.evaluate(buildCartItemEvaluate(productId, lat, lon)).catch((error) => {
      throw new CommandExecutionError(`blinkit add-to-cart product read failed: ${error?.message || error}`);
    });
    const [foundOk, , cartItem, , soldOut] = Array.isArray(found) ? found : [];
    if (!foundOk || !cartItem) throw new EmptyResultError('blinkit add-to-cart', `No cart payload for product ${productId}`);
    if (soldOut) throw new CommandExecutionError(`Product ${productId} is sold out`);

    const updated = await page.evaluate(buildWriteCartEvaluate(cartItem, quantity)).catch((error) => {
      throw new CommandExecutionError(`blinkit add-to-cart write failed: ${error?.message || error}`);
    });
    const [updatedOk, , updatedQuantity] = Array.isArray(updated) ? updated : [];
    if (!updatedOk) throw new CommandExecutionError(`Could not add product ${productId} to cart`);

    await openCartPanel(page);
    const summary = summarizeCartResponse(await readCartState(page));
    ensureCartHasItems(summary);
    return [{
      status: 'added',
      productId,
      quantity: updatedQuantity,
      itemCount: summary.itemCount,
      itemsTotal: summary.itemsTotal,
      payable: summary.payable,
      message: `Added ${quantity}`,
    }];
  },
});

export const __test__ = {
  buildWriteCartEvaluate,
};
