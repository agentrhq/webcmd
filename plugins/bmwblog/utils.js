import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';

const API_BASE = 'https://www.bmwblog.com/wp-json/wp/v2/posts';
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

export function parseLimit(raw, fallback = 10) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    return value;
}

export function requireQuery(raw) {
    const query = String(raw ?? '').trim();
    if (!query) throw new ArgumentError('Search query cannot be empty');
    return query;
}

export function parseArticleSlug(raw) {
    const value = String(raw ?? '').trim();
    if (!value) throw new ArgumentError('Article URL or slug cannot be empty');

    let slug = value;
    if (/^https?:\/\//i.test(value)) {
        let parsed;
        try {
            parsed = new URL(value);
        } catch {
            throw new ArgumentError(`Invalid article URL: ${value}`);
        }
        if (!['bmwblog.com', 'www.bmwblog.com'].includes(parsed.hostname.toLowerCase())) {
            throw new ArgumentError(`Article URL must be on bmwblog.com, got ${parsed.hostname}`);
        }
        const parts = parsed.pathname.split('/').filter(Boolean);
        slug = parts.at(-1) || '';
    }

    try {
        slug = decodeURIComponent(slug);
    } catch {
        throw new ArgumentError(`Invalid article slug: ${slug}`);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
        throw new ArgumentError(`Invalid BMWBLOG article slug: ${slug}`);
    }
    return slug.toLowerCase();
}

export async function fetchPosts(params, command) {
    const url = new URL(API_BASE);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
    }

    let response;
    try {
        response = await fetch(url, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'webcmd/1.0 (+https://github.com/agentrhq/webcmd)',
            },
        });
    } catch (error) {
        throw new CommandExecutionError(`${command} request failed: ${error?.message || error}`);
    }

    if (!response.ok) {
        throw new CommandExecutionError(`${command} request failed: HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
        throw new CommandExecutionError(`${command} returned an unexpected non-JSON response`);
    }

    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw new CommandExecutionError(`${command} returned invalid JSON: ${error?.message || error}`);
    }
    if (!Array.isArray(data)) {
        throw new CommandExecutionError(`${command} returned an unexpected response shape`);
    }
    return data;
}

function decodeEntities(value) {
    const named = {
        amp: '&', apos: "'", gt: '>', hellip: '…', laquo: '«', ldquo: '“',
        lsquo: '‘', lt: '<', mdash: '—', nbsp: ' ', ndash: '–', quot: '"',
        raquo: '»', rdquo: '”', rsquo: '’', shy: '',
    };
    return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === '#') {
            const hex = entity[1]?.toLowerCase() === 'x';
            const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return named[entity.toLowerCase()] ?? match;
    });
}

export function htmlToText(html) {
    return decodeEntities(String(html ?? '')
        .replace(/<(script|style|iframe|svg|figure)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ' '))
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function articleSchema(post) {
    const graph = post?.yoast_head_json?.schema?.['@graph'];
    return Array.isArray(graph)
        ? graph.find((entry) => entry?.['@type'] === 'Article') || null
        : null;
}

function authorName(post, article) {
    if (typeof article?.author?.name === 'string') return article.author.name.trim();
    const author = post?.yoast_head_json?.author;
    return typeof author === 'string' ? author.trim() : '';
}

function datePublished(post, article) {
    if (article?.datePublished) return article.datePublished;
    if (post?.date_gmt) return `${post.date_gmt}Z`;
    return post?.date || '';
}

export function mapPost(post, rank) {
    const article = articleSchema(post);
    const sections = Array.isArray(article?.articleSection) ? article.articleSection.filter(Boolean) : [];
    return {
        rank,
        title: htmlToText(post?.title?.rendered),
        date: datePublished(post, article),
        author: authorName(post, article),
        section: sections.join(', '),
        excerpt: htmlToText(post?.excerpt?.rendered),
        url: String(post?.link || article?.mainEntityOfPage?.['@id'] || '').trim(),
    };
}

export function mapArticle(post) {
    const article = articleSchema(post);
    const sections = Array.isArray(article?.articleSection) ? article.articleSection.filter(Boolean) : [];
    return {
        title: htmlToText(post?.title?.rendered),
        date: datePublished(post, article),
        author: authorName(post, article),
        sections: sections.join(', '),
        excerpt: htmlToText(post?.excerpt?.rendered),
        url: String(post?.link || article?.mainEntityOfPage?.['@id'] || '').trim(),
        content: htmlToText(post?.content?.rendered),
    };
}
