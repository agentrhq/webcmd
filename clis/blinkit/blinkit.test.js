import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { __test__ as authTest } from './auth.js';
import { __test__ as searchTest } from './search.js';
import { __test__ as productTest } from './product.js';
import { __test__ as addToCartTest } from './add-to-cart.js';
import { __test__ as placeOrderTest } from './place-order.js';
import { normalizeLocationState, resolveCoordinates } from './utils.js';
import './cart.js';
import './checkout.js';
import './location.js';

describe('blinkit helpers', () => {
  it('rejects invalid external args before browser work', () => {
    expect(() => searchTest.parseLimit(0)).toThrow(ArgumentError);
    expect(() => searchTest.parseLimit(49)).toThrow(ArgumentError);
    expect(() => searchTest.parseCoordinate('91', 'lat', '28.413333')).toThrow(ArgumentError);
    expect(() => searchTest.parseCoordinate('181', 'lon', '77.072833')).toThrow(ArgumentError);
  });

  it('normalizes product snippets from Blinkit layout search', () => {
    const row = searchTest.normalizeSnippet({
      widget_type: 'product_card_snippet_type_2',
      data: {
        identity: { id: '19512' },
        name: { text: 'Amul Taaza Toned Milk' },
        brand_name: { text: 'Amul' },
        variant: { text: '500 ml' },
        normal_price: { text: '₹30' },
        inventory: 12,
        merchant_id: '31719',
        eta_tag: { title: { text: 'earliest' } },
        image: { url: 'https://cdn.grofers.com/product.png' },
      },
    }, 1);

    expect(row).toMatchObject({
      rank: 1,
      productId: '19512',
      name: 'Amul Taaza Toned Milk',
      brand: 'Amul',
      variant: '500 ml',
      price: 30,
      currency: 'INR',
      inventory: 12,
      available: true,
      url: 'https://blinkit.com/prn/x/prid/19512',
    });
  });

  it('normalizes product detail snippets', () => {
    const row = productTest.normalizeProduct([
      { widget_type: 'text_right_icons_rating_snippet_type', data: { title: { text: 'Amul Taaza Toned Milk' } } },
      {
        widget_type: 'product_atc_strip',
        data: {
          identity: { id: '19512' },
          variant: { text: '500 ml' },
          normal_price: { text: '₹30' },
          product_id: '19512',
          stepper_data_v2: {
            increment_actions: {
              default: [{ add_to_cart: { cart_item: { product_id: 19512, product_name: 'Amul Taaza Toned Milk', price: 30, mrp: 30, unit: '500 ml' } } }],
            },
          },
        },
      },
    ], '19512');
    expect(row).toMatchObject({ productId: '19512', name: 'Amul Taaza Toned Milk', price: 30 });
  });

  it('keeps place-order no-op unless --confirm is passed', async () => {
    const command = getRegistry().get('blinkit/place-order');
    const fakePage = { goto: () => { throw new Error('should not navigate'); } };
    await expect(command.func(fakePage, {})).resolves.toMatchObject([{ status: 'no-op', confirmed: false }]);
  });

  it('builds the cart write script from product payload', () => {
    const script = addToCartTest.buildWriteCartEvaluate({ product_id: 19512, price: 30, mrp: 30, unit: '500 ml' }, 2);
    expect(script).toContain('localStorage.setItem');
    expect(script).toContain('SYNC_CART');
  });

  it('opens the Blinkit login dialog before waiting for OTP', () => {
    const script = authTest.buildOpenLoginEvaluate();
    expect(script).toContain('Login');
    expect(script).toContain('click');
    expect(script).toContain('Enter mobile number');
  });

  it('uses the current Blinkit browser location when coordinates are not explicit', async () => {
    const page = {
      evaluate: async () => ({ lat: 12.9110953, lon: 77.6292907 }),
    };

    await expect(resolveCoordinates(page, {})).resolves.toEqual({ lat: '12.9110953', lon: '77.6292907' });
    await expect(resolveCoordinates(page, { lat: '1', lon: '2' })).resolves.toEqual({ lat: '1', lon: '2' });
  });

  it('normalizes selected location without leaking exact address or coordinates', () => {
    expect(normalizeLocationState({
      address: 'Block C-03 / 79, Private Building',
      city: 'Bengaluru',
      locality: 'HSR Layout',
      pinCode: '560102',
      coords: { lat: 12.9110953, lon: 77.6292907 },
    })).toEqual({
      selected: true,
      label: '',
      area: 'HSR Layout',
      city: 'Bengaluru',
      pincode: '560102',
      hasCoordinates: true,
      source: 'browser',
    });
  });

  it('reports empty checkout instead of failing before items are added', async () => {
    const command = getRegistry().get('blinkit/checkout');
    let readCartState = false;
    const fakePage = {
      goto: async () => {},
      wait: async () => {},
      evaluate: async (script) => {
        if (script.includes('loggedIn')) {
          readCartState = true;
          return {
            ok: true,
            loggedIn: true,
            storedCart: { items: {}, count: 0, total: 0, cart_state: 'valid' },
          };
        }
        if (script.includes('cartResponse')) return false;
        return true;
      },
    };

    await expect(command.func(fakePage, {})).resolves.toMatchObject([{ status: 'empty', itemCount: 0 }]);
    expect(readCartState).toBe(true);
  });
});

