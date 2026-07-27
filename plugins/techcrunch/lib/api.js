import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';

const POSTS_URL = 'https://techcrunch.com/wp-json/wp/v2/posts';
const MAX_LIMIT = 50;

export function parseLimit(raw) {
    const value = raw === undefined || raw === null || raw === '' ? 20 : Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return value;
}

export function plainText(value) {
    return String(value ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;|&#039;|&#8217;/g, "'")
        .replace(/&#8220;|&#8221;/g, '"')
        .replace(/&#8211;/g, '–')
        .replace(/&#8212;/g, '—')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export async function fetchPosts(params, request = fetch) {
    const url = new URL(POSTS_URL);
    for (const [name, value] of Object.entries(params)) {
        url.searchParams.set(name, String(value));
    }

    let response;
    try {
        response = await request(url, {
            headers: { Accept: 'application/json' },
        });
    } catch (error) {
        throw new CommandExecutionError(`TechCrunch request failed: ${error.message}`);
    }
    if (!response.ok) {
        throw new CommandExecutionError(`TechCrunch request failed with HTTP ${response.status}`);
    }

    let posts;
    try {
        posts = await response.json();
    } catch (error) {
        throw new CommandExecutionError(`TechCrunch returned malformed JSON: ${error.message}`);
    }
    if (!Array.isArray(posts)) {
        throw new CommandExecutionError('TechCrunch returned an unexpected response.');
    }
    return posts;
}

export function postSummary(post, rank) {
    return {
        rank,
        title: plainText(post?.title?.rendered),
        author: plainText(post?.yoast_head_json?.author) || null,
        publishedAt: post?.date || null,
        description: plainText(
            post?.yoast_head_json?.description || post?.excerpt?.rendered,
        ).slice(0, 240) || null,
        url: post?.link || null,
    };
}
