// BMWBLOG search — anonymous read-only article search.
//
// Strategy: PUBLIC_API
// Contract: stable WordPress REST `/wp-json/wp/v2/posts` public endpoint
// Evidence: anonymous GET returned HTTP 200, JSON post rows, and `allow: GET`.
// Why not simpler: RSS exposes latest posts but not arbitrary article search.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const BASE_URL = 'https://www.bmwblog.com/wp-json/wp/v2/posts';
const UA = 'webcmd-bmwblog-adapter (+https://github.com/agentrhq/webcmd)';

const HTML_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    hellip: '…',
    ndash: '–',
    mdash: '—',
};

function requireQuery(value) {
    const query = String(value ?? '').trim();
    if (!query) {
        throw new ArgumentError('bmwblog query cannot be empty');
    }
    return query;
}

function requireBoundedInt(value, defaultValue, maxValue, label) {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`bmwblog ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`bmwblog ${label} must be <= ${maxValue}`);
    }
    return n;
}

function decodeHtml(value) {
    return String(value ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        })
        .replace(/&#(\d+);/g, (_, dec) => {
            const code = parseInt(dec, 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        })
        .replace(/&([a-zA-Z]+);/g, (match, name) => HTML_ENTITIES[name] ?? match)
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchJson(url, label) {
    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                'user-agent': UA,
                accept: 'application/json',
            },
        });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that www.bmwblog.com is reachable from this network.',
        );
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    try {
        return await resp.json();
    }
    catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
}

cli({
    site: 'bmwblog',
    name: 'search',
    access: 'read',
    description: 'Search BMWBLOG articles by keyword',
    domain: 'www.bmwblog.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: 'Search keywords, e.g. iX3' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of articles to return (1-50)' },
    ],
    columns: ['rank', 'id', 'title', 'slug', 'published', 'excerpt', 'url'],
    func: async (args) => {
        const query = requireQuery(args.query);
        const limit = requireBoundedInt(args.limit, 10, 50, 'limit');
        const url = new URL(BASE_URL);
        url.searchParams.set('search', query);
        url.searchParams.set('per_page', String(limit));
        url.searchParams.set('status', 'publish');
        url.searchParams.set('_fields', 'id,date,slug,link,title.rendered,excerpt.rendered');

        const body = await fetchJson(url.toString(), 'bmwblog search');
        const posts = Array.isArray(body) ? body : [];
        if (!posts.length) {
            throw new EmptyResultError('bmwblog search', `No BMWBLOG articles found for "${query}".`);
        }

        return posts.map((post, i) => ({
            rank: i + 1,
            id: post.id != null ? Number(post.id) : null,
            title: decodeHtml(post?.title?.rendered),
            slug: String(post.slug ?? ''),
            published: String(post.date ?? '').slice(0, 10),
            excerpt: decodeHtml(post?.excerpt?.rendered),
            url: String(post.link ?? ''),
        }));
    },
});
