import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
    AIR_QUALITY_BASE,
    fetchJson,
    locationFields,
    requireHours,
    resolveLocation,
} from './utils.js';

cli({
    site: 'open-meteo',
    name: 'air-quality',
    access: 'read',
    description: 'Hourly Open-Meteo air quality forecast for a city or lat,lon',
    domain: 'open-meteo.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'location', positional: true, required: true, help: 'City name or "lat,lon"' },
        { name: 'hours', type: 'int', default: 24, help: 'Forecast hours (1-168)' },
    ],
    columns: [
        'rank', 'location', 'region', 'country', 'time',
        'usAqi', 'europeanAqi', 'pm10', 'pm25',
        'nitrogenDioxide', 'ozone', 'uvIndex',
    ],
    func: async (args) => {
        const location = await resolveLocation(args.location);
        const hours = requireHours(args.hours);
        const url = new URL(AIR_QUALITY_BASE);
        url.searchParams.set('latitude', String(location.latitude));
        url.searchParams.set('longitude', String(location.longitude));
        url.searchParams.set('timezone', 'auto');
        url.searchParams.set('forecast_days', String(Math.ceil(hours / 24)));
        url.searchParams.set('hourly', [
            'us_aqi',
            'european_aqi',
            'pm10',
            'pm2_5',
            'nitrogen_dioxide',
            'ozone',
            'uv_index',
        ].join(','));

        const body = await fetchJson(url, 'open-meteo air-quality');
        const hourly = body?.hourly ?? {};
        const times = Array.isArray(hourly.time) ? hourly.time : [];
        const rows = times.slice(0, hours).map((time, i) => ({
            rank: i + 1,
            ...locationFields(location),
            time,
            usAqi: hourly.us_aqi?.[i] ?? null,
            europeanAqi: hourly.european_aqi?.[i] ?? null,
            pm10: hourly.pm10?.[i] ?? null,
            pm25: hourly.pm2_5?.[i] ?? null,
            nitrogenDioxide: hourly.nitrogen_dioxide?.[i] ?? null,
            ozone: hourly.ozone?.[i] ?? null,
            uvIndex: hourly.uv_index?.[i] ?? null,
        }));
        if (!rows.length) {
            throw new EmptyResultError('open-meteo air-quality', 'Open-Meteo returned no air quality rows.');
        }
        return rows.map(({ latitude, longitude, ...row }) => row);
    },
});
