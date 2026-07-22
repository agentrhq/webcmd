// Shared helpers for the Open Library adapters.
//
// Open Library publishes a free, unauthenticated Books API at
// https://openlibrary.org/developers/api. This adapter uses the public search
// endpoint only; no cookies, login, or account state are required.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const OPENLIBRARY_BASE = 'https://openlibrary.org';
const UA = 'webcmd-openlibrary-adapter/1.0 (+https://github.com/agentrhq/webcmd)';

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`openlibrary ${label} cannot be empty`);
    if (s.length > 200) {
        throw new ArgumentError(`openlibrary ${label} must be <= 200 characters`);
    }
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`openlibrary ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`openlibrary ${label} must be <= ${maxValue}`);
    }
    return n;
}

export async function openLibraryFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that openlibrary.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Open Library returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Open Library throttles anonymous traffic; back off and retry.',
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

export function joinList(value, max = 5) {
    if (!Array.isArray(value)) return '';
    const items = value.map(item => String(item ?? '').trim()).filter(Boolean);
    if (items.length === 0) return '';
    if (items.length > max) return [...items.slice(0, max), `(+${items.length - max})`].join(', ');
    return items.join(', ');
}

export function normalizeWorkKey(key) {
    const s = String(key ?? '').trim();
    const match = s.match(/^\/works\/(OL\d+W)$/i) ?? s.match(/^(OL\d+W)$/i);
    return match ? match[1].toUpperCase() : '';
}
