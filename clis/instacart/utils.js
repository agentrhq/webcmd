import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';

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

export function normalizeCollection(raw) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (!value) throw new ArgumentError('collection is required');
    if (!/^[a-z0-9-]+$/.test(value)) {
        throw new ArgumentError('collection must be an Instacart collection slug like "produce" or "fresh-fruits"');
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

export function productIdFromUrl(url) {
    const match = String(url || '').match(/\/products\/(\d+)/);
    return match ? match[1] : null;
}

export function retailerFromProductUrl(url) {
    try {
        const parsed = new URL(String(url));
        return parsed.searchParams.get('retailerSlug') || null;
    } catch {
        return null;
    }
}

export function buildProductUrl(raw, retailerRaw) {
    const value = String(raw ?? '').trim();
    if (!value) throw new ArgumentError('product is required');
    if (/^https?:\/\//i.test(value)) {
        let parsed;
        try {
            parsed = new URL(value);
        } catch {
            throw new ArgumentError('product must be an Instacart product URL or numeric product id');
        }
        if (parsed.hostname !== HOST || !productIdFromUrl(parsed.href)) {
            throw new ArgumentError('product URL must be an Instacart /products/<id> URL');
        }
        const retailer = retailerRaw ? normalizeRetailer(retailerRaw) : retailerFromProductUrl(parsed.href);
        if (retailer) parsed.searchParams.set('retailerSlug', retailer);
        return parsed.href;
    }
    if (!/^\d+$/.test(value)) {
        throw new ArgumentError('product must be an Instacart product URL or numeric product id');
    }
    const retailer = normalizeRetailer(retailerRaw);
    return `${BASE_URL}/products/${value}?retailerSlug=${retailer}`;
}

function compactPrice(raw) {
    const value = normalizeText(raw);
    const match = value.match(/Current price:\s*(\$\d+(?:\.\d{2})?)/i);
    if (match) return match[1];
    const fallback = value.match(/\$\d+(?:\.\d{2})?\b/);
    return fallback ? fallback[0] : null;
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
        const headingTitle = normalizeText(link.querySelector('[role="heading"]')?.textContent);
        const fallbackTitle = spanTexts.find((value) => {
            if (!value || value.length > 120) return false;
            if (/^(add|current price|original price|\$|\d+$|each|\/|organic$|non gmo$|in season$)/i.test(value)) return false;
            if (value === priceText || value === originalPriceText || value === discount || value === stock || value === size) return false;
            return /[a-z]/i.test(value);
        });
        const title = headingTitle || fallbackTitle;
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

export function extractCollectionLinks(doc, retailer, limit = 10) {
    const pageUrl = doc?.location?.href || doc?.URL || `${BASE_URL}/store/${retailer}/storefront`;
    const pattern = new RegExp(`/store/${retailer}/collections/([^/?#]+)`, 'i');
    const links = Array.from(doc.querySelectorAll(`a[href*="/store/${retailer}/collections/"]`));
    const seen = new Set();
    const rows = [];
    for (const link of links) {
        if (rows.length >= limit) break;
        const href = link.getAttribute('href') || '';
        const match = href.match(pattern);
        if (!match) continue;
        const slug = match[1].toLowerCase();
        if (seen.has(slug)) continue;
        const name = normalizeText(link.getAttribute('aria-label') || link.textContent || slug);
        if (!name || name.length > 120) continue;
        seen.add(slug);
        rows.push({
            rank: rows.length + 1,
            slug,
            name,
            url: absoluteUrl(href, pageUrl),
        });
    }
    return rows;
}

export function extractProductDetail(doc) {
    const pageUrl = doc?.location?.href || doc?.URL || BASE_URL;
    const bodyText = normalizeText(doc.body?.innerText || doc.body?.textContent || '');
    const leaf = leafTexts(doc.body || doc);
    const heading = normalizeText(doc.querySelector('h1')?.textContent);
    const docTitle = normalizeText(doc.title || '').replace(/\s+Same-Day Delivery.*$/i, '').replace(/\s+\|\s+Instacart$/i, '');
    const title = heading || docTitle || null;
    const priceText = compactPrice(bodyText);
    const originalPriceText = compactOriginalPrice(bodyText);
    const discount = firstMatching(leaf, /^(\d+%\s+off|buy\s+\d+)/i);
    const stock = firstMatching(leaf, /^((many|few)\s+in stock|in stock|out of stock)$/i);
    const size = firstMatching(leaf, /^\d+(?:\.\d+)?\s*(oz|lb|ct|fl oz|g|kg|ml|l|pack|x\b)/i);
    return {
        productId: productIdFromUrl(pageUrl),
        title,
        priceText,
        originalPriceText,
        discount,
        size,
        stock,
        retailer: retailerFromProductUrl(pageUrl),
        url: pageUrl,
    };
}

export async function gotoInstacartPage(page, url, settleMs = 2500) {
    try {
        await page.goto(url, { waitUntil: 'load', settleMs });
    } catch (error) {
        if (!/ERR_ABORTED/i.test(String(error?.message || error))) {
            throw new CommandExecutionError(`Instacart navigation failed: ${error?.message || error}`);
        }
    }
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

export function buildExtractCollectionsScript(retailer, limit) {
    return `(() => {
      const normalizeText = ${normalizeText.toString()};
      const absoluteUrl = ${absoluteUrl.toString()};
      const unique = ${unique.toString()};
      const leafTexts = ${leafTexts.toString()};
      const extractCollectionLinks = ${extractCollectionLinks.toString()};
      return extractCollectionLinks(document, ${JSON.stringify(retailer)}, ${limit});
    })()`;
}

export function buildExtractProductDetailScript() {
    return `(() => {
      const normalizeText = ${normalizeText.toString()};
      const absoluteUrl = ${absoluteUrl.toString()};
      const unique = ${unique.toString()};
      const leafTexts = ${leafTexts.toString()};
      const productIdFromUrl = ${productIdFromUrl.toString()};
      const retailerFromProductUrl = ${retailerFromProductUrl.toString()};
      const compactPrice = ${compactPrice.toString()};
      const compactOriginalPrice = ${compactOriginalPrice.toString()};
      const firstMatching = ${firstMatching.toString()};
      const extractProductDetail = ${extractProductDetail.toString()};
      return extractProductDetail(document);
    })()`;
}
