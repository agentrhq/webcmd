import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './search.js';
import './category.js';
import './product.js';
import './add-to-cart.js';
import './cart.js';
import './checkout.js';
import './location.js';
import { CART_EVALUATE } from './cart.js';
import { CHECKOUT_REVIEW_EVALUATE } from './checkout.js';
import {
  buildSearchUrl,
  normalizeLocationState,
  normalizeProductRow,
  parseLimitArg,
  parseQuantityArg,
  productCardsEvaluate,
  resolveCategoryUrl,
  resolveProductInput,
} from './utils.js';

describe('bigbasket helpers', () => {
  it('builds search and category URLs', () => {
    expect(buildSearchUrl('amul milk')).toContain('/ps/?q=amul%20milk');
    expect(resolveCategoryUrl('/pc/fruits-vegetables/vegetables/')).toBe('https://www.bigbasket.com/pc/fruits-vegetables/vegetables/');
    expect(resolveCategoryUrl('fruits-vegetables/vegetables')).toBe('https://www.bigbasket.com/pc/fruits-vegetables/vegetables/');
  });

  it('parses product ids and URLs', () => {
    expect(resolveProductInput('https://www.bigbasket.com/pd/40022638/fresho-banana-robusta-1-kg/')).toMatchObject({
      productId: '40022638',
      url: 'https://www.bigbasket.com/pd/40022638/fresho-banana-robusta-1-kg/',
    });
    expect(resolveProductInput('40022638')).toEqual({
      productId: '40022638',
      url: 'https://www.bigbasket.com/pd/40022638/',
    });
  });

  it('fails fast on bad numbers and malformed inputs', () => {
    expect(() => buildSearchUrl('   ')).toThrow(ArgumentError);
    expect(() => resolveProductInput('banana')).toThrow(ArgumentError);
    expect(() => parseLimitArg(0, 20, 50)).toThrow(ArgumentError);
    expect(() => parseLimitArg(51, 20, 50)).toThrow(ArgumentError);
    expect(() => parseQuantityArg(0, 1, 20)).toThrow(ArgumentError);
  });

  it('normalizes product rows', () => {
    expect(normalizeProductRow({
      product_id: '40022638',
      title: 'Fresho Banana',
      brand: 'Fresho',
      pack_size: '1 kg',
      price: '₹54',
      mrp: '₹70',
      discount: '23% OFF',
      availability: 'In stock',
      url: '/pd/40022638/fresho-banana/',
    }, 0)).toEqual({
      rank: 1,
      product_id: '40022638',
      title: 'Fresho Banana',
      brand: 'Fresho',
      pack_size: '1 kg',
      price: 54,
      mrp: 70,
      discount: '23% OFF',
      availability: 'In stock',
      url: 'https://www.bigbasket.com/pd/40022638/fresho-banana/',
    });
  });

  it('normalizes schema availability URLs', () => {
    expect(normalizeProductRow({
      product_id: '40090893',
      title: 'Amul Gold Full Cream Milk',
      availability: 'https://schema.org/InStock',
      url: '/pd/40090893/amul-amul-gold/',
    }, 0).availability).toBe('In stock');
  });

  it('normalizes selected location without leaking full address fields', () => {
    expect(normalizeLocationState({
      selectedAddressInfo: JSON.stringify({
        nick: 'Home',
        area: 'NTPC Township',
        city_name: 'Noida',
        pin: 201307,
        address1: 'Block C-03 / 79',
        address2: 'Samridhi',
        landmark: 'Near something',
        lat: 28.586165986798466,
        lng: 77.35627826303244,
        member: { full_name: 'Private Name' },
      }),
      selected_address_id: '218320015',
    })).toEqual({
      selected: true,
      label: 'Home',
      area: 'NTPC Township',
      city: 'Noida',
      pincode: '201307',
      source: 'selectedAddressInfo',
    });
  });

  it('extracts product title when image anchor appears before title anchor', () => {
    const dom = new JSDOM(`
      <ul>
        <li>
          <div><a href="/pd/40090893/amul-amul-gold-500-ml-pouch/"><img alt="milk"></a></div>
          <h3>
            <a href="/pd/40090893/amul-amul-gold-500-ml-pouch/">
              <span>Amul</span>
              <div><h3>Gold Full Cream Milk</h3></div>
            </a>
          </h3>
          <span>500 ml - Pouch</span>
          <span>₹34.00</span>
          <button>Add</button>
        </li>
      </ul>
    `, { runScripts: 'outside-only', url: 'https://www.bigbasket.com/ps/?q=milk' });

    const result = dom.window.eval(productCardsEvaluate(3));

    expect(result.rows[0]).toMatchObject({
      product_id: '40090893',
      brand: 'Amul',
      title: 'Gold Full Cream Milk',
      pack_size: '500 ml - Pouch',
      price: '₹34.00',
    });
  });

  it('uses listing URL title param when visible anchor text is only the brand', () => {
    const dom = new JSDOM(`
      <ul>
        <li>
          <a href="/pd/40090894/amul-taaza-500-ml-pouch/?t_s=Taaza+Milk"><span>Amul</span></a>
          <span>500 ml</span>
          <span>₹26.00</span>
          <button>Add</button>
        </li>
      </ul>
    `, { runScripts: 'outside-only', url: 'https://www.bigbasket.com/ps/?q=milk' });

    const result = dom.window.eval(productCardsEvaluate(3));

    expect(result.rows[0]).toMatchObject({
      product_id: '40090894',
      brand: 'Amul',
      title: 'Taaza Milk',
    });
  });
});

