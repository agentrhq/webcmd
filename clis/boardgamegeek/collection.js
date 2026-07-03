import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, attrs, blocks, fetchXml, numberValue, positiveInt, requireRows, requiredText, valueTag } from './utils.js';

function parseCollection(xml) {
    return blocks(xml, 'item').map((item) => {
        const status = attrs(item.body.match(/<status\b([^>]*)\/?>/)?.[1]);
        const stats = item.body.match(/<stats\b[\s\S]*?<\/stats>/)?.[0] ?? '';
        return {
            id: item.attrs.objectid ?? item.attrs.id ?? '',
            collectionId: item.attrs.collid ?? '',
            name: valueTag(item.body, 'name'),
            yearPublished: numberValue(valueTag(item.body, 'yearpublished')),
            subtype: item.attrs.subtype ?? '',
            own: status.own === '1',
            wishlist: status.wishlist === '1',
            forTrade: status.fortrade === '1',
            wantToPlay: status.wanttoplay === '1',
            numPlays: numberValue(valueTag(item.body, 'numplays')),
            userRating: numberValue(valueTag(stats, 'rating')),
            averageRating: numberValue(valueTag(stats, 'average')),
            url: (item.attrs.objectid ?? item.attrs.id) ? `https://boardgamegeek.com/boardgame/${item.attrs.objectid ?? item.attrs.id}` : '',
        };
    }).filter((row) => row.id && row.name);
}

cli({
    site: 'boardgamegeek',
    name: 'collection',
    access: 'read',
    description: 'List a public BoardGameGeek user collection',
    domain: 'boardgamegeek.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'username', positional: true, required: true, help: 'BoardGameGeek username' },
        { name: 'limit', type: 'int', default: 50, help: 'Max results (1-100)' },
        { name: 'subtype', default: 'boardgame', choices: ['boardgame', 'boardgameexpansion', 'boardgameaccessory', 'rpgitem', 'rpgissue', 'videogame'], help: 'Collection subtype' },
        { name: 'own', type: 'boolean', default: true, help: 'Only owned items' },
    ],
    columns: ['rank', 'id', 'collectionId', 'name', 'yearPublished', 'subtype', 'own', 'wishlist', 'forTrade', 'wantToPlay', 'numPlays', 'userRating', 'averageRating', 'url'],
    func: async (args) => {
        const username = requiredText(args.username, 'username');
        const limit = positiveInt(args.limit, 50, 100, 'limit');
        const url = new URL(`${API_BASE}/collection`);
        url.searchParams.set('username', username);
        url.searchParams.set('subtype', String(args.subtype ?? 'boardgame').trim());
        url.searchParams.set('stats', '1');
        if (args.own !== false) url.searchParams.set('own', '1');
        const rows = requireRows(parseCollection(await fetchXml(url, 'boardgamegeek collection', { retry202: true })), 'boardgamegeek collection', `No public collection rows found for "${username}".`);
        return rows.slice(0, limit).map((row, i) => ({ rank: i + 1, ...row }));
    },
});

export const __test__ = { parseCollection };
