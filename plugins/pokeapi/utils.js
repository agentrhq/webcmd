import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const API_BASE = 'https://pokeapi.co/api/v2';
const RESOURCE = /^(?:[1-9]\d*|[a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function requireResource(value, label) {
    const resource = String(value ?? '').trim().toLowerCase();
    if (!resource) {
        throw new ArgumentError(`pokeapi ${label} name or id is required`);
    }
    if (!RESOURCE.test(resource)) {
        throw new ArgumentError(`pokeapi ${label} must be a positive numeric id or lowercase name slug`);
    }
    return resource;
}

export async function pokeFetch(kind, resource) {
    const label = `pokeapi ${kind} ${resource}`;
    const url = `${API_BASE}/${kind}/${encodeURIComponent(resource)}/`;
    let response;
    try {
        response = await fetch(url, {
            headers: {
                accept: 'application/json',
                'user-agent': 'webcmd-pokeapi-plugin (+https://github.com/agentrhq/webcmd)',
            },
        });
    }
    catch (error) {
        throw new CommandExecutionError(
            `${label} request failed: ${error?.message ?? error}`,
            'Check that pokeapi.co is reachable from this network.',
        );
    }
    if (response.status === 404) {
        throw new EmptyResultError(label, `PokéAPI has no ${kind} named "${resource}".`);
    }
    if (response.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Wait briefly before retrying the anonymous PokéAPI request.',
        );
    }
    if (!response.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${response.status}`);
    }
    try {
        return await response.json();
    }
    catch (error) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${error?.message ?? error}`);
    }
}

export function names(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => item?.name ?? item?.type?.name ?? item?.ability?.name)
        .filter(Boolean)
        .join(', ');
}

export function englishEntry(entries, field) {
    const list = Array.isArray(entries) ? entries : [];
    return String(list.find((entry) => entry?.language?.name === 'en')?.[field] ?? '').replace(/\s+/g, ' ').trim();
}
