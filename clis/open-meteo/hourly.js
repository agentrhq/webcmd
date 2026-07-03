import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
    FORECAST_BASE,
    applyUnitParams,
    describeWeatherCode,
    fetchJson,
    locationFields,
    requireHours,
    requireUnits,
    resolveLocation,
} from './utils.js';

cli({
    site: 'open-meteo',
    name: 'hourly',
    access: 'read',
    description: 'Hourly Open-Meteo forecast for a city or lat,lon',
    domain: 'open-meteo.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'location', positional: true, required: true, help: 'City name or "lat,lon"' },
        { name: 'hours', type: 'int', default: 24, help: 'Forecast hours (1-168)' },
        { name: 'units', default: 'metric', choices: ['metric', 'imperial'], help: 'metric or imperial units' },
    ],
    columns: [
        'rank', 'location', 'region', 'country', 'time', 'weather',
        'temperature', 'humidity', 'precipitationProbability',
        'precipitation', 'windSpeed', 'windGusts',
    ],
    func: async (args) => {
        const location = await resolveLocation(args.location);
        const hours = requireHours(args.hours);
        const units = requireUnits(args.units);
        const url = new URL(FORECAST_BASE);
        url.searchParams.set('latitude', String(location.latitude));
        url.searchParams.set('longitude', String(location.longitude));
        url.searchParams.set('timezone', 'auto');
        url.searchParams.set('forecast_days', String(Math.ceil(hours / 24)));
        url.searchParams.set('hourly', [
            'temperature_2m',
            'relative_humidity_2m',
            'precipitation_probability',
            'precipitation',
            'weather_code',
            'wind_speed_10m',
            'wind_gusts_10m',
        ].join(','));
        applyUnitParams(url, units);

        const body = await fetchJson(url, 'open-meteo hourly');
        const hourly = body?.hourly ?? {};
        const times = Array.isArray(hourly.time) ? hourly.time : [];
        const rows = times.slice(0, hours).map((time, i) => ({
            rank: i + 1,
            ...locationFields(location),
            time,
            weather: describeWeatherCode(hourly.weather_code?.[i]),
            temperature: hourly.temperature_2m?.[i] ?? null,
            humidity: hourly.relative_humidity_2m?.[i] ?? null,
            precipitationProbability: hourly.precipitation_probability?.[i] ?? null,
            precipitation: hourly.precipitation?.[i] ?? null,
            windSpeed: hourly.wind_speed_10m?.[i] ?? null,
            windGusts: hourly.wind_gusts_10m?.[i] ?? null,
        }));
        if (!rows.length) {
            throw new EmptyResultError('open-meteo hourly', 'Open-Meteo returned no hourly forecast rows.');
        }
        return rows.map(({ latitude, longitude, ...row }) => row);
    },
});
