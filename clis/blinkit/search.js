import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BASE, MAX_LIMIT, normalizeProductSnippet, parseCoordinate, parseLimit, parsePrice, resolveCoordinates } from './utils.js';

function buildSearchEvaluate(query, limit, lat, lon) {
  return `
    (async () => {
      const query = ${JSON.stringify(query)};
      const limit = ${limit};
      const headers = {
        lat: ${JSON.stringify(lat)},
        lon: ${JSON.stringify(lon)},
        app_client: 'consumer_web'
      };
      const rows = [];
      let url = '/v1/layout/search?q=' + encodeURIComponent(query) + '&search_type=type_to_search';

      for (let page = 0; url && rows.length < limit && page < 8; page += 1) {
        const resp = await fetch(url, { method: 'POST', credentials: 'include', headers });
        const raw = await resp.text();
        let json;
        try {
          json = JSON.parse(raw);
        } catch {
          return { ok: false, status: resp.status, error: raw.slice(0, 200) };
        }
        if (!resp.ok || json.error) {
          return { ok: false, status: resp.status, error: json.error || json.message || raw.slice(0, 200) };
        }
        const snippets = Array.isArray(json?.response?.snippets) ? json.response.snippets : [];
        rows.push(...snippets.filter((snippet) => snippet?.widget_type === 'product_card_snippet_type_2'));
        url = json?.response?.pagination?.next_url || '';
      }

      return { ok: true, rows: rows.slice(0, limit) };
    })()
  `;
}

cli({
  site: 'blinkit',
  name: 'search',
  access: 'read',
  description: 'Search Blinkit products for a delivery location',
  domain: 'blinkit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 20, help: `Max results (max ${MAX_LIMIT})` },
    { name: 'lat', help: 'Delivery latitude (defaults to current Blinkit browser location)' },
    { name: 'lon', help: 'Delivery longitude (defaults to current Blinkit browser location)' },
  ],
  columns: ['rank', 'productId', 'name', 'brand', 'variant', 'price', 'mrp', 'currency', 'inventory', 'available', 'imageUrl', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) throw new ArgumentError('query cannot be empty');

    const limit = parseLimit(kwargs.limit);
    const pageUrl = `${BASE}/s/?q=${encodeURIComponent(query)}`;
    await page.goto(pageUrl).catch((error) => {
      throw new CommandExecutionError(`blinkit search navigation failed: ${error?.message || error}`);
    });
    const { lat, lon } = await resolveCoordinates(page, kwargs);

    const result = await page.evaluate(buildSearchEvaluate(query, limit, lat, lon)).catch((error) => {
      throw new CommandExecutionError(`blinkit search request failed: ${error?.message || error}`);
    });
    if (!result?.ok) {
      throw new CommandExecutionError(`blinkit search failed: HTTP ${result?.status ?? 'unknown'} ${result?.error ?? ''}`.trim());
    }

    const rows = (result.rows ?? [])
      .map((snippet, index) => normalizeProductSnippet(snippet, index + 1))
      .filter(Boolean);
    if (!rows.length) {
      throw new EmptyResultError('blinkit search', `No products matched "${query}" at ${lat},${lon}`);
    }
    return rows;
  },
});

export const __test__ = {
  normalizeSnippet: normalizeProductSnippet,
  parseCoordinate,
  parseLimit,
  parsePrice,
};
