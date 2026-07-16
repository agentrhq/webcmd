import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const HOST = 'www.bikewale.com';
const MAX_LIMIT = 25;

function parseLimit(raw) {
  const value = raw === undefined || raw === null || raw === '' ? 10 : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

function normalizeQuery(raw) {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value) throw new ArgumentError('query is required');
  if (value.length > 100) throw new ArgumentError('query must be at most 100 characters');
  return value;
}

function buildSearchUrl(query) {
  return `https://${HOST}/search/?q=${encodeURIComponent(query)}`;
}

function extractionScript(limit) {
  return `(() => {
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const bikePath = /^\\/[a-z0-9-]+-bikes\\/[a-z0-9-]+\\/?(?:[?#].*)?$/i;
    const blocked = /captcha|verify you are human|access denied/i.test(clean(document.body?.innerText).slice(0, 1500));
    const seen = new Set();
    const rows = [];

    for (const link of document.querySelectorAll('a[href]')) {
      if (rows.length >= ${limit}) break;
      let url;
      try { url = new URL(link.getAttribute('href'), location.href); } catch { continue; }
      if (url.hostname !== '${HOST}' || !bikePath.test(url.pathname)) continue;
      url.search = '';
      url.hash = '';
      if (seen.has(url.href)) continue;

      const card = link.closest('article, li, [class*="card" i], [class*="result" i]') || link.parentElement;
      const titleNode = link.querySelector('h1, h2, h3, h4, [class*="title" i]') ||
        card?.querySelector('h1, h2, h3, h4, [class*="title" i]');
      const name = clean(titleNode?.textContent || link.getAttribute('title') || link.textContent);
      if (!name || name.length > 120) continue;

      const text = clean(card?.textContent);
      const price = text.match(/(?:₹|Rs\\.?)[ \\u00a0]*[\\d,.]+(?:[ \\u00a0]*(?:Lakh|Crore|Thousand))?/i)?.[0] || null;
      seen.add(url.href);
      rows.push({ rank: rows.length + 1, name, price, url: url.href });
    }
    return { blocked, rows };
  })()`;
}

cli({
  site: 'bikewale',
  name: 'search',
  access: 'read',
  description: 'Search BikeWale for publicly listed motorcycles and scooters',
  domain: HOST,
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Bike name or keywords, for example "classic 350"' },
    { name: 'limit', type: 'int', default: 10, help: `Maximum results to return (1-${MAX_LIMIT})` },
  ],
  columns: ['rank', 'name', 'price', 'url'],
  func: async (page, args) => {
    const query = normalizeQuery(args.query);
    const limit = parseLimit(args.limit);
    await page.goto(buildSearchUrl(query), { waitUntil: 'load', settleMs: 1500 });
    const result = await page.evaluate(extractionScript(limit));
    if (!result || typeof result !== 'object' || !Array.isArray(result.rows)) {
      throw new CommandExecutionError('BikeWale search returned an unreadable page');
    }
    if (result.blocked) {
      throw new CommandExecutionError('BikeWale blocked the anonymous search page');
    }
    if (!result.rows.length) {
      throw new EmptyResultError('bikewale search', `No public bikes found for ${JSON.stringify(query)}`);
    }
    return result.rows;
  },
});
