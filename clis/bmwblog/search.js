// bmwblog search — search published BMWBLOG articles through its public WordPress REST API.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const API_URL = 'https://www.bmwblog.com/wp-json/wp/v2/posts';

function decodeHtml(value) {
    const named = {
        amp: '&', apos: "'", gt: '>', hellip: '…', lt: '<', nbsp: ' ', quot: '"',
        lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—',
        bull: '•', cent: '¢', copy: '©', euro: '€', laquo: '«', middot: '·',
        pound: '£', raquo: '»', reg: '®', trade: '™', yen: '¥',
    };
    const decoded = value
        .replace(/<[^>]*>/g, ' ')
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
            const number = code[0].toLowerCase() === 'x'
                ? Number.parseInt(code.slice(1), 16)
                : Number.parseInt(code, 10);
            if (!Number.isInteger(number) || number < 0 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) {
                throw new CommandExecutionError('BMWBLOG search returned an invalid numeric HTML entity');
            }
            return String.fromCodePoint(number);
        })
        .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.!?;:…])/g, '$1')
        .trim();
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(decoded)) {
        throw new CommandExecutionError('BMWBLOG search returned unsafe control characters');
    }
    return decoded;
}

function parseLimit(value) {
    const limit = value == null || value === '' ? 10 : Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new ArgumentError('--limit must be an integer between 1 and 50');
    }
    return limit;
}

function normaliseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?$/.test(value)) {
        throw new CommandExecutionError('BMWBLOG search returned an invalid publication date');
    }
    const parsed = new Date(`${value}Z`);
    if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) {
        throw new CommandExecutionError('BMWBLOG search returned an invalid publication date');
    }
    return `${value}Z`;
}

function isCanonicalArticleUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.hostname === 'www.bmwblog.com'
            && url.port === ''
            && url.username === ''
            && url.password === ''
            && url.search === ''
            && url.hash === ''
            && /^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/$/.test(url.pathname);
    } catch {
        return false;
    }
}

cli({
    site: 'bmwblog',
    name: 'search',
    access: 'read',
    description: 'Search published BMWBLOG articles',
    domain: 'www.bmwblog.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, type: 'string', required: true, help: 'Article search query, for example "BMW M3"' },
        { name: 'limit', type: 'int', default: 10, help: 'Maximum articles to return (1-50)' },
    ],
    columns: ['rank', 'id', 'title', 'date', 'excerpt', 'url'],
    func: async (args) => {
        const query = String(args.query ?? '').trim();
        if (!query) throw new ArgumentError('query must be a non-empty string');
        const limit = parseLimit(args.limit);
        const params = new URLSearchParams({
            search: query,
            per_page: String(limit),
            _fields: 'id,date_gmt,link,title,excerpt',
        });

        let response;
        try {
            response = await fetch(`${API_URL}?${params}`, {
                redirect: 'error',
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'WebCMD BMWBLOG adapter',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`BMWBLOG search request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!response.ok) {
            throw new CommandExecutionError(`BMWBLOG search request failed: HTTP ${response.status}`);
        }

        let posts;
        try {
            posts = await response.json();
        } catch (error) {
            throw new CommandExecutionError(`BMWBLOG search returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!Array.isArray(posts)) {
            throw new CommandExecutionError('BMWBLOG search returned an unexpected response shape');
        }
        if (!posts.length) {
            throw new EmptyResultError('bmwblog search', `No BMWBLOG articles matched "${query}".`);
        }

        const rows = posts.slice(0, limit).map((post, index) => {
            if (
                post == null
                || typeof post !== 'object'
                || !Number.isSafeInteger(post.id)
                || post.id <= 0
                || typeof post.date_gmt !== 'string'
                || typeof post.link !== 'string'
                || typeof post.title?.rendered !== 'string'
                || typeof post.excerpt?.rendered !== 'string'
            ) {
                throw new CommandExecutionError('BMWBLOG search returned malformed article data');
            }
            const url = post.link.trim();
            if (!isCanonicalArticleUrl(url)) {
                throw new CommandExecutionError('BMWBLOG search returned a non-canonical article URL');
            }
            return {
                rank: index + 1,
                id: post.id,
                title: decodeHtml(post.title.rendered),
                date: normaliseDate(post.date_gmt),
                excerpt: decodeHtml(post.excerpt.rendered),
                url,
            };
        });
        if (rows.some((row) => !row.title)) {
            throw new CommandExecutionError('BMWBLOG search returned an empty article title');
        }
        return rows;
    },
});
