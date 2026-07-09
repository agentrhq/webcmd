import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, AuthRequiredError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './auth.js';
import './location.js';
import './search.js';
import './product.js';
import './add-to-cart.js';
import './cart.js';
import './checkout.js';
import './place-order.js';
import {
  CART_EVALUATE,
  buildSearchUrl,
  normalizeLocationState,
  normalizeProductRow,
  parseLimitArg,
  parseQuantityArg,
  productCardsEvaluate,
  resolveProductInput,
  safeGoto,
} from './utils.js';

describe('zepto helpers', () => {
  it('builds search URLs and validates numeric args', () => {
    expect(buildSearchUrl('amul milk')).toBe('https://www.zepto.com/search?query=amul%20milk');
    expect(() => buildSearchUrl('   ')).toThrow(ArgumentError);
    expect(() => parseLimitArg(0, 20, 50)).toThrow(ArgumentError);
    expect(() => parseLimitArg(51, 20, 50)).toThrow(ArgumentError);
    expect(() => parseQuantityArg(0, 1, 12)).toThrow(ArgumentError);
  });

  it('parses product pvids and URLs', () => {
    expect(resolveProductInput('https://www.zepto.com/pn/rin/pvid/5f54bb83-f3e0-4d8d-89b0-6339f3312089')).toMatchObject({
      productId: '5f54bb83-f3e0-4d8d-89b0-6339f3312089',
      url: 'https://www.zepto.com/pn/rin/pvid/5f54bb83-f3e0-4d8d-89b0-6339f3312089',
    });
    expect(() => resolveProductInput('5f54bb83-f3e0-4d8d-89b0-6339f3312089')).toThrow(ArgumentError);
  });

  it('normalizes product rows', () => {
    expect(normalizeProductRow({
      product_id: '5f54bb83-f3e0-4d8d-89b0-6339f3312089',
      title: 'Rin Matic Top Load Detergent Liquid | Pouch',
      pack_size: '1 pack (2 kg)',
      price: '₹179',
      mrp: '₹260',
      url: '/pn/rin/pvid/5f54bb83-f3e0-4d8d-89b0-6339f3312089',
    }, 0)).toMatchObject({
      rank: 1,
      product_id: '5f54bb83-f3e0-4d8d-89b0-6339f3312089',
      price: 179,
      mrp: 260,
      url: 'https://www.zepto.com/pn/rin/pvid/5f54bb83-f3e0-4d8d-89b0-6339f3312089',
    });
  });

  it('extracts rendered product cards', () => {
    const dom = new JSDOM(`
      <a href="/pn/rin/pvid/5f54bb83-f3e0-4d8d-89b0-6339f3312089">
        <div>
          <button>ADD</button>
          <span>₹ 179</span><span>₹ 260</span>
          <span>Rin Matic Top Load Detergent Liquid | Pouch</span>
          <span>1 pack (2 kg)</span>
        </div>
      </a>
    `, { runScripts: 'outside-only', url: 'https://www.zepto.com/search?query=rin' });

    const result = dom.window.eval(productCardsEvaluate(5));

    expect(result.rows[0]).toMatchObject({
      product_id: '5f54bb83-f3e0-4d8d-89b0-6339f3312089',
      title: 'Rin Matic Top Load Detergent Liquid | Pouch',
      price: '₹ 179',
      mrp: '₹ 260',
    });
  });

  it('normalizes selected location without leaking exact coordinates', () => {
    expect(normalizeLocationState({
      addressText: 'Home: HSR Layout, Bengaluru',
      userPosition: { latitude: 12.911, longitude: 77.629 },
    })).toEqual({
      selected: true,
      label: 'Home',
      area: '',
      city: 'Bengaluru',
      pincode: '',
      hasCoordinates: true,
      source: 'browser',
    });
  });

  it('redacts exact house and floor details from location output', () => {
    expect(normalizeLocationState({
      addressText: 'home - House number - 5, Floor - 5th, HSR Layout, Bengaluru, India',
      userPosition: { latitude: 12.911, longitude: 77.629 },
    })).toEqual({
      selected: true,
      label: 'Home',
      area: '',
      city: 'Bengaluru',
      pincode: '',
      hasCoordinates: true,
      source: 'browser',
    });
  });

  it('does not treat the Select Location placeholder as selected', () => {
    expect(normalizeLocationState({ addressText: 'Select Location' })).toEqual({
      selected: false,
      label: '',
      area: '',
      city: '',
      pincode: '',
      hasCoordinates: false,
      source: 'browser',
    });
  });

  it('tolerates Zepto SPA navigation aborts but keeps real navigation failures', async () => {
    await expect(safeGoto({
      goto: async () => { throw new Error('page.goto: net::ERR_ABORTED at https://www.zepto.com/'); },
    }, 'https://www.zepto.com/', 'zepto cart')).resolves.toBeUndefined();

    await expect(safeGoto({
      goto: async () => { throw new Error('page.goto: net::ERR_NAME_NOT_RESOLVED'); },
    }, 'https://www.zepto.com/', 'zepto cart')).rejects.toThrow('zepto cart navigation failed');
  });

  it('extracts cart items from Zepto cart storage without recommendations', () => {
    const cart = {
      state: {
        cartContent: {
          '5f54bb83-f3e0-4d8d-89b0-6339f3312089': {
            quantity: 2,
            productVariant: {
              id: '5f54bb83-f3e0-4d8d-89b0-6339f3312089',
              name: 'Rin Matic Top Load Detergent Liquid | Pouch',
              formattedPacksize: '1 pack (2 kg)',
              price: 17900,
              mrp: 26000,
            },
          },
        },
      },
    };
    const dom = new JSDOM('', { runScripts: 'outside-only', url: 'https://www.zepto.com/' });
    dom.window.localStorage.setItem('cart', JSON.stringify(cart));

    const result = dom.window.eval(CART_EVALUATE);

    expect(result.rows).toEqual([expect.objectContaining({
      product_id: '5f54bb83-f3e0-4d8d-89b0-6339f3312089',
      title: 'Rin Matic Top Load Detergent Liquid | Pouch',
      quantity: 2,
      price: 179,
    })]);
  });

  it('extracts top-level Zepto cart item fields', () => {
    const cart = {
      state: {
        cartContent: {
          'ba77f9b3-0525-4ce8-bc4b-a2480419b780': {
            quantity: 1,
            title: 'Godrej Jersey Toned Fresh Milk | Pouch',
            productVariantId: 'ba77f9b3-0525-4ce8-bc4b-a2480419b780',
            quantityText: '1 pack (490 ml or 500 ml)',
            superSaverSellingPrice: 2600,
            mrp: 2700,
          },
        },
      },
    };
    const dom = new JSDOM('', { runScripts: 'outside-only', url: 'https://www.zepto.com/' });
    dom.window.localStorage.setItem('cart', JSON.stringify(cart));

    const result = dom.window.eval(CART_EVALUATE);

    expect(result.rows).toEqual([expect.objectContaining({
      product_id: 'ba77f9b3-0525-4ce8-bc4b-a2480419b780',
      title: 'Godrej Jersey Toned Fresh Milk | Pouch',
      pack_size: '1 pack (490 ml or 500 ml)',
      quantity: 1,
      price: 26,
      mrp: 27,
    })]);
  });
});

