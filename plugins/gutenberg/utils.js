// Shared helpers for Project Gutenberg's public, anonymous HTML catalog.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const GUTENBERG_ORIGIN = 'https://www.gutenberg.org';
export const GUTENBERG_DOMAIN = 'www.gutenberg.org';
const UA = 'webcmd-gutenberg-adapter (+https://github.com/agentrhq/webcmd)';

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
};

export function decodeHtml(value) {
    return String(value ?? '')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
        .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] ?? match);
}

export function textFromHtml(value) {
    return decodeHtml(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function requireQuery(value) {
    const query = String(value ?? '').trim();
    if (!query) throw new ArgumentError('gutenberg search query cannot be empty');
    if (query.length > 200) throw new ArgumentError('gutenberg search query must be <= 200 characters');
    return query;
}

export function requireLimit(value, defaultValue = 10, maxValue = 25) {
    const limit = Number(value ?? defaultValue);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError('gutenberg limit must be a positive integer');
    }
    if (limit > maxValue) throw new ArgumentError(`gutenberg limit must be <= ${maxValue}`);
    return limit;
}

export function requireBookId(value) {
    const raw = String(value ?? '').trim();
    const fromUrl = raw.match(/(?:^|\/)ebooks\/(\d+)(?:[/?#.]|$)/)?.[1];
    const id = fromUrl ?? raw;
    if (!/^[1-9]\d*$/.test(id)) {
        throw new ArgumentError(
            `gutenberg book id "${raw}" is invalid`,
            'Use a numeric eBook id from `gutenberg search`, or a gutenberg.org/ebooks/<id> URL.',
        );
    }
    return id;
}

export async function gutenbergFetch(path, label) {
    const url = `${GUTENBERG_ORIGIN}${path}`;
    let response;
    try {
        response = await fetch(url, {
            headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': UA },
        });
    } catch (error) {
        throw new CommandExecutionError(
            `${label} request failed: ${error?.message ?? error}`,
            'Check that www.gutenberg.org is reachable from this network.',
        );
    }
    if (response.status === 404) {
        throw new EmptyResultError(label, `Project Gutenberg returned 404 for ${url}.`);
    }
    if (response.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Wait before retrying; Project Gutenberg asks automated clients to keep request volume low.',
        );
    }
    if (!response.ok) throw new CommandExecutionError(`${label} returned HTTP ${response.status}`);
    return response.text();
}
