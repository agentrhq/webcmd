import { describe, expect, it } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { __test__ as checkoutTest } from '../checkout.js';
import '../cart-add.js';
import {
  buildProductUrl,
  classifyCheckoutSnapshot,
  classifyPageState,
  extractAsin,
  hasAmazonInAuthCookie,
  normalizeCheckoutReview,
  normalizeProductSnapshot,
  normalizeSearchCards,
  normalizeWishlistRows,
  parseCompactCount,
  parseMoney,
  totalsAreConsistent,
  validateCheckoutArgs,
  validatePositiveInteger,
  validatePriceBounds,
} from '../parsers.js';

describe('amazon-in parsers', () => {
  it('normalizes ASINs and parses Indian prices and counts', () => {
    expect(extractAsin('https://www.amazon.in/dp/B0D2QL339Z?psc=1')).toBe('B0D2QL339Z');
    expect(buildProductUrl('B0D2QL339Z')).toBe('https://www.amazon.in/dp/B0D2QL339Z');
    expect(extractAsin('https://amazon.com/dp/B0D2QL339Z')).toBeNull();
    expect(parseMoney('₹1,499.00')).toBe(1499);
    expect(parseMoney('Unavailable')).toBeNull();
    expect(parseCompactCount('39.7K')).toBe(39700);
    expect(parseCompactCount('3,564 ratings')).toBe(3564);
  });

  it('validates bounds without silently clamping', () => {
    expect(validatePriceBounds('300', '500')).toEqual({ minPrice: 300, maxPrice: 500 });
    expect(() => validatePriceBounds('500', '300')).toThrow(/minimum price/i);
    expect(validatePositiveInteger('20', 'limit', 50)).toBe(20);
    expect(() => validatePositiveInteger('51', 'limit', 50)).toThrow(/1 to 50/i);
  });

  it('classifies login and robot pages before DOM parsing', () => {
    expect(classifyPageState('https://www.amazon.in/ap/signin', '')).toBe('login');
    expect(classifyPageState('https://www.amazon.in/', 'Enter the characters you see below')).toBe('robot');
    expect(classifyPageState('https://www.amazon.in/s?k=shirt', 'Results')).toBe('usable');
    expect(hasAmazonInAuthCookie(['session-id', 'x-acbin'])).toBe(true);
    expect(hasAmazonInAuthCookie(['session-id', 'i18n-prefs'])).toBe(false);
  });

  it('filters search cards inclusively and preserves images', () => {
    const rows = normalizeSearchCards([
      {
        cardAsin: 'B000000001',
        cardTitle: 'Low',
        cardPriceText: '₹299',
        cardImageUrl: 'https://m.media-amazon.com/low.jpg',
      },
      {
        cardAsin: 'B000000002',
        cardTitle: 'Match',
        cardPriceText: '₹500',
        cardImageUrl: 'https://m.media-amazon.com/match.jpg',
      },
      {
        cardAsin: 'B000000003',
        cardTitle: 'No price',
        cardPriceText: '',
        cardImageUrl: '',
      },
    ], { minPrice: 300, maxPrice: 500, limit: 10 });
    expect(rows.map((row) => row.asin)).toEqual(['B000000002']);
    expect(rows[0].image_url).toBe('https://m.media-amazon.com/match.jpg');
    expect(rows[0].rank).toBe(1);
  });

  it('normalizes selected product and wishlist variants', () => {
    expect(normalizeProductSnapshot({
      href: 'https://www.amazon.in/dp/B0D2QL339Z?th=1&psc=1',
      title: 'Besix shirt',
      priceText: '₹395.00',
      mrpText: '₹1,499.00',
      discountText: '-74%',
      availabilityText: 'In stock',
      sizeText: 'L',
      colourText: 'Red',
      imageUrl: 'https://m.media-amazon.com/image.jpg',
    })).toEqual({
      asin: 'B0D2QL339Z',
      title: 'Besix shirt',
      price: 395,
      mrp: 1499,
      discount: 74,
      availability: 'In stock',
      size: 'L',
      colour: 'Red',
      image_url: 'https://m.media-amazon.com/image.jpg',
      product_url: 'https://www.amazon.in/dp/B0D2QL339Z',
    });

    const [row] = normalizeWishlistRows('Shopping List', [{
      cardItemId: 'item-1',
      cardHref: 'https://www.amazon.in/dp/B0D2QL339Z',
      cardTitle: 'Besix shirt',
      cardPriceText: '₹395.00',
      cardMrpText: '₹1,499.00',
      cardAvailabilityText: 'In stock',
      cardSizeText: 'L',
      cardColourText: 'Red',
      cardImageUrl: 'https://m.media-amazon.com/image.jpg',
    }]);
    expect(row).toMatchObject({
      asin: 'B0D2QL339Z',
      price: 395,
      list_name: 'Shopping List',
    });
  });

  it('validates checkout payment selectors and totals', () => {
    expect(validateCheckoutArgs({
      quantity: 1,
      payment: 'saved-card',
      cardLast4: '6764',
      placeOrder: false,
    }).payment).toBe('saved-card');
    expect(validateCheckoutArgs({ quantity: 1, payment: 'upi' }).placeOrder).toBe(false);
    expect(() => validateCheckoutArgs({
      quantity: 1,
      payment: 'saved-card',
      cardLast4: '',
    })).toThrow(/card-last4/i);
    expect(() => validateCheckoutArgs({
      quantity: 1,
      payment: 'card-number',
    })).toThrow(/upi, saved-card, new-card, or cod/i);

    const review = normalizeCheckoutReview({
      itemPriceText: '₹395',
      deliveryFeeText: '₹40',
      deliveryDiscountText: '-₹40',
      marketplaceFeeText: '₹5',
      totalText: '₹400',
      quantity: 1,
    });
    expect(review.deliveryFee).toBe(0);
    expect(totalsAreConsistent(review)).toBe(true);
    expect(totalsAreConsistent({ ...review, total: 500 })).toBe(false);
  });

  it('classifies checkout state without submitting', () => {
    expect(classifyCheckoutSnapshot({
      url: 'https://www.amazon.in/aips/process-payment',
      text: 'Complete your payment Payment of ₹ 400.00 QR code is valid',
    })).toMatchObject({ status: 'awaiting_payment', payment_method: 'upi', total: 400 });
    expect(classifyCheckoutSnapshot({
      url: 'https://www.amazon.in/gp/buy/thankyou/handlers/display.html',
      text: 'Order placed, thank you',
    }).status).toBe('ordered');
    expect(classifyCheckoutSnapshot({
      url: 'https://www.amazon.in/checkout/p/example/spc',
      text: 'Order Total: ₹400 Pay with UPI',
    }).status).toBe('review_ready');
    expect(classifyCheckoutSnapshot({
      url: 'https://www.amazon.in/checkout/p/example/spc',
      paymentText: 'Pay by scanning the QR code',
      text: 'Order Total: ₹400 A UPI QR code will appear on the next page',
    }).status).toBe('review_ready');
    expect(classifyCheckoutSnapshot({
      url: 'https://www.amazon.in/checkout/p/example/spc',
      paymentText: 'Visa ending in 6764',
      text: 'Order Total: ₹400 Other methods: Pay with UPI',
    }).payment_method).toBe('card');
    expect(classifyCheckoutSnapshot({
      url: 'https://www.amazon.in/aips/process-payment',
      paymentText: '',
      text: 'Complete your payment Payment of ₹400 Scan the QR code',
    }).payment_method).toBe('upi');
  });

  it('hands secret entry to the browser before trying Continue', async () => {
    const page = {
      wait: () => { throw new Error('must not wait'); },
      click: () => { throw new Error('must not click Continue'); },
      evaluate: () => { throw new Error('must not inspect new-card secrets'); },
    };
    const row = await checkoutTest.continueAfterPaymentSelection(
      page,
      { payment: 'new-card' },
      { asin: 'B0D2QL339Z', title: 'Shirt', size: 'L', colour: 'Red' },
      1,
    );
    expect(row).toMatchObject({ status: 'action_required', payment_method: 'new-card' });

    let clicks = 0;
    const savedCardRow = await checkoutTest.continueAfterPaymentSelection({
      evaluate: async () => ({ needsSecret: true, continueEnabled: false }),
      click: async () => { clicks += 1; },
      sleep: () => { throw new Error('must not sleep after finding CVV'); },
    }, {
      payment: 'saved-card',
    }, {
      asin: 'B0D2QL339Z',
      title: 'Shirt',
      size: 'L',
      colour: 'Red',
    }, 1);
    expect(savedCardRow).toMatchObject({ status: 'action_required', payment_method: 'saved-card' });
    expect(clicks).toBe(0);
  });

  it('requires one matching line item and never clicks Place Order by default', async () => {
    expect(() => checkoutTest.assertSingleLineItem({
      itemCount: 2,
      asin: 'B0D2QL339Z',
      quantity: 1,
    }, {
      asin: 'B0D2QL339Z',
    }, {
      quantity: 1,
    })).toThrow(/exactly one checkout line item/i);

    let placements = 0;
    const page = {
      evaluate: async () => {
        placements += 1;
        return { clicked: true, matches: 1 };
      },
    };
    expect(await checkoutTest.submitOrder(page, false)).toBe(false);
    expect(placements).toBe(0);
    expect(await checkoutTest.submitOrder(page, true)).toBe(true);
    expect(placements).toBe(1);
  });

  it('does not add an item when Amazon fails to select the requested variant', async () => {
    let variantRead = 0;
    const page = {
      goto: async () => {},
      wait: async () => {},
      sleep: async () => {},
      getCookies: async () => [{ name: 'x-acbin' }],
      evaluateWithArgs: async () => {
        variantRead += 1;
        return variantRead === 1 ? { changed: true, matches: 1 } : 'Red';
      },
      evaluate: async (script) => {
        if (script.includes('confirmation:')) {
          return { confirmation: true, text: 'Added to cart' };
        }
        if (script.includes('document.body?.innerText')) {
          return { url: 'https://www.amazon.in/dp/B0D2QL339Z', text: 'Product page' };
        }
        if (script.includes('location.pathname.match')) {
          return { asin: 'B0D2QL339Z', title: 'Shirt' };
        }
        return undefined;
      },
    };
    const command = getRegistry().get('amazon-in/cart-add');

    await expect(command.func(page, {
      input: 'B0D2QL339Z',
      colour: 'Blue',
    })).rejects.toThrow(/did not select color "Blue"/i);
  });
});
