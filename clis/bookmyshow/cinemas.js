import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { HOST, SITE, addRankAndLimit, openAndExtract, parseLimit, resolveCity } from './utils.js';

export function buildCinemasExtractScript() {
    return `(() => {
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const root = document.querySelector('[role="grid"]') || document.body;
    const leaves = Array.from(root.querySelectorAll('div'))
      .filter((el) => !el.children.length)
      .map((el) => clean(el.textContent))
      .filter(Boolean);
    const rows = [];
    const seen = new Set();
    for (let i = 0; i < leaves.length - 1; i += 1) {
      const name = leaves[i];
      const address = leaves[i + 1];
      if (!name || !address || seen.has(name)) continue;
      if (!/\\bIndia\\b|\\bMaharashtra\\b|\\bDelhi\\b|\\bKarnataka\\b|\\bTamil Nadu\\b|\\bTelangana\\b|\\bWest Bengal\\b|\\bGujarat\\b|\\bKerala\\b/i.test(address)) continue;
      seen.add(name);
      rows.push({ name, address });
      i += 1;
    }
    return { ok: true, rows };
  })()`;
}

export const command = cli({
    site: SITE,
    name: 'cinemas',
    access: 'read',
    description: 'BookMyShow cinemas in a city',
    example: 'webcmd bookmyshow cinemas --city mumbai --limit 5',
    domain: 'in.bookmyshow.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'city', type: 'string', default: 'mumbai', help: 'BookMyShow city name or slug' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of cinemas to return (max 20)' },
    ],
    columns: ['rank', 'name', 'address', 'city', 'url'],
    func: async (page, kwargs) => {
        const city = resolveCity(kwargs.city);
        const limit = parseLimit(kwargs.limit, 'bookmyshow cinemas');
        const url = `${HOST}/${city.slug}/cinemas`;
        const rows = await openAndExtract(page, url, buildCinemasExtractScript(), 'bookmyshow cinemas');
        return addRankAndLimit(rows, limit, city.slug, url, (row) => ({
            name: row.name || '',
            address: row.address || '',
        }));
    },
});

export const __test__ = {
    command,
    buildCinemasExtractScript,
};
