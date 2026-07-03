import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, attrs, blocks, fetchXml, numberValue, optionalDate, positiveInt, requireRows, requiredText } from './utils.js';

function parsePlays(xml) {
    return blocks(xml, 'play').map((play) => {
        const item = attrs(play.body.match(/<item\b([^>]*)\/?>/)?.[1]);
        return {
            id: play.attrs.id ?? '',
            date: play.attrs.date ?? '',
            quantity: numberValue(play.attrs.quantity),
            length: numberValue(play.attrs.length),
            incomplete: play.attrs.incomplete === '1',
            nowInStats: play.attrs.nowinstats === '1',
            location: play.attrs.location ?? '',
            itemId: item.objectid ?? '',
            itemName: item.name ?? '',
            url: play.attrs.id ? `https://boardgamegeek.com/play/details/${play.attrs.id}` : '',
        };
    }).filter((row) => row.id && row.itemId);
}

cli({
    site: 'boardgamegeek',
    name: 'plays',
    access: 'read',
    description: 'List recent BoardGameGeek logged plays',
    domain: 'boardgamegeek.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'username', positional: true, required: true, help: 'BoardGameGeek username' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
        { name: 'page', type: 'int', default: 1, help: 'Result page (1-1000)' },
        { name: 'mindate', help: 'Only plays on/after YYYY-MM-DD' },
        { name: 'maxdate', help: 'Only plays on/before YYYY-MM-DD' },
    ],
    columns: ['rank', 'id', 'date', 'quantity', 'length', 'incomplete', 'nowInStats', 'location', 'itemId', 'itemName', 'url'],
    func: async (args) => {
        const username = requiredText(args.username, 'username');
        const limit = positiveInt(args.limit, 20, 100, 'limit');
        const page = positiveInt(args.page, 1, 1000, 'page');
        const mindate = optionalDate(args.mindate, 'mindate');
        const maxdate = optionalDate(args.maxdate, 'maxdate');
        const url = new URL(`${API_BASE}/plays`);
        url.searchParams.set('username', username);
        url.searchParams.set('page', String(page));
        if (mindate) url.searchParams.set('mindate', mindate);
        if (maxdate) url.searchParams.set('maxdate', maxdate);
        const rows = requireRows(parsePlays(await fetchXml(url, 'boardgamegeek plays')), 'boardgamegeek plays', `No public plays found for "${username}".`);
        return rows.slice(0, limit).map((row, i) => ({ rank: (page - 1) * 100 + i + 1, ...row }));
    },
});

export const __test__ = { parsePlays };
