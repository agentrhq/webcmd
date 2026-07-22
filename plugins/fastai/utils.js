import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';

export const FASTAI_BASE = 'https://forums.fast.ai';

export function requireString(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`fastai ${label} is required`);
    return text;
}

export function requireBoundedInt(value, defaultValue, maxValue, label) {
    const number = Number(value ?? defaultValue);
    if (!Number.isInteger(number) || number <= 0) {
        throw new ArgumentError(`fastai ${label} must be a positive integer`);
    }
    if (number > maxValue) {
        throw new ArgumentError(`fastai ${label} must be <= ${maxValue}`);
    }
    return number;
}

export async function fastaiFetch(path, label) {
    let response;
    try {
        response = await fetch(`${FASTAI_BASE}${path}`, {
            headers: { Accept: 'application/json' },
        });
    }
    catch (error) {
        throw new CommandExecutionError(
            `fastai ${label} request failed: ${error?.message ?? error}`,
            'Check that forums.fast.ai is reachable and try again.',
        );
    }
    if (response.status === 404) return null;
    if (!response.ok) {
        throw new CommandExecutionError(`fastai ${label} returned HTTP ${response.status}`);
    }
    try {
        return await response.json();
    }
    catch (error) {
        throw new CommandExecutionError(`fastai ${label} returned malformed JSON: ${error?.message ?? error}`);
    }
}

const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ',
};

export function htmlToText(value) {
    return String(value ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>|<\/li>|<\/blockquote>|<\/pre>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
        .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (entity, name) => ENTITIES[name] ?? entity)
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function topicUrl(topic) {
    return topic?.id ? `${FASTAI_BASE}/t/${topic.slug || '-'}/${topic.id}` : '';
}
