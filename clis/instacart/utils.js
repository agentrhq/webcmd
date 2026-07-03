import { ArgumentError } from '@agentrhq/webcmd/errors';

export const HOST = 'www.instacart.com';
export const BASE_URL = `https://${HOST}`;
export const MAX_LIMIT = 30;

export function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function parseLimit(raw, fallback = 10) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value)) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    if (value < 1 || value > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be between 1 and ${MAX_LIMIT}, got ${value}`);
    }
    return value;
}

export function normalizeRetailer(raw) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (!value) throw new ArgumentError('retailer is required');
    if (!/^[a-z0-9-]+$/.test(value)) {
        throw new ArgumentError('retailer must be an Instacart retailer slug like "sprouts" or "costco"');
    }
    return value;
}

export function absoluteUrl(href, baseUrl = BASE_URL) {
    const value = String(href ?? '').trim();
    if (!value) return null;
    try {
        return new URL(value, baseUrl).href;
    } catch {
        return null;
    }
}

export function unique(values) {
    const seen = new Set();
    const result = [];
    for (const value of values.map(normalizeText).filter(Boolean)) {
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}

export function leafTexts(root) {
    return unique(Array.from(root.querySelectorAll('span, div, p')).filter((node) => node.children.length === 0).map((node) => node.textContent));
}

export function extractStoreCards(doc, limit = 10) {
    const pageUrl = doc?.location?.href || doc?.URL || 'https://www.instacart.com';
    const links = Array.from(doc.querySelectorAll('a[href*="/store/"][href$="/storefront"]'));
    const seen = new Set();
    const rows = [];
    for (const link of links) {
        if (rows.length >= limit) break;
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/store\/([^/?#]+)\/storefront/i);
        if (!match) continue;
        const slug = match[1];
        if (seen.has(slug)) continue;
        const bits = leafTexts(link);
        const name = bits.find((bit) => !/^(Delivery by|Pickup available|No markups|\$\d+\s+off|EBT|Lots of deals|Low prices|Bulk pricing|Loyalty savings|By\s|\d+\s*(hr|min)|\d+\.\d+\s*mi)/i.test(bit));
        if (!name) continue;
        const delivery = bits.find((bit) => /^(Delivery by|By\s|\d+\s*(hr|min)$)/i.test(bit)) || null;
        const pickup = bits.find((bit) => /^Pickup/i.test(bit)) || null;
        const tags = bits.filter((bit) => ![name, delivery, pickup].includes(bit)).join(', ') || null;
        seen.add(slug);
        rows.push({
            rank: rows.length + 1,
            slug,
            name,
            delivery,
            pickup,
            tags,
            url: absoluteUrl(href, pageUrl),
        });
    }
    return rows;
}

function productIdFromUrl(url) {
    const match = String(url || '').match(/\/products\/(\d+)/);
    return match ? match[1] : null;
}

function compactPrice(raw) {
    const value = normalizeText(raw);
    const match = value.match(/Current price:\s*(\$\d+(?:\.\d{2})?)/i);
    return match ? match[1] : null;
}

function compactOriginalPrice(raw) {
    const value = normalizeText(raw);
    const match = value.match(/Original Price:\s*(\$\d+(?:\.\d{2})?)/i);
    return match ? match[1] : null;
}

function firstMatching(values, pattern) {
    return values.find((value) => pattern.test(value)) || null;
}

export function extractProductCards(doc, limit = 10) {
    const pageUrl = doc?.location?.href || doc?.URL || 'https://www.instacart.com';
    const links = Array.from(doc.querySelectorAll('a[href*="/products/"]'));
    const seen = new Set();
    const rows = [];
    for (const link of links) {
        if (rows.length >= limit) break;
        const url = absoluteUrl(link.getAttribute('href'), pageUrl);
        const productId = productIdFromUrl(url);
        if (!url || !productId || seen.has(productId)) continue;
        const spanTexts = leafTexts(link);
        const allText = normalizeText(link.textContent || '');
        const priceText = compactPrice(allText);
        const originalPriceText = compactOriginalPrice(allText);
        const discount = firstMatching(spanTexts, /^(\d+%\s+off|buy\s+\d+)/i);
        const stock = firstMatching(spanTexts, /^((many|few)\s+in stock|in stock|out of stock)$/i);
        const size = firstMatching(spanTexts, /^\d+(?:\.\d+)?\s*(oz|lb|ct|fl oz|g|kg|ml|l|pack|x\b)/i);
        const title = spanTexts.find((value) => {
            if (!value || value.length > 120) return false;
            if (/^(current price|original price|\$|\d+$|each|\/|organic$|non gmo$|in season$)/i.test(value)) return false;
            if (value === priceText || value === originalPriceText || value === discount || value === stock || value === size) return false;
            return /[a-z]/i.test(value);
        });
        if (!title || !priceText) continue;
        seen.add(productId);
        rows.push({
            rank: rows.length + 1,
            productId,
            title,
            priceText,
            originalPriceText,
            discount,
            size,
            stock,
            url,
        });
    }
    return rows;
}

export function buildExtractStoresScript(limit) {
    return `(() => {
      const normalizeText = ${normalizeText.toString()};
      const absoluteUrl = ${absoluteUrl.toString()};
      const unique = ${unique.toString()};
      const leafTexts = ${leafTexts.toString()};
      const extractStoreCards = ${extractStoreCards.toString()};
      return extractStoreCards(document, ${limit});
    })()`;
}

export function buildExtractProductsScript(limit) {
    return `(() => {
      const normalizeText = ${normalizeText.toString()};
      const absoluteUrl = ${absoluteUrl.toString()};
      const unique = ${unique.toString()};
      const leafTexts = ${leafTexts.toString()};
      const productIdFromUrl = ${productIdFromUrl.toString()};
      const compactPrice = ${compactPrice.toString()};
      const compactOriginalPrice = ${compactOriginalPrice.toString()};
      const firstMatching = ${firstMatching.toString()};
      const extractProductCards = ${extractProductCards.toString()};
      return extractProductCards(document, ${limit});
    })()`;
}
