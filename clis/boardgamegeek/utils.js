import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const API_BASE = 'https://boardgamegeek.com/xmlapi2';
const TOKEN_ENV = 'BOARDGAMEGEEK_TOKEN';
const UA = 'webcmd-boardgamegeek-adapter (+https://github.com/agentrhq/webcmd)';

export function requiredText(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`boardgamegeek ${label} is required`);
    return text;
}

export function positiveInt(value, defaultValue, maxValue, label) {
    const raw = value == null || value === '' ? defaultValue : value;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > maxValue) {
        throw new ArgumentError(`boardgamegeek ${label} must be an integer between 1 and ${maxValue}`);
    }
    return n;
}

export function optionalDate(value, label) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new ArgumentError(`boardgamegeek ${label} must be YYYY-MM-DD`);
    }
    return text;
}

function token() {
    const value = String(process.env[TOKEN_ENV] ?? '').trim();
    if (!value) {
        throw new AuthRequiredError('boardgamegeek.com', `Set ${TOKEN_ENV} to a BoardGameGeek XML API application Bearer token.`);
    }
    return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchXml(url, label, { retry202 = false } = {}) {
    const bearer = token();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        let resp;
        try {
            resp = await fetch(url, {
                headers: {
                    authorization: `Bearer ${bearer}`,
                    'user-agent': UA,
                    accept: 'application/xml,text/xml',
                },
            });
        } catch (err) {
            throw new CommandExecutionError(`${label} request failed: ${err?.message ?? err}`);
        }
        if (resp.status === 202 && retry202 && attempt < 3) {
            await sleep(1000);
            continue;
        }
        if (resp.status === 401 || resp.status === 403) {
            throw new AuthRequiredError('boardgamegeek.com', `BoardGameGeek XML API rejected ${TOKEN_ENV}.`);
        }
        if (resp.status === 202) {
            throw new CommandExecutionError(`${label} is queued by BoardGameGeek; retry later.`);
        }
        if (resp.status === 429 || resp.status === 500 || resp.status === 503) {
            throw new CommandExecutionError(`${label} is rate limited or busy (HTTP ${resp.status}); retry later.`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
        }
        return resp.text();
    }
    throw new CommandExecutionError(`${label} is queued by BoardGameGeek; retry later.`);
}

export function decodeXml(value) {
    return String(value ?? '')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

export function attrs(xml) {
    const out = {};
    for (const match of String(xml ?? '').matchAll(/\s([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)) {
        out[match[1]] = decodeXml(match[2]);
    }
    return out;
}

export function blocks(xml, tag) {
    const out = [];
    const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'g');
    for (const match of String(xml ?? '').matchAll(re)) {
        out.push({ attrs: attrs(match[1]), body: match[2] });
    }
    return out;
}

export function valueTag(xml, tag) {
    const selfClosing = String(xml ?? '').match(new RegExp(`<${tag}\\b([^>]*)\\s*\\/>`));
    if (selfClosing) return attrs(selfClosing[1]).value ?? '';
    const paired = String(xml ?? '').match(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`));
    if (!paired) return '';
    return attrs(paired[1]).value ?? decodeXml(paired[2]).replace(/\s+/g, ' ').trim();
}

export function numberValue(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export function primaryName(body) {
    const primary = String(body ?? '').match(/<name\b([^>]*\btype="primary"[^>]*)\/?>/);
    const any = primary ?? String(body ?? '').match(/<name\b([^>]*)\/?>/);
    return attrs(any?.[1]).value ?? '';
}

export function linkValues(body, type, max = 5) {
    const out = [];
    for (const match of String(body ?? '').matchAll(/<link\b([^>]*)\/?>/g)) {
        const itemAttrs = attrs(match[1]);
        if (itemAttrs.type === type && itemAttrs.value) out.push(itemAttrs.value);
        if (out.length >= max) break;
    }
    return out.join(', ');
}

export function requireRows(rows, label, hint) {
    if (!rows.length) throw new EmptyResultError(label, hint);
    return rows;
}
