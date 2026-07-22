// Shared helpers for the Open Brewery DB adapter.
//
// Open Brewery DB publishes a free, unauthenticated REST API documented at
// https://www.openbrewerydb.org/documentation.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const OPENBREWERYDB_BASE = 'https://api.openbrewerydb.org/v1';
const UA = 'webcmd-openbrewerydb-adapter (+https://github.com/agentrhq/webcmd)';

export function requireString(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`openbrewerydb ${label} cannot be empty`);
    return text;
}

export function requireBoundedInt(value, defaultValue, maxValue, label) {
    const raw = value ?? defaultValue;
    const number = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(number) || number <= 0) {
        throw new ArgumentError(`openbrewerydb ${label} must be a positive integer`);
    }
    if (number > maxValue) {
        throw new ArgumentError(`openbrewerydb ${label} must be <= ${maxValue}`);
    }
    return number;
}

export async function openBreweryDbFetch(url, label) {
    let response;
    try {
        response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
    }
    catch (error) {
        throw new CommandExecutionError(
            `${label} request failed: ${error?.message ?? error}`,
            'Check that api.openbrewerydb.org is reachable from this network.',
        );
    }
    if (response.status === 404) {
        throw new EmptyResultError(label, 'Open Brewery DB returned HTTP 404.');
    }
    if (response.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Wait briefly before retrying the Open Brewery DB request.',
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

export function projectBrewery(brewery) {
    const id = String(brewery?.id ?? '').trim();
    const address = [brewery?.address_1, brewery?.address_2, brewery?.address_3]
        .map((part) => String(part ?? '').trim())
        .filter(Boolean)
        .join(', ');
    return {
        id,
        name: String(brewery?.name ?? '').trim(),
        type: String(brewery?.brewery_type ?? '').trim(),
        address,
        city: String(brewery?.city ?? '').trim(),
        state: String(brewery?.state_province ?? '').trim(),
        postalCode: String(brewery?.postal_code ?? '').trim(),
        country: String(brewery?.country ?? '').trim(),
        latitude: brewery?.latitude == null ? null : Number(brewery.latitude),
        longitude: brewery?.longitude == null ? null : Number(brewery.longitude),
        phone: String(brewery?.phone ?? '').trim(),
        website: String(brewery?.website_url ?? '').trim(),
        apiUrl: id ? `${OPENBREWERYDB_BASE}/breweries/${encodeURIComponent(id)}` : '',
    };
}

export const BREWERY_COLUMNS = [
    'id', 'name', 'type', 'address', 'city', 'state', 'postalCode', 'country',
    'latitude', 'longitude', 'phone', 'website', 'apiUrl',
];
