import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const BASE = 'https://blinkit.com';
export const DOMAIN = 'blinkit.com';
export const DEFAULT_LAT = '28.413333';
export const DEFAULT_LON = '77.072833';
export const MAX_LIMIT = 48;

export function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return 20;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

export function parseQuantity(raw) {
  const quantity = raw === undefined || raw === null || raw === '' ? 1 : Number(raw);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 12) {
    throw new ArgumentError('--quantity must be an integer between 1 and 12');
  }
  return quantity;
}

export function parseCoordinate(raw, label, fallback) {
  const value = raw === undefined || raw === null || raw === '' ? fallback : String(raw);
  const n = Number(value);
  const max = label === 'lat' ? 90 : 180;
  if (!Number.isFinite(n) || n < -max || n > max) {
    throw new ArgumentError(`--${label} must be a number between ${-max} and ${max}`);
  }
  return String(n);
}

export async function resolveCoordinates(page, kwargs = {}) {
  const explicitLat = kwargs.lat !== undefined && kwargs.lat !== null && kwargs.lat !== '';
  const explicitLon = kwargs.lon !== undefined && kwargs.lon !== null && kwargs.lon !== '';
  const location = explicitLat && explicitLon ? null : await page.evaluate(`
    (() => {
      const readJson = (key) => {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
      };
      const coords = window.__reduxStore__?.getState?.()?.data?.location?.coords || readJson('location')?.coords || {};
      return { lat: coords.lat, lon: coords.lon };
    })()
  `).catch(() => null);
  return {
    lat: parseCoordinate(explicitLat ? kwargs.lat : location?.lat, 'lat', DEFAULT_LAT),
    lon: parseCoordinate(explicitLon ? kwargs.lon : location?.lon, 'lon', DEFAULT_LON),
  };
}

export function normalizeLocationState(location = {}) {
  const coords = location.coords || {};
  return {
    selected: Boolean(location.locality || location.area || location.city || location.pinCode || location.pincode || coords.lat || coords.lon),
    label: String(location.label || location.name || location.type || '').trim(),
    area: String(location.locality || location.area || location.landmark || '').trim(),
    city: String(location.city || location.cityName || '').trim(),
    pincode: String(location.pinCode || location.pincode || location.pin || '').trim(),
    hasCoordinates: Boolean(coords.lat || coords.lon),
    source: 'browser',
  };
}

export function requireProductId(raw) {
  const value = String(raw ?? '').trim();
  const match = value.match(/(?:prid\/)?(\d{3,})$/) || value.match(/\/prid\/(\d{3,})/);
  if (!match) throw new ArgumentError('productId must be a Blinkit product id, for example 19512');
  return match[1];
}

