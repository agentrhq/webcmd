import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const SEARCH_URL = 'https://boardgamegeek.com/xmlapi2/search';
const TOKEN_ENV = 'BOARDGAMEGEEK_TOKEN';
const UA = 'webcmd-boardgamegeek-adapter (+https://github.com/agentrhq/webcmd)';

function requireQuery(value) {
    const query = String(value ?? '').trim();
    if (!query) throw new ArgumentError('boardgamegeek query is required');
    return query;
}

function requireLimit(value) {
    const raw = value == null || value === '' ? 20 : value;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
        throw new ArgumentError('boardgamegeek limit must be an integer between 1 and 100');
    }
    return n;
}

function token() {
    const value = String(process.env[TOKEN_ENV] ?? '').trim();
    if (!value) {
        throw new AuthRequiredError('boardgamegeek.com', `Set ${TOKEN_ENV} to a BoardGameGeek XML API application Bearer token.`);
    }
    return value;
}

function decodeXml(value) {
    return String(value ?? '')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function attrs(xml) {
    const out = {};
    for (const match of String(xml ?? '').matchAll(/\s([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)) {
        out[match[1]] = decodeXml(match[2]);
    }
    return out;
}

function parseSearch(xml) {
    const rows = [];
    for (const match of String(xml ?? '').matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/g)) {
        const itemAttrs = attrs(match[1]);
        const nameMatch = match[2].match(/<name\b([^>]*)\/?>/);
        const yearMatch = match[2].match(/<yearpublished\b([^>]*)\/?>/);
        const name = attrs(nameMatch?.[1]).value ?? '';
        const yearRaw = attrs(yearMatch?.[1]).value;
        rows.push({
            id: itemAttrs.id ?? '',
            name,
            type: itemAttrs.type ?? '',
            yearPublished: yearRaw == null ? null : Number(yearRaw),
            url: itemAttrs.id ? `https://boardgamegeek.com/boardgame/${itemAttrs.id}` : '',
        });
    }
    return rows.filter((row) => row.id && row.name);
}

async function fetchXml(url) {
    const bearer = token();
    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                authorization: `Bearer ${bearer}`,
                'user-agent': UA,
                accept: 'application/xml,text/xml',
            },
        });
    } catch (err) {
        throw new CommandExecutionError(`boardgamegeek search request failed: ${err?.message ?? err}`);
    }
    if (resp.status === 401 || resp.status === 403) {
        throw new AuthRequiredError('boardgamegeek.com', `BoardGameGeek XML API rejected ${TOKEN_ENV}.`);
    }
    if (resp.status === 429 || resp.status === 500 || resp.status === 503) {
        throw new CommandExecutionError(`boardgamegeek search is rate limited or busy (HTTP ${resp.status}); retry later.`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`boardgamegeek search returned HTTP ${resp.status}`);
    }
    return resp.text();
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
        const query = requireQuery(args.query);
        const limit = requireLimit(args.limit);
        const type = String(args.type ?? 'boardgame').trim();
        const url = new URL(SEARCH_URL);
        url.searchParams.set('query', query);
        if (type !== 'all') url.searchParams.set('type', type);
        if (args.exact) url.searchParams.set('exact', '1');

        const rows = parseSearch(await fetchXml(url));
        if (!rows.length) {
            throw new EmptyResultError('boardgamegeek search', `No BoardGameGeek games matched "${query}".`);
        }
        return rows.slice(0, limit).map((row, i) => ({ rank: i + 1, ...row }));
    },
});

export const __test__ = { parseSearch };
