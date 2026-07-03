// Open-Meteo shared helpers — free weather forecast + geocoding, no API key.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const GEOCODING_BASE = 'https://geocoding-api.open-meteo.com/v1/search';
export const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const UA = 'webcmd-open-meteo/1.0';

const WEATHER_CODES = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
};

export function requireLocation(value) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError('open-meteo location is required');
    return s;
}

export function requireDays(value, def = 7) {
    const n = value == null || value === '' ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 16) {
        throw new ArgumentError('--days must be an integer between 1 and 16');
    }
    return n;
}

export function requireUnits(value) {
    const units = String(value ?? 'metric').trim().toLowerCase();
    if (units !== 'metric' && units !== 'imperial') {
        throw new ArgumentError('--units must be one of: metric, imperial');
    }
    return units;
}

export function describeWeatherCode(code) {
    const n = Number(code);
    return WEATHER_CODES[n] ?? (Number.isFinite(n) ? `Weather code ${n}` : null);
}

function parseLatLon(location) {
    const match = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(location);
    if (!match) return null;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new ArgumentError('lat,lon must be valid WGS84 coordinates');
    }
    return { name: location, latitude, longitude, country: null, admin1: null };
}

export async function fetchJson(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} rate-limited (HTTP 429); retry later.`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}.`);
    }
    try {
        return await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned non-JSON body: ${err.message}`);
    }
}

export async function resolveLocation(rawLocation) {
    const location = requireLocation(rawLocation);
    const coords = parseLatLon(location);
    if (coords) return coords;

    const url = new URL(GEOCODING_BASE);
    url.searchParams.set('name', location);
    url.searchParams.set('count', '1');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const body = await fetchJson(url, 'open-meteo geocoding');
    const first = Array.isArray(body?.results) ? body.results[0] : null;
    if (!first) {
        throw new EmptyResultError('open-meteo geocoding', `No Open-Meteo location match for "${location}".`);
    }
    return {
        name: first.name ?? location,
        latitude: Number(first.latitude),
        longitude: Number(first.longitude),
        country: first.country ?? null,
        admin1: first.admin1 ?? null,
    };
}

export function applyUnitParams(url, units) {
    if (units === 'imperial') {
        url.searchParams.set('temperature_unit', 'fahrenheit');
        url.searchParams.set('wind_speed_unit', 'mph');
        url.searchParams.set('precipitation_unit', 'inch');
    }
}

export function locationFields(location) {
    return {
        location: location.name,
        region: location.admin1,
        country: location.country,
        latitude: location.latitude,
        longitude: location.longitude,
    };
}