export function parsePrice(text) {
  const match = String(text ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function text(node) {
  return String(node?.text ?? '').trim();
}

export function productUrl(productId) {
  return productId ? `${BASE}/prn/x/prid/${productId}` : '';
}

export function normalizeProductSnippet(snippet, rank = undefined) {
  const data = snippet?.data ?? {};
  const cart = data.atc_action?.add_to_cart?.cart_item
    ?? data.stepper_data_v2?.increment_actions?.default?.find((action) => action?.add_to_cart)?.add_to_cart?.cart_item
    ?? data.rfc_actions_v2?.default?.find((action) => action?.remove_from_cart)?.remove_from_cart?.cart_item
    ?? {};
  const productId = String(data.product_id ?? data.meta?.product_id ?? cart.product_id ?? data.identity?.id ?? '').trim();
  const name = text(data.display_name) || text(data.name) || text(data.title) || String(cart.product_name ?? cart.display_name ?? '').trim();
  if (!productId || !name) return null;

  const price = cart.price ?? parsePrice(text(data.normal_price) || text(data.info_text));
  const mrp = cart.mrp ?? parsePrice(text(data.mrp));
  return {
    ...(rank === undefined ? {} : { rank }),
    productId,
    name,
    brand: text(data.brand_name) || String(cart.brand ?? '').trim(),
    variant: text(data.variant) || String(cart.unit ?? '').trim(),
    price: Number.isFinite(Number(price)) ? Number(price) : null,
    mrp: Number.isFinite(Number(mrp)) ? Number(mrp) : null,
    currency: 'INR',
    inventory: Number.isFinite(Number(data.inventory ?? cart.inventory)) ? Number(data.inventory ?? cart.inventory) : null,
    available: data.is_sold_out === true ? false : data.product_state !== 'unavailable',
    imageUrl: data.image?.url || cart.image_url || '',
    url: productUrl(productId),
  };
}

export function normalizeCartItem(item, fallbackId = '') {
  const product = item?.product ?? item ?? {};
  const productId = String(product.product_id ?? item?.product_id ?? fallbackId ?? '').trim();
  const quantity = Number(item?.quantity ?? product.quantity ?? 0);
  if (!productId || !quantity) return null;
  const price = Number(product.price ?? product.unit_price ?? parsePrice(product.total_price));
  return {
    productId,
    name: String(product.name ?? product.product_name ?? product.display_name ?? '').trim(),
    variant: String(product.unit ?? '').trim(),
    price: Number.isFinite(price) ? price : null,
    quantity,
    total: Number.isFinite(price) ? price * quantity : null,
    inventory: Number.isFinite(Number(product.inventory_limit ?? product.inventory)) ? Number(product.inventory_limit ?? product.inventory) : null,
    merchantId: String(product.merchant_id ?? '').trim(),
    imageUrl: product.image_url || product.image_url_v2 || product.png_image_url || '',
  };
}

export function summarizeCartResponse(response) {
  const cartData = response?.cart_data ?? {};
  const bill = cartData.bill_details ?? {};
  const items = Array.isArray(cartData.items)
    ? cartData.items.map((item) => normalizeCartItem(item)).filter(Boolean)
    : [];
  const storedItems = response?.storedCart?.items && typeof response.storedCart.items === 'object'
    ? Object.entries(response.storedCart.items).map(([id, item]) => normalizeCartItem(item, id)).filter(Boolean)
    : [];
  const finalItems = items.length ? items : storedItems;
  return {
    status: finalItems.length ? 'ok' : 'empty',
    itemCount: Number(bill.total_items ?? response?.storedCart?.count ?? finalItems.reduce((sum, item) => sum + item.quantity, 0) ?? 0),
    itemsTotal: Number(bill.total_cost ?? response?.storedCart?.total ?? 0),
    deliveryCharge: Number(bill.delivery_charge ?? 0),
    handlingCharge: Number(bill.additional_charge ?? 0),
    payable: Number(bill.payable_amount ?? bill.bill_total ?? response?.storedCart?.total ?? 0),
    cartState: response?.cart_state ?? cartData.cart_state ?? response?.storedCart?.cart_state ?? '',
    checkoutBlocked: Boolean(cartData.checkout_block_details),
    validations: (cartData.validations ?? []).map((validation) => validation?.code).filter(Boolean).join(','),
    items: finalItems,
  };
}

export async function gotoBlinkit(page, path = '/') {
  await page.goto(`${BASE}${path}`).catch((error) => {
    throw new CommandExecutionError(`blinkit navigation failed: ${error?.message || error}`);
  });
}

export async function openCartPanel(page) {
  await gotoBlinkit(page, '/');
  await page.wait(1);
  await page.evaluate(`
    (() => {
      const nodes = Array.from(document.querySelectorAll('[role="button"], header div, header button, header a'));
      const target = nodes
        .filter((node) => {
          const value = node.innerText || node.textContent || '';
          return /My Cart/i.test(value) || (/\\d+\\s+items?/i.test(value) && /₹\\s*\\d+/i.test(value));
        })
        .sort((a, b) => (a.innerText || a.textContent || '').length - (b.innerText || b.textContent || '').length)[0];
      target?.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return Boolean(target);
    })()
  `).catch((error) => {
    throw new CommandExecutionError(`blinkit cart open failed: ${error?.message || error}`);
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.wait(1);
    const ready = await page.evaluate(`
      (() => Boolean(window.__reduxStore__?.getState?.()?.ui?.cart?.cartScreen?.cartResponse?.cart_data))
    `).catch(() => false);
    if (ready) return;
  }
}

export async function readCartState(page) {
  const result = await page.evaluate(`
    (() => {
      const readJson = (key) => {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
      };
      const state = window.__reduxStore__?.getState?.();
      const response = state?.ui?.cart?.cartScreen?.cartResponse || null;
      return {
        ok: true,
        loggedIn: !/^Login$/m.test(document.body.innerText || '') && Boolean(readJson('auth')?.accessToken || state?.data?.auth?.accessToken),
        response,
        storedCart: state?.data?.cart || readJson('cart') || null,
        checkout: state?.ui?.checkout || readJson('checkout') || null,
        location: state?.data?.location || readJson('location') || null,
      };
    })()
  `).catch((error) => {
    throw new CommandExecutionError(`blinkit cart state read failed: ${error?.message || error}`);
  });
  if (!result?.ok) throw new CommandExecutionError('blinkit cart state read failed');
  return result;
}

export function ensureLoggedIn(state, action = 'Blinkit command') {
  if (!state?.loggedIn) {
    throw new AuthRequiredError(DOMAIN, `${action} requires a logged-in Blinkit browser session. Run webcmd blinkit login first.`);
  }
}

export function ensureCartHasItems(summary) {
  if (!summary.itemCount) throw new EmptyResultError('blinkit cart', 'Cart is empty');
}
