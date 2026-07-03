import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { HOST, SITE, addRankAndLimit, openAndExtract, parseLimit, resolveCity } from './utils.js';

export function buildMoviesExtractScript(citySlug) {
    return `(() => {
    const citySlug = ${JSON.stringify(citySlug)};
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const seen = new Set();
    const rows = [];
    for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
      const href = anchor.href || '';
      if (!href.includes('/movies/' + citySlug + '/') || !/ET\\d{6,}/.test(href)) continue;
      const eventCode = (href.match(/ET\\d{6,}/) || [''])[0];
      if (!eventCode || seen.has(eventCode)) continue;
      const lines = (anchor.innerText || '').split('\\n').map(clean).filter(Boolean);
      const image = anchor.querySelector('img')?.src || '';
      const title = clean(anchor.querySelector('img')?.alt) || lines[0] || '';
      const genres = lines.find((line) => line !== title && line.includes('/')) || '';
      if (!title) continue;
      seen.add(eventCode);
      rows.push({ title, genres, eventCode, url: href, image });
    }
    return { ok: true, rows };
  })()`;
}

export const command = cli({
    site: SITE,
    name: 'movies',
    access: 'read',
    description: 'BookMyShow movies running in a city',
    example: 'webcmd bookmyshow movies --city mumbai --limit 5',
    domain: 'in.bookmyshow.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'city', type: 'string', default: 'mumbai', help: 'BookMyShow city name or slug' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of movies to return (max 20)' },
    ],
    columns: ['rank', 'eventCode', 'title', 'genres', 'city', 'url', 'image'],
    func: async (page, kwargs) => {
        const city = resolveCity(kwargs.city);
        const limit = parseLimit(kwargs.limit, 'bookmyshow movies');
        const url = `${HOST}/explore/home/${city.slug}`;
        const rows = await openAndExtract(page, url, buildMoviesExtractScript(city.slug), 'bookmyshow movies');
        return addRankAndLimit(rows, limit, city.slug, url, (row) => ({
            eventCode: row.eventCode || '',
            title: row.title || '',
            genres: row.genres || '',
            image: row.image || '',
        }));
    },
});

export const __test__ = {
    command,
    buildMoviesExtractScript,
};