describe('bigbasket registry shape', () => {
  it('registers approved commands with expected access classes', () => {
    expect(getRegistry().get('bigbasket/search').access).toBe('read');
    expect(getRegistry().get('bigbasket/product').access).toBe('read');
    expect(getRegistry().get('bigbasket/category').access).toBe('read');
    expect(getRegistry().get('bigbasket/add-to-cart').access).toBe('write');
    expect(getRegistry().get('bigbasket/cart').access).toBe('read');
    expect(getRegistry().get('bigbasket/checkout').access).toBe('write');
    expect(getRegistry().get('bigbasket/location').access).toBe('read');
  });

  it('keeps checkout in review mode', () => {
    const checkout = getRegistry().get('bigbasket/checkout');
    expect(checkout.columns).toEqual([
      'ok', 'stage', 'cart_total', 'address_ready', 'delivery_ready', 'payment_ready', 'next_action', 'url',
    ]);
  });
});

describe('bigbasket read commands', () => {
  it('rejects invalid read arguments before navigation', async () => {
    const fakePage = { goto: () => { throw new Error('should not navigate'); } };

    await expect(getRegistry().get('bigbasket/search').func(fakePage, { query: '   ' })).rejects.toThrow(ArgumentError);
    await expect(getRegistry().get('bigbasket/category').func(fakePage, { category: 'bad' })).rejects.toThrow(ArgumentError);
    await expect(getRegistry().get('bigbasket/product').func(fakePage, { product: 'banana' })).rejects.toThrow(ArgumentError);
  });

  it('wraps read navigation failures as CommandExecutionError', async () => {
    const fakePage = { goto: () => Promise.reject(new Error('browser down')) };

    await expect(getRegistry().get('bigbasket/search').func(fakePage, { query: 'milk' })).rejects.toThrow(CommandExecutionError);
    await expect(getRegistry().get('bigbasket/category').func(fakePage, { category: 'fruits-vegetables/vegetables' })).rejects.toThrow(CommandExecutionError);
    await expect(getRegistry().get('bigbasket/product').func(fakePage, { product: '40022638' })).rejects.toThrow(CommandExecutionError);
  });
});

describe('bigbasket cart and checkout commands', () => {
  it('rejects invalid add-to-cart arguments before navigation', async () => {
    const fakePage = { goto: () => { throw new Error('should not navigate'); } };

    await expect(getRegistry().get('bigbasket/add-to-cart').func(fakePage, {})).rejects.toThrow(ArgumentError);
    await expect(getRegistry().get('bigbasket/add-to-cart').func(fakePage, { product: 'banana' })).rejects.toThrow(ArgumentError);
    await expect(getRegistry().get('bigbasket/add-to-cart').func(fakePage, { product: '40022638', quantity: 0 })).rejects.toThrow(ArgumentError);
  });

  it('wraps cart and add-to-cart navigation failures as CommandExecutionError', async () => {
    const fakePage = { goto: () => Promise.reject(new Error('browser down')) };

    await expect(getRegistry().get('bigbasket/add-to-cart').func(fakePage, { product: '40022638' })).rejects.toThrow(CommandExecutionError);
    await expect(getRegistry().get('bigbasket/cart').func(fakePage, {})).rejects.toThrow(CommandExecutionError);
    await expect(getRegistry().get('bigbasket/checkout').func(fakePage, {})).rejects.toThrow(CommandExecutionError);
  });

  it('reports auth-required state for cart and checkout instead of recommendation rows', async () => {
    const fakePage = {
      goto: () => Promise.resolve(),
      wait: () => Promise.resolve(),
      evaluate: () => Promise.resolve({ authRequired: true, rows: [] }),
    };

    await expect(getRegistry().get('bigbasket/cart').func(fakePage, {})).rejects.toThrow(AuthRequiredError);
    await expect(getRegistry().get('bigbasket/checkout').func(fakePage, {})).rejects.toThrow(AuthRequiredError);
  });

  it('keeps before-checkout recommendations out of cart rows', () => {
    const dom = new JSDOM(`
      <main>
        <section>
          <h1>My Basket</h1>
          <article>
            <a href="/pd/40090893/amul-amul-gold/">Amul Gold Full Cream Milk</a>
            <span>Qty 1</span>
            <span>₹36</span>
          </article>
        </section>
        <section>
          <article>
            <a href="/pd/40321402/rubiks-cube/?nc=beforeyoucheckout">Rubik's Cube</a>
            <span>₹449</span>
          </article>
        </section>
      </main>
    `, { runScripts: 'outside-only', url: 'https://www.bigbasket.com/basket/' });

    const result = dom.window.eval(CART_EVALUATE);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].product_id).toBe('40090893');
  });

  it('keeps checkout extractor free of final payment/order submission clicks', () => {
    expect(CHECKOUT_REVIEW_EVALUATE).not.toMatch(/place\\s*order|submit\\s*payment|pay\\s*now|make\\s*payment/i);
  });
});
