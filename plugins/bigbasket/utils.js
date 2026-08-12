import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';

export const SITE = 'bigbasket';
export const DOMAIN = 'www.bigbasket.com';
export const HOME_URL = 'https://www.bigbasket.com/';
export const CART_URL = 'https://www.bigbasket.com/basket/';
export const CHECKOUT_URL = 'https://www.bigbasket.com/checkout/';

export function cleanText(value) {
  return typeof value === 'string'
    ? value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

export function parseMoney(value) {
  const text = cleanText(String(value ?? ''));
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function normalizeAvailability(value) {
  const text = cleanText(value);
  if (/instock$/i.test(text) || /\bin stock\b/i.test(text)) return 'In stock';
  if (/outofstock$/i.test(text) || /out of stock|unavailable/i.test(text)) return 'Out of stock';
  return text;
}

export function parseLimitArg(raw, fallback, max) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > max) {
    throw new ArgumentError(`--limit must be an integer between 1 and ${max} (got ${raw})`);
  }
  return num;
}

export function parseQuantityArg(raw, fallback, max) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > max) {
    throw new ArgumentError(`--quantity must be an integer between 1 and ${max} (got ${raw})`);
  }
  return num;
}

export function buildSearchUrl(query) {
  const normalized = cleanText(query);
  if (!normalized) throw new ArgumentError('bigbasket search query cannot be empty');
  return `${HOME_URL}ps/?q=${encodeURIComponent(normalized)}`;
}

