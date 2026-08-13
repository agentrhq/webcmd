export const cleanText = (value) =>
  typeof value === 'string'
    ? value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    : '';

export function classifyPageState(url, text) {
  if (/\/(?:ap\/signin|signin)(?:[/?]|$)/i.test(url)) return 'login';
  if (/enter the characters you see below|sorry, we just need to make sure you're not a robot/i.test(cleanText(text))) {
    return 'robot';
  }
  return 'usable';
}

export function hasAmazonInAuthCookie(names) {
  const cookies = new Set(names);
  return cookies.has('at-acbin') || cookies.has('x-acbin');
}

export function extractAsin(input) {
  const value = cleanText(input);
  if (/^[A-Z0-9]{10}$/i.test(value)) return value.toUpperCase();
  try {
    const url = new URL(value);
    if (!/(^|\.)amazon\.in$/i.test(url.hostname)) return null;
    return url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

export function buildProductUrl(input) {
  const asin = extractAsin(input);
  if (!asin) throw new RangeError('Expected an Amazon.in product URL or 10-character ASIN');
  return `https://www.amazon.in/dp/${asin}`;
}

export function parseMoney(text) {
  const match = cleanText(text).match(/(?:₹|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

export function parseCompactCount(text) {
  const match = cleanText(text).match(/([\d,.]+)\s*([KM])?/i);
  if (!match) return null;
  const scale = match[2]?.toUpperCase() === 'M' ? 1_000_000 : match[2] ? 1_000 : 1;
  return Math.round(Number(match[1].replaceAll(',', '')) * scale);
}

export function validatePositiveInteger(value, name, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return number;
}

export function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return false;
  if (/^(true|1)$/i.test(String(value))) return true;
  if (/^(false|0)$/i.test(String(value))) return false;
  throw new RangeError('place-order must be true or false');
}

export function validatePriceBounds(minimum, maximum) {
  const minPrice = minimum === undefined ? null : Number(minimum);
  const maxPrice = maximum === undefined ? null : Number(maximum);
  if (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) {
    throw new RangeError('minimum price must be zero or greater');
  }
  if (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) {
    throw new RangeError('maximum price must be zero or greater');
  }
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    throw new RangeError('minimum price cannot exceed maximum price');
  }
  return { minPrice, maxPrice };
}

export function buildSearchUrl(query, { minPrice, maxPrice }) {
  const url = new URL('/s', 'https://www.amazon.in');
  url.searchParams.set('k', cleanText(query));
  if (minPrice !== null || maxPrice !== null) {
    const low = Math.round((minPrice ?? 0) * 100);
    const high = Math.round((maxPrice ?? 10_000_000) * 100);
    url.searchParams.set('rh', `p_36:${low}-${high}`);
  }
  return url.href;
}

export function normalizeSearchCards(cards, { minPrice, maxPrice, limit }) {
  return cards
    .map((card) => {
      const price = parseMoney(card.cardPriceText);
      if (!card.cardAsin || !cleanText(card.cardTitle) || price === null) return null;
      if (minPrice !== null && price < minPrice) return null;
      if (maxPrice !== null && price > maxPrice) return null;
      return {
        rank: 0,
        asin: card.cardAsin,
        title: cleanText(card.cardTitle),
        price,
        mrp: parseMoney(card.cardMrpText),
        rating: Number(cleanText(card.cardRatingText).match(/[\d.]+/)?.[0]) || null,
        review_count: parseCompactCount(card.cardReviewText),
        image_url: cleanText(card.cardImageUrl),
        product_url: `https://www.amazon.in/dp/${card.cardAsin}`,
        is_sponsored: card.cardSponsored === true,
      };
    })
    .filter(Boolean)
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function normalizeProductSnapshot(snapshot) {
  const asin = extractAsin(snapshot.href);
  const title = cleanText(snapshot.title);
  const availability = cleanText(snapshot.availabilityText);
  if (!asin || !title || !availability) throw new Error('Amazon product details are incomplete');
  const price = parseMoney(snapshot.priceText);
  if (price === null && !/unavailable|out of stock|currently unavailable/i.test(availability)) {
    throw new Error('Amazon product price is missing');
  }
  const discountMatch = cleanText(snapshot.discountText).match(/-?\s*(\d+(?:\.\d+)?)\s*%/);
  return {
    asin,
    title,
    price,
    mrp: parseMoney(snapshot.mrpText),
    discount: discountMatch ? Number(discountMatch[1]) : null,
    availability,
    size: cleanText(snapshot.sizeText),
    colour: cleanText(snapshot.colourText),
    image_url: cleanText(snapshot.imageUrl),
    product_url: `https://www.amazon.in/dp/${asin}`,
  };
}

export function normalizeWishlistRows(listName, cards) {
  return cards.map((card) => {
    const asin = extractAsin(card.cardHref);
    const title = cleanText(card.cardTitle);
    const itemId = cleanText(card.cardItemId);
    const availability = cleanText(card.cardAvailabilityText);
    const price = parseMoney(card.cardPriceText);
    if (!asin || !title || !itemId) throw new Error('Amazon wishlist item details are incomplete');
    if (price === null && !/unavailable|out of stock|currently unavailable/i.test(availability)) {
      throw new Error(`Amazon wishlist price is missing for ${asin}`);
    }
    return {
      list_name: cleanText(listName),
      item_id: itemId,
      asin,
      title,
      price,
      mrp: parseMoney(card.cardMrpText),
      availability,
      size: cleanText(card.cardSizeText),
      colour: cleanText(card.cardColourText),
      image_url: cleanText(card.cardImageUrl),
      product_url: `https://www.amazon.in/dp/${asin}`,
    };
  });
}

export function validateCheckoutArgs(args) {
  const quantity = validatePositiveInteger(args.quantity ?? 1, 'quantity', 10);
  const payment = cleanText(args.payment);
  if (!['upi', 'saved-card', 'new-card', 'cod'].includes(payment)) {
    throw new RangeError('payment must be upi, saved-card, new-card, or cod');
  }
  const cardLast4 = cleanText(args.cardLast4);
  if (payment === 'saved-card' && !/^\d{4}$/.test(cardLast4)) {
    throw new RangeError('card-last4 must contain exactly four digits for saved-card');
  }
  return {
    quantity,
    payment,
    cardLast4,
    size: cleanText(args.size),
    colour: cleanText(args.colour),
    placeOrder: parseBoolean(args.placeOrder),
  };
}

export function normalizeCheckoutReview(snapshot) {
  const itemPrice = parseMoney(snapshot.itemPriceText);
  const total = parseMoney(snapshot.totalText);
  if (itemPrice === null || total === null) throw new Error('Checkout item price or total is missing');
  const deliveryFee = (parseMoney(snapshot.deliveryFeeText) ?? 0)
    - (parseMoney(snapshot.deliveryDiscountText) ?? 0);
  return {
    itemPrice,
    deliveryFee,
    marketplaceFee: parseMoney(snapshot.marketplaceFeeText) ?? 0,
    total,
    quantity: Number(snapshot.quantity),
  };
}

export function totalsAreConsistent(review) {
  const expected = review.itemPrice * review.quantity + review.deliveryFee + review.marketplaceFee;
  return Math.abs(expected - review.total) <= 0.011;
}

export function classifyCheckoutSnapshot(snapshot) {
  const url = cleanText(snapshot.url);
  const text = cleanText(snapshot.text);
  const reviewReady = /\/checkout\/p\/.+\/spc/i.test(url) && /Order Total:/i.test(text);
  const awaitingPayment = !reviewReady && (
    /aips\/process-payment/i.test(url)
    || /QR code|enter (?:your )?CVV|one.time password|3-D Secure/i.test(text)
  );
  const hasPaymentText = Object.hasOwn(snapshot, 'paymentText');
  const explicitPaymentText = hasPaymentText ? cleanText(snapshot.paymentText) : '';
  const paymentText = hasPaymentText
    ? explicitPaymentText || (awaitingPayment ? text : '')
    : text;
  const paymentMethod = /UPI|QR code/i.test(paymentText)
    ? 'upi'
    : /Cash on Delivery|Pay on Delivery/i.test(paymentText)
      ? 'cod'
      : /ending in|credit card|debit card|CVV|3-D Secure/i.test(paymentText)
        ? 'card'
        : '';
  const base = {
    order_id: text.match(/\b\d{3}-\d{7}-\d{7}\b/)?.[0] ?? '',
    total: parseMoney(text),
    payment_method: paymentMethod,
    action: '',
  };
  if (/\/(?:thankyou|buy\/thankyou)\//i.test(url) && /order (?:placed|confirmed)|thank you/i.test(text)) {
    return { status: 'ordered', ...base };
  }
  if (/payment (?:failed|declined|unsuccessful)|transaction failed/i.test(text)) {
    return { status: 'failed', ...base, action: 'Choose a payment method in the browser; do not retry a charge automatically.' };
  }
  if (/(?:QR|session|payment link).{0,30}expired|expired.{0,30}(?:QR|session|payment)/i.test(text)) {
    return { status: 'expired', ...base, action: 'Return to checkout and create a new payment attempt.' };
  }
  if (reviewReady) {
    return { status: 'review_ready', ...base };
  }
  if (awaitingPayment) {
    return { status: 'awaiting_payment', ...base, action: 'Complete payment in the opened browser, then run checkout-status again.' };
  }
  if (/\/ap\/signin/i.test(url) || /enter your (?:email|mobile number)|sign in/i.test(text)) {
    return { status: 'login_required', ...base, action: 'Sign in in the opened browser, then run checkout-status again.' };
  }
  throw new Error('Amazon checkout state is not recognized');
}
