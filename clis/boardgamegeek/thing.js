import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, blocks, fetchXml, linkValues, numberValue, positiveInt, primaryName, requireRows, valueTag } from './utils.js';

function parseThing(xml) {
    return blocks(xml, 'item').map((item) => {
        const stats = item.body.match(/<ratings\b[\s\S]*?<\/ratings>/)?.[0] ?? '';
        return {
            id: item.attrs.id ?? '',
            name: primaryName(item.body),
            type: item.attrs.type ?? '',
            yearPublished: numberValue(valueTag(item.body, 'yearpublished')),
            minPlayers: numberValue(valueTag(item.body, 'minplayers')),
            maxPlayers: numberValue(valueTag(item.body, 'maxplayers')),
            playingTime: numberValue(valueTag(item.body, 'playingtime')),
            minAge: numberValue(valueTag(item.body, 'minage')),
            averageRating: numberValue(valueTag(stats, 'average')),
            bayesAverage: numberValue(valueTag(stats, 'bayesaverage')),
            usersRated: numberValue(valueTag(stats, 'usersrated')),
            categories: linkValues(item.body, 'boardgamecategory'),
            mechanics: linkValues(item.body, 'boardgamemechanic'),
            url: item.attrs.id ? `https://boardgamegeek.com/boardgame/${item.attrs.id}` : '',
        };
    }).filter((row) => row.id && row.name);
}

cli({
    site: 'boardgamegeek',
    name: 'thing',
    access: 'read',
    description: 'Get BoardGameGeek item details and ratings',
    domain: 'boardgamegeek.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'BGG thing id, e.g. 13' },
    ],
    columns: ['id', 'name', 'type', 'yearPublished', 'minPlayers', 'maxPlayers', 'playingTime', 'minAge', 'averageRating', 'bayesAverage', 'usersRated', 'categories', 'mechanics', 'url'],
    func: async (args) => {
        const id = positiveInt(args.id, null, 999999999, 'id');
        const url = new URL(`${API_BASE}/thing`);
        url.searchParams.set('id', String(id));
        url.searchParams.set('stats', '1');
        return requireRows(parseThing(await fetchXml(url, 'boardgamegeek thing')), 'boardgamegeek thing', `No BoardGameGeek item found for id ${id}.`);
    },
});

export const __test__ = { parseThing };
