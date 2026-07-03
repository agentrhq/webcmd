import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const API_BASE = 'https://images-api.nasa.gov';
const UA = 'webcmd-nasa-images-adapter (+https://github.com/agentrhq/webcmd)';

export function requireQuery(value) {
    const query = String(value ?? '').trim();
    if (!query) throw new ArgumentError('nasa-images query is required');
    return query;
}

export function requireNasaId(value) {
    const nasaId = String(value ?? '').trim();
    if (!nasaId) throw new ArgumentError('nasa-images nasaId is required');
    return nasaId;
}

export function intArg(value, defaultValue, maxValue, label) {
    const raw = value == null || value === '' ? defaultValue : value;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > maxValue) {
        throw new ArgumentError(`nasa-images ${label} must be an integer between 1 and ${maxValue}`);
    }
    return n;
}

export function yearArg(value, label) {
    if (value == null || value === '') return null;
    const year = Number(value);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
        throw new ArgumentError(`nasa-images ${label} must be a year between 1900 and 2100`);
    }
    return year;
}

export async function fetchJson(url, label, { emptyOn404 = false } = {}) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err?.message ?? err}`);
    }
    if (resp.status === 404 && emptyOn404) {
        throw new EmptyResultError(label, `${label} was not found.`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    try {
        return await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
}

export function collectionItems(body) {
    return Array.isArray(body?.collection?.items) ? body.collection.items : [];
}

export function firstData(item) {
    return Array.isArray(item?.data) && item.data.length ? item.data[0] : {};
}

export function firstPreview(item) {
    const link = Array.isArray(item?.links) ? item.links.find((l) => l?.href) : null;
    return String(link?.href ?? '').trim();
}

export function join(values, max = 5) {
    return Array.isArray(values) ? values.slice(0, max).filter(Boolean).join(', ') : '';
}
