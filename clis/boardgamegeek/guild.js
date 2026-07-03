import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, attrs, fetchXml, numberValue, positiveInt, requireRows, valueTag } from './utils.js';

function parseGuild(xml) {
    const match = String(xml ?? '').match(/<guild\b([^>]*)>([\s\S]*?)<\/guild>/);
    if (!match) return [];
    const guildAttrs = attrs(match[1]);
    const body = match[2];
    return [{
        id: guildAttrs.id ?? '',
        name: valueTag(body, 'name'),
        created: valueTag(body, 'created'),
        manager: valueTag(body, 'manager'),
        category: valueTag(body, 'category'),
        websiteUrl: valueTag(body, 'website'),
        memberCount: numberValue(attrs(body.match(/<members\b([^>]*)>/)?.[1]).count),
        description: valueTag(body, 'description'),
        url: guildAttrs.id ? `https://boardgamegeek.com/guild/${guildAttrs.id}` : '',
    }].filter((row) => row.id && row.name);
}

cli({
    site: 'boardgamegeek',
    name: 'guild',
    access: 'read',
    description: 'Get BoardGameGeek guild details',
    domain: 'boardgamegeek.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'BGG guild id, e.g. 1229' },
    ],
    columns: ['id', 'name', 'created', 'manager', 'category', 'websiteUrl', 'memberCount', 'description', 'url'],
    func: async (args) => {
        const id = positiveInt(args.id, null, 999999999, 'id');
        const url = new URL(`${API_BASE}/guild`);
        url.searchParams.set('id', String(id));
        url.searchParams.set('members', '1');
        return requireRows(parseGuild(await fetchXml(url, 'boardgamegeek guild')), 'boardgamegeek guild', `No BoardGameGeek guild found for id ${id}.`);
    },
});

export const __test__ = { parseGuild };
