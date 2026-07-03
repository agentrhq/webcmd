import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, attrs, blocks, fetchXml, numberValue, positiveInt, requireRows } from './utils.js';

function parseHot(xml) {
    return blocks(xml, 'item').map((item) => {
        const name = attrs(item.body.match(/<name\b([^>]*)\/?>/)?.[1]).value ?? '';
        const year = attrs(item.body.match(/<yearpublished\b([^>]*)\/?>/)?.[1]).value;
        const thumbnail = attrs(item.body.match(/<thumbnail\b([^>]*)\/?>/)?.[1]).value ?? '';
        return {
            rank: numberValue(item.attrs.rank),
            id: item.attrs.id ?? '',
            name,
            yearPublished: numberValue(year),
            thumbnailUrl: thumbnail,
            url: item.attrs.id ? `https://boardgamegeek.com/boardgame/${item.attrs.id}` : '',
        };
    }).filter((row) => row.id && row.name);
}

cli({
    site: 'boardgamegeek',
    name: 'hot',
    access: 'read',
    description: 'List currently hot BoardGameGeek items',
    domain: 'boardgamegeek.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'type', default: 'boardgame', choices: ['boardgame', 'rpg', 'videogame', 'boardgameperson', 'rpgperson', 'boardgamecompany', 'rpgcompany', 'videogamecompany'], help: 'Hot list type' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-50)' },
    ],
    columns: ['rank', 'id', 'name', 'yearPublished', 'thumbnailUrl', 'url'],
    func: async (args) => {
        const limit = positiveInt(args.limit, 20, 50, 'limit');
        const url = new URL(`${API_BASE}/hot`);
        url.searchParams.set('type', String(args.type ?? 'boardgame').trim());
        return requireRows(parseHot(await fetchXml(url, 'boardgamegeek hot')), 'boardgamegeek hot', 'No hot BoardGameGeek items returned.').slice(0, limit);
    },
});

export const __test__ = { parseHot };