describe('blinkit registry shape', () => {
  it('registers the buying-path commands', () => {
    for (const name of ['login', 'whoami', 'location', 'search', 'product', 'add-to-cart', 'cart', 'checkout', 'place-order']) {
      expect(getRegistry().get(`blinkit/${name}`)).toBeDefined();
    }
  });

  it('opens login without waiting for manual authentication', async () => {
    const login = getRegistry().get('blinkit/login');
    const whoami = getRegistry().get('blinkit/whoami');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce({ kind: 'auth', detail: 'Blinkit login button is still visible' })
        .mockResolvedValueOnce({ opened: true }),
    };

    expect(login.args).toEqual([]);
    expect(login.columns).toEqual(expect.arrayContaining(['action', 'verify_command']));
    expect(whoami).toBeDefined();
    await expect(login.func(page, {})).resolves.toEqual([expect.objectContaining({
      status: 'action_required',
      logged_in: false,
      site: 'blinkit',
      verify_command: 'webcmd blinkit whoami',
    })]);
    expect(page.wait).not.toHaveBeenCalledWith(2);
  });

  it('rejects when the Blinkit login dialog cannot be opened', async () => {
    const login = getRegistry().get('blinkit/login');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce({ kind: 'auth', detail: 'login required' })
        .mockResolvedValueOnce({ opened: false, detail: 'login_button_missing' }),
    };

    await expect(login.func(page, {}))
      .rejects.toThrow('Blinkit login dialog did not open: login_button_missing');
  });

  it('marks only cart-changing commands as write', () => {
    expect(getRegistry().get('blinkit/search').access).toBe('read');
    expect(getRegistry().get('blinkit/product').access).toBe('read');
    expect(getRegistry().get('blinkit/location').access).toBe('read');
    expect(getRegistry().get('blinkit/cart').access).toBe('read');
    expect(getRegistry().get('blinkit/checkout').access).toBe('read');
    expect(getRegistry().get('blinkit/login').access).toBe('write');
    expect(getRegistry().get('blinkit/add-to-cart').access).toBe('write');
    expect(getRegistry().get('blinkit/place-order').access).toBe('write');
  });

  it('place-order script only targets final order/payment buttons', () => {
    const script = placeOrderTest.buildPlaceOrderEvaluate();
    expect(script).toContain('place order');
    expect(script).toContain('cash on delivery');
    expect(script).not.toContain('Proceed');
  });
});
