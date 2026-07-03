import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
    FORECAST_BASE,
    applyUnitParams,
    describeWeatherCode,
    fetchJson,
    locationFields,
    requireUnits,
    resolveLocation,
} from './utils.js';

cli({
    site: 'open-meteo',
    name: 'current',
    access: 'read',
    description: 'Current weather from Open-Meteo for a city or lat,lon',
    domain: 'open-meteo.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'location', positional: true, required: true, help: 'City name or "lat,lon"' },
        { name: 'units', default: 'metric', choices: ['metric', 'imperial'], help: 'metric or imperial units' },
    ],
    columns: [
        'location', 'region', 'country', 'latitude', 'longitude', 'timezone',
        'time', 'temperature', 'apparentTemperature', 'humidity',
        'precipitation', 'cloudCover', 'windSpeed', 'windDirection',
        'windGusts', 'isDay', 'weather',
    ],
    func: async (args) => {
        const location = await resolveLocation(args.location);
        const units = requireUnits(args.units);
        const url = new URL(FORECAST_BASE);
        url.searchParams.set('latitude', String(location.latitude));
        url.searchParams.set('longitude', String(location.longitude));
        url.searchParams.set('timezone', 'auto');
        url.searchParams.set('current', [
            'temperature_2m',
            'apparent_temperature',
            'relative_humidity_2m',
            'precipitation',
            'weather_code',
            'cloud_cover',
            'wind_speed_10m',
            'wind_direction_10m',
            'wind_gusts_10m',
            'is_day',
        ].join(','));
        applyUnitParams(url, units);

        const body = await fetchJson(url, 'open-meteo current');
        const cur = body?.current ?? {};
        return [{
            ...locationFields(location),
            timezone: body?.timezone ?? null,
            time: cur.time ?? null,
            temperature: cur.temperature_2m ?? null,
            apparentTemperature: cur.apparent_temperature ?? null,
            humidity: cur.relative_humidity_2m ?? null,
            precipitation: cur.precipitation ?? null,
            cloudCover: cur.cloud_cover ?? null,
            windSpeed: cur.wind_speed_10m ?? null,
            windDirection: cur.wind_direction_10m ?? null,
            windGusts: cur.wind_gusts_10m ?? null,
            isDay: cur.is_day == null ? null : Boolean(cur.is_day),
            weather: describeWeatherCode(cur.weather_code),
        }];
    },
});
