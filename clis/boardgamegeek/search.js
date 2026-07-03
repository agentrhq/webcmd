import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, attrs, blocks, fetchXml, positiveInt, requireRows, requiredText } from './utils.js';

function parseSearch(xml) {
    const rows = [];
    for (const item of blocks(xml, 'item')) {
        const nameMatch = item.body.match(/<name\b([^>]*)\/?>/);
        const yearMatch = item.body.match(/<yearpublished\b([^>]*)\/?>/);
        const name = attrs(nameMatch?.[1]).value ?? '';
        const yearRaw = attrs(yearMatch?.[1]).value;
        rows.push({
            id: item.attrs.id ?? '',
            name,
            type: item.attrs.type ?? '',
            yearPublished: yearRaw == null ? null : Number(yearRaw),
            url: item.attrs.id ? `https://boardgamegeek.com/boardgame/${item.attrs.id}` : '',
        });
    }
    return rows.filter((row) => row.id && row.name);
}

cli({
    site: 'boardgamegeek',
    name: 'search',
    access: 'read',
    description: 'Search BoardGameGeek games via XML API2',
    domain: 'boardgamegeek.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Game search terms, e.g. "catan"' },
        { name: 'type', default: 'boardgame', choices: ['boardgame', 'boardgameexpansion', 'boardgameaccessory', 'videogame', 'rpgitem', 'all'], help: 'BGG thing type or all' },
        { name: 'exact', type: 'boolean', default: false, help: 'Only exact name matches' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
    ],
    columns: ['rank', 'id', 'name', 'type', 'yearPublished', 'url'],
    func: async (args) => {
        const query = requiredText(args.query, 'query');
        const limit = positiveInt(args.limit, 20, 100, 'limit');
        const type = String(args.type ?? 'boardgame').trim();
        const url = new URL(`${API_BASE}/search`);
        url.searchParams.set('query', query);
        if (type !== 'all') url.searchParams.set('type', type);
        if (args.exact) url.searchParams.set('exact', '1');

        const rows = requireRows(parseSearch(await fetchXml(url, 'boardgamegeek search')), 'boardgamegeek search', `No BoardGameGeek games matched "${query}".`);
        return rows.slice(0, limit).map((row, i) => ({ rank: i + 1, ...row }));
    },
});

export const __test__ = { parseSearch };
