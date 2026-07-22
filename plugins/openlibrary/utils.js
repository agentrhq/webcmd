// Shared helpers for the Open Library adapters.
//
// Open Library exposes a public, unauthenticated JSON API for human-facing book
// discovery and lookup. Each command performs one low-volume request.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const OPENLIBRARY_ORIGIN = 'https://openlibrary.org';
export const OPENLIBRARY_DOMAIN = 'openlibrary.org';
const UA = 'webcmd-openlibrary-adapter (+https://github.com/agentrhq/webcmd)';

export function requireString(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`openlibrary ${label} cannot be empty`);
    return text;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const number = Number(value ?? defaultValue);
    if (!Number.isInteger(number) || number <= 0) {
        throw new ArgumentError(`openlibrary ${label} must be a positive integer`);
    }
    if (number > maxValue) {
        throw new ArgumentError(`openlibrary ${label} must be <= ${maxValue}`);
    }
    return number;
}

function requireOpenLibraryId(value, kind, suffix) {
    const raw = String(value ?? '').trim();
    const fromPath = raw.match(new RegExp(`(?:^|/)${kind}s/(OL\\d+${suffix})(?:[/?#]|$)`, 'i'))?.[1];
    const id = (fromPath ?? raw).toUpperCase();
    if (!new RegExp(`^OL\\d+${suffix}$`).test(id)) {
        throw new ArgumentError(
            `openlibrary ${kind} id "${raw}" is invalid`,
            `Expected an Open Library ${kind} id like OL27448${suffix}, or its openlibrary.org URL.`,
        );
    }
    return id;
}

export function requireWorkId(value) {
    return requireOpenLibraryId(value, 'work', 'W');
}

export function requireAuthorId(value) {
    return requireOpenLibraryId(value, 'author', 'A');
}

export function textValue(value) {
    const text = typeof value === 'string' ? value : value?.value;
    return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

export function joinFirst(value, max = 8) {
    return Array.isArray(value)
        ? value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, max).join(', ')
        : '';
}

export async function openLibraryFetch(url, label) {
    let response;
    try {
        response = await fetch(url, {
            headers: { accept: 'application/json', 'user-agent': UA },
        });
    } catch (error) {
        throw new CommandExecutionError(
            `${label} request failed: ${error?.message ?? error}`,
            'Check that openlibrary.org is reachable from this network.',
        );
    }

    if (response.status === 404) {
        throw new EmptyResultError(label, `Open Library returned 404 for ${url}.`);
    }
    if (response.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Open Library limits anonymous clients to about one request per second; wait and retry.',
        );
    }
    if (!response.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${response.status}`);
    }

    try {
        return await response.json();
    } catch (error) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${error?.message ?? error}`);
    }
}
