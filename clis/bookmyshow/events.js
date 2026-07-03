import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { HOST, SITE, addRankAndLimit, openAndExtract, parseLimit, resolveCity } from './utils.js';

export function buildEventsExtractScript() {
    return `(() => {
    const clean = (value) => String(value || '').replace(/\\u20b9/g, '').replace(/\\s+/g, ' ').trim();
    const seen = new Set();
    const rows = [];
    for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
      const href = anchor.href || '';
      if (!href.includes('/events/') || !/ET\\d{6,}/.test(href)) continue;
      const eventCode = (href.match(/ET\\d{6,}/) || [''])[0];
      if (!eventCode || seen.has(eventCode)) continue;
      const lines = (anchor.innerText || '').split('\\n').map(clean).filter(Boolean);
      const title = clean(anchor.querySelector('img')?.alt) || lines[0] || '';
      if (!title) continue;
      seen.add(eventCode);
      rows.push({
        title,
        venue: lines[1] || '',
        category: lines[2] || '',
        price: lines.find((line) => /\\d|free|onwards/i.test(line) && line !== title && !/ET\\d/.test(line)) || '',
        eventCode,
        url: href,
      });
    }
    return { ok: true, rows };
  })()`;
}

export const command = cli({
    site: SITE,
    name: 'events',
    access: 'read',
    description: 'BookMyShow events in a city',
    example: 'webcmd bookmyshow events --city mumbai --limit 5',
    domain: 'in.bookmyshow.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'city', type: 'string', default: 'mumbai', help: 'BookMyShow city name or slug' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of events to return (max 20)' },
    ],
    columns: ['rank', 'eventCode', 'title', 'venue', 'category', 'price', 'city', 'url'],
    func: async (page, kwargs) => {
        const city = resolveCity(kwargs.city);
        const limit = parseLimit(kwargs.limit, 'bookmyshow events');
        const url = `${HOST}/explore/events-${city.slug}`;
        const rows = await openAndExtract(page, url, buildEventsExtractScript(), 'bookmyshow events');
        return addRankAndLimit(rows, limit, city.slug, url, (row) => ({
            eventCode: row.eventCode || '',
            title: row.title || '',
            venue: row.venue || '',
            category: row.category || '',
            price: row.price || '',
        }));
    },
});

export const __test__ = {
    command,
    buildEventsExtractScript,
};
