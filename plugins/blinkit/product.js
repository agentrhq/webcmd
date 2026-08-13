import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { DOMAIN, normalizeProductSnippet, requireProductId, resolveCoordinates } from './utils.js';

function buildProductEvaluate(productId, lat, lon) {
  return `
    (async () => {
      const headers = { lat: ${JSON.stringify(lat)}, lon: ${JSON.stringify(lon)}, app_client: 'consumer_web' };
      const resp = await fetch('/v1/layout/product/' + ${JSON.stringify(productId)}, { method: 'POST', credentials: 'include', headers });
      const raw = await resp.text();
      let json;
      try { json = JSON.parse(raw); } catch { return { ok: false, status: resp.status, error: raw.slice(0, 200) }; }
      if (!resp.ok || json.error) return { ok: false, status: resp.status, error: json.error || json.message || raw.slice(0, 200) };
      return { ok: true, snippets: json?.response?.snippets || [] };
    })()
  `;
}

function normalizeProduct(snippets, productId) {
  const title = snippets.find((snippet) => snippet?.widget_type === 'text_right_icons_rating_snippet_type');
  const strip = snippets.find((snippet) => snippet?.widget_type === 'product_atc_strip');
  const row = normalizeProductSnippet(strip) ?? normalizeProductSnippet(title);
  if (!row) return null;
  const titleText = title?.data?.title?.text;
  return { ...row, productId, name: titleText || row.name };
}

cli({
  site: 'blinkit',
  name: 'product',
  access: 'read',
  description: 'Read Blinkit product details for a delivery location',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'productId', required: true, positional: true, help: 'Blinkit product id' },
    { name: 'lat', help: 'Delivery latitude (defaults to current Blinkit browser location)' },
    { name: 'lon', help: 'Delivery longitude (defaults to current Blinkit browser location)' },
  ],
  columns: ['productId', 'name', 'brand', 'variant', 'price', 'mrp', 'currency', 'inventory', 'available', 'imageUrl', 'url'],
  func: async (page, kwargs) => {
    const productId = requireProductId(kwargs.productId);
    await page.goto(`https://blinkit.com/prn/x/prid/${productId}`).catch((error) => {
      throw new CommandExecutionError(`blinkit product navigation failed: ${error?.message || error}`);
    });
    const { lat, lon } = await resolveCoordinates(page, kwargs);
    const result = await page.evaluate(buildProductEvaluate(productId, lat, lon)).catch((error) => {
      throw new CommandExecutionError(`blinkit product request failed: ${error?.message || error}`);
    });
    if (!result?.ok) {
      throw new CommandExecutionError(`blinkit product failed: HTTP ${result?.status ?? 'unknown'} ${result?.error ?? ''}`.trim());
    }
    const row = normalizeProduct(result.snippets ?? [], productId);
    if (!row) throw new EmptyResultError('blinkit product', `No product data for ${productId}`);
    return [row];
  },
});

export const __test__ = {
  normalizeProduct,
};
