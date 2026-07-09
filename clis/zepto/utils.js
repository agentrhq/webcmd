import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';

export const SITE = 'zepto';
export const DOMAIN = 'www.zepto.com';
export const HOME_URL = 'https://www.zepto.com';
export const MAX_LIMIT = 50;
export const ZEPTO_NAV_OPTIONS = { waitUntil: 'none', settleMs: 1500 };

export function cleanText(value) {
  return typeof value === 'string'
    ? value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

export function parseMoney(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 999 ? value / 100 : value;
  const match = cleanText(String(value ?? '')).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function parseLimitArg(raw, fallback, max = MAX_LIMIT) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > max) {
    throw new ArgumentError(`--limit must be an integer between 1 and ${max} (got ${raw})`);
  }
  return num;
}

export function parseQuantityArg(raw, fallback, max = 12) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > max) {
    throw new ArgumentError(`--quantity must be an integer between 1 and ${max} (got ${raw})`);
  }
  return num;
}

export function buildSearchUrl(query) {
  const normalized = cleanText(query);
  if (!normalized) throw new ArgumentError('zepto search query cannot be empty');
  return `${HOME_URL}/search?query=${encodeURIComponent(normalized)}`;
}

export function toZeptoUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  try {
    const url = new URL(text.startsWith('http') ? text : text.startsWith('/') ? text : `/${text}`, HOME_URL);
    if (url.hostname !== DOMAIN && url.hostname !== 'zepto.com') throw new Error('not zepto');
    url.hostname = DOMAIN;
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function resolveProductInput(input) {
  const text = cleanText(input);
  if (!text) throw new ArgumentError('zepto product requires a product URL');
  const url = toZeptoUrl(text);
  const match = url && new URL(url).pathname.match(/\/pvid\/([0-9a-f-]{36})(?:\/|$)/i);
  if (!match) throw new ArgumentError('zepto product expects a Zepto /pn/.../pvid/<id> URL from search results');
  return { productId: match[1], url };
}

export function normalizeProductRow(raw, rank) {
  const url = toZeptoUrl(raw.url || raw.href || '');
  const productId = cleanText(raw.product_id || raw.productId || raw.id || url.match(/\/pvid\/([0-9a-f-]{36})/i)?.[1] || '');
  return {
    rank: rank + 1,
    product_id: productId,
    title: cleanText(raw.title || raw.name),
    brand: cleanText(raw.brand),
    pack_size: cleanText(raw.pack_size || raw.packSize || raw.size),
    price: parseMoney(raw.price),
    mrp: parseMoney(raw.mrp || raw.original_price || raw.originalPrice),
    availability: cleanText(raw.availability || raw.stock),
    url,
  };
}

function parsePersisted(raw) {
  try {
    const outer = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const value = typeof outer?.value === 'string' ? JSON.parse(outer.value) : outer;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function normalizeLocationState(raw = {}) {
  const rawAddressText = cleanText(raw.addressText);
  const addressText = /^select location$/i.test(rawAddressText) ? '' : rawAddressText;
  const rawLabel = addressText.match(/^(Home|Work|Other)\b/i)?.[1] || '';
  const label = rawLabel ? rawLabel[0].toUpperCase() + rawLabel.slice(1).toLowerCase() : '';
  const publicAddressText = addressText
    .replace(/^(Home|Work|Other)\s*[:-]?\s*/i, '')
    .replace(/\b(?:house\s*number|floor|flat|apartment|door|building)\b\s*[-:#]?\s*[^,•\n]*/gi, '');
  const parts = publicAddressText.split(/[,•\n]/).map(cleanText).filter(Boolean);
  const position = raw.userPosition || raw.userGpsCoords || {};
  const pincode = cleanText(raw.pincode || raw.pin || addressText.match(/\b\d{6}\b/)?.[0]);
  const cityPart = parts.length > 1 ? (parts[parts.length - 1].toLowerCase() === 'india' && parts.length > 2 ? parts[parts.length - 2] : parts[parts.length - 1]) : cleanText(raw.city);
  return {
    selected: Boolean(addressText || position.latitude || position.longitude || raw.pincode),
    label,
    area: label ? '' : parts[0] || '',
    city: cleanText(cityPart.replace(/\b\d{6}\b/g, '')),
    pincode,
    hasCoordinates: Boolean(position.latitude || position.longitude),
    source: 'browser',
  };
}

export async function safeGoto(page, url, label, options) {
  await page.goto(url, options || ZEPTO_NAV_OPTIONS).catch((error) => {
    const message = error?.message || String(error);
    if (/net::ERR_ABORTED|Browser navigate command timed out/i.test(message)) return;
    throw new CommandExecutionError(`${label} navigation failed: ${error?.message || error}`);
  });
}

export function productCardsEvaluate(limit) {
  return `
    (() => {
      const limit = ${Number(limit) || 20};
      const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
      const bodyText = clean(document.body?.innerText || document.body?.textContent || '');
      if (/please login to continue searching|please login/i.test(bodyText) && location.pathname.includes('/search')) {
        return { authRequired: true, rows: [], href: location.href };
      }
      const rows = [];
      const seen = new Set();
      const anchors = Array.from(document.querySelectorAll('a[href*="/pn/"][href*="/pvid/"]'));
      for (const anchor of anchors) {
        const href = anchor.href || anchor.getAttribute('href') || '';
        const productId = href.match(/\\/pvid\\/([0-9a-f-]{36})/i)?.[1] || '';
        if (!productId || seen.has(productId)) continue;
        let root = anchor;
        for (let i = 0; i < 6 && root?.parentElement; i += 1) {
          const rootText = clean(root.innerText || root.textContent || '');
          if (/₹|ADD|Add to Cart/i.test(rootText)) break;
          root = root.parentElement;
        }
        const texts = Array.from(root.querySelectorAll('*'))
          .filter((node) => node.children.length === 0)
          .map((node) => clean(node.textContent))
          .filter(Boolean);
        const joined = texts.join(' ');
        const prices = texts.filter((text) => /₹/.test(text));
        const title = texts.find((text) => /[A-Za-z]/.test(text) && !/add|cart|off|bestseller|₹|\\d+(?:\\.\\d+)?\\s*(?:kg|g|ml|l|pcs?|pack)/i.test(text)) || clean(anchor.textContent);
        if (!title) continue;
        seen.add(productId);
        rows.push({
          product_id: productId,
          title,
          pack_size: texts.find((text) => /\\b\\d+(?:\\.\\d+)?\\s*(?:kg|g|ml|l|pcs?|pack)\\b/i.test(text)) || '',
          price: prices[0] || '',
          mrp: prices[1] || '',
          availability: /out of stock|unavailable/i.test(joined) ? 'Out of stock' : '',
          url: href,
        });
        if (rows.length >= limit) break;
      }
      return { rows, href: location.href };
    })()
  `;
}

export const CART_EVALUATE = `
  (() => {
    const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
    const parse = (key) => {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
    };
    const cart = parse('cart')?.state || {};
    const content = cart.cartContent || {};
    const rows = Object.entries(content).map(([id, item]) => {
      const product = item?.productVariant || item?.product || item || {};
      const productId = clean(product.id || product.productVariantId || item?.productVariantId || id);
      const price = Number(item?.superSaverSellingPrice ?? item?.discountedSellingPrice ?? item?.sellingPrice ?? product.price ?? product.discountedSellingPrice ?? product.sellingPrice);
      const mrp = Number(item?.mrp ?? product.mrp ?? product.mrpPrice);
      return {
        product_id: productId,
        title: clean(product.name || product.productName || item?.title || item?.name),
        pack_size: clean(product.formattedPacksize || product.packsize || product.unitOfMeasure || item?.quantityText),
        quantity: Number(item?.quantity || item?.qty || 0),
        price: Number.isFinite(price) ? (price > 999 ? price / 100 : price) : null,
        mrp: Number.isFinite(mrp) ? (mrp > 999 ? mrp / 100 : mrp) : null,
        availability: clean(product.availability || ''),
      };
    }).filter((row) => row.product_id && row.title && row.quantity);
    return { rows, href: location.href, cartId: cart.cartId || '' };
  })()
`;

export function normalizeCartRows(result) {
  return (result?.rows || []).map((row, index) => ({
    rank: index + 1,
    product_id: cleanText(row.product_id),
    title: cleanText(row.title),
    pack_size: cleanText(row.pack_size),
    quantity: Number(row.quantity || 0),
    price: parseMoney(row.price),
    mrp: parseMoney(row.mrp),
    availability: cleanText(row.availability),
  })).filter((row) => row.product_id && row.title && row.quantity);
}

export function readLocationEvaluate() {
  return `
    (() => {
      const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
      const parse = (key) => {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
      };
      const persisted = parse('user-position');
      const state = typeof persisted?.value === 'string' ? JSON.parse(persisted.value)?.state : persisted?.state;
      return {
        addressText: clean(document.querySelector('[data-testid="user-address"]')?.textContent || ''),
        userPosition: state?.userPosition || null,
        userGpsCoords: state?.userGpsCoords || null,
      };
    })()
  `;
}
