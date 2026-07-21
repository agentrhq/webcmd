// Shared helpers for the BikeWale adapters.
//
// Uses BikeWale's anonymous autocomplete endpoint. The endpoint backs the
// public search box and returns public model / make suggestions without login.
import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';

export const BIKEWALE_BASE = 'https://www.bikewale.com';
export const AUTOCOMPLETE_SOURCES = '1,2,3,5,11,15,13,14,10,16,17,4,8,9,6,19,20,21,24,7,34';
const UA = 'webcmd-bikewale-adapter (+https://github.com/agentrhq/webcmd)';

export function requireQuery(value) {
    const query = String(value ?? '').trim();
    if (!query) {
        throw new ArgumentError('bikewale search query cannot be empty');
    }
    if (query.length > 80) {
        throw new ArgumentError('bikewale search query must be <= 80 characters');
    }
    return query;
}

export function requireLimit(value, defaultValue = 10, maxValue = 20) {
    const raw = value ?? defaultValue;
    const limit = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError('bikewale limit must be a positive integer');
    }
    if (limit > maxValue) {
        throw new ArgumentError(`bikewale limit must be <= ${maxValue}`);
    }
    return limit;
}

export async function bikewaleFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                accept: 'application/json',
                'user-agent': UA,
            },
        });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that www.bikewale.com is reachable from this network.',
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

export function canonicalUrl(path) {
    const raw = String(path ?? '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${BIKEWALE_BASE}${raw.startsWith('/') ? raw : `/${raw}`}`;
}
