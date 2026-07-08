import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, normalizeProductRow, resolveProductInput, safeGoto, SITE } from './utils.js';

function productDetailEvaluate(productId) {
  return `
    (() => {
      const productId = ${JSON.stringify(productId)};
      const clean = (value) => value == null ? '' : String(value).replace(/\\s+/g, ' ').trim();
      const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map((node) => {
          try { return JSON.parse(node.textContent || 'null'); } catch { return null; }
        })
        .flatMap((doc) => Array.isArray(doc) ? doc : [doc])
        .find((doc) => /product/i.test(String(doc?.['@type'] || '')));
      const offers = Array.isArray(jsonLd?.offers) ? jsonLd.offers[0] : jsonLd?.offers;
      const text = clean(document.body?.innerText || '');
      const title = clean(jsonLd?.name) || clean(document.querySelector('h1,h2,[class*="ProductName"],[class*="product-name"]')?.textContent);
      const image = Array.isArray(jsonLd?.image) ? jsonLd.image[0] : jsonLd?.image;
      const priceText = clean(offers?.price) || clean(document.querySelector('[class*="price"], [class*="Price"]')?.textContent);
      const mrpText = clean(document.querySelector('del,[class*="mrp"],[class*="MRP"]')?.textContent);
      const packSize = text.match(/\\b\\d+(?:\\.\\d+)?\\s*(?:kg|g|gm|ml|l|ltr|pcs?|pack)\\b/i)?.[0] || '';
      const availability = /out of stock|unavailable/i.test(text) ? 'Out of stock' : clean(offers?.availability || '');
      const delivery = text.match(/Delivery\\s+in\\s+\\d+\\s*(?:mins?|minutes?|hours?)/i)?.[0] || '';
      return {
        product_id: productId,
        title,
        brand: clean(jsonLd?.brand?.name || jsonLd?.brand),
        pack_size: packSize,
        price: priceText,
        mrp: mrpText,
        discount: text.match(/\\d+%\\s*off/i)?.[0] || '',
        availability,
        delivery,
        image_url: clean(image),
        url: location.href,
      };
    })()
  `;
}

cli({
  site: SITE,
  name: 'product',
  access: 'read',
  description: 'Read BigBasket product details',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'product', required: true, positional: true, help: 'Product ID or URL' },
  ],
  columns: ['product_id', 'title', 'brand', 'pack_size', 'price', 'mrp', 'discount', 'availability', 'delivery', 'image_url', 'url'],
  func: async (page, kwargs) => {
    const product = resolveProductInput(kwargs.product);
    await safeGoto(page, product.url, 'bigbasket product');
    if (page.wait) await page.wait(2);
    const raw = await page.evaluate(productDetailEvaluate(product.productId)).catch((error) => {
      throw new CommandExecutionError(`bigbasket product extraction failed: ${error?.message || error}`);
    });
    const row = normalizeProductRow(raw, 0);
    if (!row.product_id || !row.title) {
      throw new EmptyResultError('bigbasket product', `No product details found for ${product.productId}.`);
    }
    return [{
      product_id: row.product_id,
      title: row.title,
      brand: row.brand,
      pack_size: row.pack_size,
      price: row.price,
      mrp: row.mrp,
      discount: row.discount,
      availability: row.availability,
      delivery: raw.delivery || '',
      image_url: raw.image_url || '',
      url: row.url,
    }];
  },
});
