import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, attrs, fetchXml, requiredText, requireRows, valueTag } from './utils.js';

function parseUser(xml) {
    const match = String(xml ?? '').match(/<user\b([^>]*)>([\s\S]*?)<\/user>/);
    if (!match) return [];
    const userAttrs = attrs(match[1]);
    const body = match[2];
    return [{
        id: userAttrs.id ?? '',
        username: userAttrs.name ?? '',
        firstName: valueTag(body, 'firstname'),
        lastName: valueTag(body, 'lastname'),
        stateOrProvince: valueTag(body, 'stateorprovince'),
        country: valueTag(body, 'country'),
        yearRegistered: valueTag(body, 'yearregistered'),
        lastLogin: valueTag(body, 'lastlogin'),
        tradeRating: valueTag(body, 'traderating'),
        marketRating: valueTag(body, 'marketrating'),
        url: userAttrs.name ? `https://boardgamegeek.com/user/${encodeURIComponent(userAttrs.name)}` : '',
    }].filter((row) => row.username);
}

cli({
    site: 'boardgamegeek',
    name: 'user',
    access: 'read',
    description: 'Get a public BoardGameGeek user profile',
    domain: 'boardgamegeek.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'username', positional: true, required: true, help: 'BoardGameGeek username' },
    ],
    columns: ['id', 'username', 'firstName', 'lastName', 'stateOrProvince', 'country', 'yearRegistered', 'lastLogin', 'tradeRating', 'marketRating', 'url'],
    func: async (args) => {
        const username = requiredText(args.username, 'username');
        const url = new URL(`${API_BASE}/user`);
        url.searchParams.set('name', username);
        return requireRows(parseUser(await fetchXml(url, 'boardgamegeek user')), 'boardgamegeek user', `No BoardGameGeek user found for "${username}".`);
    },
});

export const __test__ = { parseUser };
