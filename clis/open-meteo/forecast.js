import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
    FORECAST_BASE,
    applyUnitParams,
    describeWeatherCode,
    fetchJson,
    locationFields,
    requireDays,
    requireUnits,
    resolveLocation,
} from './utils.js';

cli({
    site: 'open-meteo',
    name: 'forecast',
    access: 'read',
    description: 'Daily Open-Meteo forecast for a city or lat,lon',
    domain: 'open-meteo.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'location', positional: true, required: true, help: 'City name or "lat,lon"' },
        { name: 'days', type: 'int', default: 7, help: 'Forecast days (1-16)' },
        { name: 'units', default: 'metric', choices: ['metric', 'imperial'], help: 'metric or imperial units' },
    ],
    columns: [
        'rank', 'location', 'region', 'country', 'latitude', 'longitude',
        'timezone', 'date', 'weather', 'tempMin', 'tempMax',
        'apparentTempMin', 'apparentTempMax', 'precipitation',
        'precipitationProbability', 'windSpeedMax', 'windGustsMax',
    ],
    func: async (args) => {
        const location = await resolveLocation(args.location);
        const days = requireDays(args.days);
        const units = requireUnits(args.units);
        const url = new URL(FORECAST_BASE);
        url.searchParams.set('latitude', String(location.latitude));
        url.searchParams.set('longitude', String(location.longitude));
        url.searchParams.set('timezone', 'auto');
        url.searchParams.set('forecast_days', String(days));
        url.searchParams.set('daily', [
            'weather_code',
            'temperature_2m_min',
            'temperature_2m_max',
            'apparent_temperature_min',
            'apparent_temperature_max',
            'precipitation_sum',
            'precipitation_probability_max',
            'wind_speed_10m_max',
            'wind_gusts_10m_max',
        ].join(','));
        applyUnitParams(url, units);

        const body = await fetchJson(url, 'open-meteo forecast');
        const daily = body?.daily ?? {};
        const dates = Array.isArray(daily.time) ? daily.time : [];
        return dates.map((date, i) => ({
            rank: i + 1,
            ...locationFields(location),
            timezone: body?.timezone ?? null,
            date,
            weather: describeWeatherCode(daily.weather_code?.[i]),
            tempMin: daily.temperature_2m_min?.[i] ?? null,
            tempMax: daily.temperature_2m_max?.[i] ?? null,
            apparentTempMin: daily.apparent_temperature_min?.[i] ?? null,
            apparentTempMax: daily.apparent_temperature_max?.[i] ?? null,
            precipitation: daily.precipitation_sum?.[i] ?? null,
            precipitationProbability: daily.precipitation_probability_max?.[i] ?? null,
            windSpeedMax: daily.wind_speed_10m_max?.[i] ?? null,
            windGustsMax: daily.wind_gusts_10m_max?.[i] ?? null,
        }));
    },
});