export function toBigBasketUrl(value) {
  const text = cleanText(value);
  if (!text) return '';
  try {
    const url = new URL(text.startsWith('http') ? text : text.startsWith('/') ? text : `/${text}`, HOME_URL);
    if (url.hostname !== DOMAIN) {
      throw new Error('not bigbasket');
    }
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function resolveCategoryUrl(input) {
  const text = cleanText(input);
  if (!text) throw new ArgumentError('bigbasket category requires a category URL or slug');
  if (!text.startsWith('http') && !text.includes('/')) {
    throw new ArgumentError('bigbasket category expects a category path such as fruits-vegetables/vegetables');
  }
  const prefixed = text.startsWith('http') || text.startsWith('/pc/') ? text : `/pc/${text.replace(/^\/+/, '')}/`;
  const url = toBigBasketUrl(prefixed);
  if (!url || !new URL(url).pathname.startsWith('/pc/')) {
    throw new ArgumentError('bigbasket category expects a BigBasket /pc/<category>/ URL or slug');
  }
  return url;
}

export function resolveProductInput(input) {
  const text = cleanText(input);
  if (!text) throw new ArgumentError('bigbasket product requires a product ID or URL');
  if (/^\d{4,}$/.test(text)) {
    return { productId: text, url: `${HOME_URL}pd/${text}/` };
  }
  const url = toBigBasketUrl(text);
  if (!url) throw new ArgumentError('bigbasket product expects a BigBasket product ID or /pd/<id>/ URL');
  const match = new URL(url).pathname.match(/^\/pd\/(\d{4,})(?:\/|$)/);
  if (!match) throw new ArgumentError('bigbasket product expects a BigBasket product ID or /pd/<id>/ URL');
  return { productId: match[1], url };
}

export function normalizeProductRow(raw, rank) {
  const url = toBigBasketUrl(raw.url || raw.href || '');
  const productId = cleanText(raw.product_id || raw.productId || raw.id || url.match(/\/pd\/(\d{4,})/)?.[1] || '');
  return {
    rank: rank + 1,
    product_id: productId,
    title: cleanText(raw.title || raw.name),
    brand: cleanText(raw.brand),
    pack_size: cleanText(raw.pack_size || raw.packSize || raw.size),
    price: parseMoney(raw.price),
    mrp: parseMoney(raw.mrp || raw.original_price || raw.originalPrice),
    discount: cleanText(raw.discount),
    availability: normalizeAvailability(raw.availability || raw.stock),
    url,
  };
}

function parseJsonObject(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function normalizeLocationState(raw = {}) {
  const info = parseJsonObject(raw.selectedAddressInfo || raw.selected_address_info || raw.address);
  const pincode = cleanText(String(info.pin || info.pincode || raw.pin || raw.pincode || ''));
  return {
    selected: Boolean(raw.selected_address_id || raw.selectedAddressId || info.id || pincode),
    label: cleanText(info.nick || info.nickname || raw.label || raw.nick),
    area: cleanText(info.area || info.locality || raw.area),
    city: cleanText(info.city_name || info.city || raw.city),
    pincode,
    source: raw.selectedAddressInfo || raw.selected_address_info ? 'selectedAddressInfo' : '',
  };
}

export async function safeGoto(page, url, label) {
  await page.goto(url).catch((error) => {
    throw new CommandExecutionError(`${label} navigation failed: ${error?.message || error}`);
  });
}

export function productCardsEvaluate(limit) {
  return `
    (() => {
      const limit = ${Number(limit) || 20};
      const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
      const leafText = (root) => Array.from(root.querySelectorAll('*'))
        .filter((node) => node.children.length === 0)
        .map((node) => clean(node.textContent))
        .filter(Boolean);
      const anchors = Array.from(document.querySelectorAll('a[href*="/pd/"]'));
      const byProductId = new Map();
      const rows = [];

      for (const anchor of anchors) {
        const href = anchor.href || anchor.getAttribute('href') || '';
        const productId = href.match(/\\/pd\\/(\\d{4,})/)?.[1] || '';
        if (!productId) continue;

        const root = anchor.closest('li, article, [data-testid], [class*="Product"], [class*="product"], [class*="SKU"], [class*="sku"]') || anchor;
        const productAnchors = Array.from(root.querySelectorAll('a[href*="/pd/"]'))
          .filter((node) => (node.href || node.getAttribute('href') || '').includes('/pd/' + productId + '/'));
        const titleAnchor = productAnchors.find((node) => clean(node.textContent)) || anchor;
        const titleParam = (() => {
          try { return clean(new URL(href, location.origin).searchParams.get('t_s')); } catch { return ''; }
        })();
        const texts = leafText(root);
        const joined = texts.join(' | ');
        const brand = clean(titleAnchor.querySelector('span')?.textContent);
        const visibleTitle =
          clean(titleAnchor.getAttribute('title')) ||
          clean(titleAnchor.querySelector('h1,h2,h3,[class*="name"],[class*="Name"]')?.textContent) ||
          clean(titleAnchor.textContent).replace(brand, '').trim() ||
          texts.find((text) => /[A-Za-z]/.test(text) && !/₹|rs\\.?|add|cart|off/i.test(text)) ||
          '';
        const title = !visibleTitle || visibleTitle === brand ? titleParam : visibleTitle;
        const price = texts.find((text) => /₹|rs\\.?/i.test(text) && !/mrp/i.test(text)) || '';
        const mrp = texts.find((text) => /mrp/i.test(text)) || '';
        const discount = texts.find((text) => /%\\s*off|save/i.test(text)) || '';
        const packSize = texts.find((text) => /\\b\\d+(?:\\.\\d+)?\\s*(?:kg|g|gm|ml|l|ltr|pcs?|pack)\\b/i.test(text)) || '';
        const availability = /out of stock|unavailable/i.test(joined) ? 'Out of stock' : '';

        const row = {
          product_id: productId,
          title,
          brand,
          pack_size: packSize,
          price,
          mrp,
          discount,
          availability,
          url: href,
        };
        const existing = byProductId.get(productId);
        if (!existing || (!existing.title && row.title)) byProductId.set(productId, row);
      }

      for (const row of byProductId.values()) {
        rows.push(row);
        if (rows.length >= limit) break;
      }

      const bodyText = clean(document.body?.innerText || '');
      return { rows, bodyText, href: location.href };
    })()
  `;
}
