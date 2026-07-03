import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const BSE_API = 'https://api.bseindia.com/BseIndiaAPI/api';
export const BSE_REALTIME_API = 'https://api.bseindia.com/RealTimeBseIndiaAPI/api';
export const BSE_SITE = 'https://www.bseindia.com';

const HEADERS = {
    accept: 'application/json',
    referer: `${BSE_SITE}/`,
    'user-agent': 'Mozilla/5.0',
};

export function requireLimit(value, defaultValue = 10, maxValue = 100) {
    const rawLimit = value ?? defaultValue;
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError('bse-india limit must be a positive integer');
    }
    if (limit > maxValue) {
        throw new ArgumentError(`bse-india limit must be <= ${maxValue}`);
    }
    return limit;
}

export function requireText(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`bse-india ${label} is required`);
    return text;
}

export function toNumber(value) {
    if (value == null || value === '') return null;
    const n = Number(String(value).replace(/[,+%]/g, '').trim());
    return Number.isFinite(n) ? n : null;
}

export function text(value) {
    if (value == null) return null;
    const s = String(value).trim();
    return s || null;
}

export async function bseJson(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: HEADERS });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err?.message ?? err}`);
    }
    if (!resp.ok) throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    try {
        return await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
}

export function tableRows(body, label) {
    const rows = Array.isArray(body?.Table) ? body.Table : [];
    if (!rows.length) throw new EmptyResultError(label, 'BSE returned no rows.');
    return rows;
}