describe('zepto registry shape', () => {
  it('registers the buying-path commands', () => {
    for (const name of ['login', 'location', 'search', 'product', 'add-to-cart', 'cart', 'checkout', 'place-order']) {
      expect(getRegistry().get(`zepto/${name}`)).toBeDefined();
    }
  });

  it('marks only cart-changing commands as write', () => {
    expect(getRegistry().get('zepto/location').access).toBe('read');
    expect(getRegistry().get('zepto/search').access).toBe('read');
    expect(getRegistry().get('zepto/product').access).toBe('read');
    expect(getRegistry().get('zepto/cart').access).toBe('read');
    expect(getRegistry().get('zepto/login').access).toBe('write');
    expect(getRegistry().get('zepto/add-to-cart').access).toBe('write');
    expect(getRegistry().get('zepto/checkout').access).toBe('write');
    expect(getRegistry().get('zepto/place-order').access).toBe('write');
  });

  it('lets commands own Zepto navigation instead of framework pre-navigation', () => {
    for (const name of ['login', 'location', 'search', 'product', 'add-to-cart', 'cart', 'checkout', 'place-order']) {
      expect(getRegistry().get(`zepto/${name}`).navigateBefore).toBe(false);
    }
  });
});

describe('zepto command behavior', () => {
  it('search reports auth-required when Zepto blocks web search', async () => {
    const command = getRegistry().get('zepto/search');
    const calls = [];
    const fakePage = {
      goto: async (...args) => { calls.push(args); },
      wait: async () => {},
      evaluate: async () => ({ authRequired: true, rows: [] }),
    };

    await expect(command.func(fakePage, { query: 'milk' })).rejects.toThrow(AuthRequiredError);
    expect(calls[0]).toEqual(['https://www.zepto.com/search?query=milk', { waitUntil: 'none', settleMs: 1500 }]);
  });

  it('keeps place-order no-op unless --confirm is passed', async () => {
    const command = getRegistry().get('zepto/place-order');
    const fakePage = { goto: () => { throw new Error('should not navigate'); } };
    await expect(command.func(fakePage, {})).resolves.toMatchObject([{ status: 'no-op', confirmed: false }]);
  });
});
