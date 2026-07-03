import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import './air-quality.js';
import './current.js';
import './forecast.js';
import './hourly.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const geocodeBody = {
    results: [{
        name: 'Seattle',
        admin1: 'Washington',
        country: 'United States',
        latitude: 47.6062,
        longitude: -122.3321,
    }],
};

describe('open-meteo current', () => {
    const cmd = getRegistry().get('open-meteo/current');

    it('geocodes city names and shapes current weather', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(geocodeBody), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                timezone: 'America/Los_Angeles',
                current: {
                    time: '2026-07-03T10:00',
                    temperature_2m: 18.2,
                    apparent_temperature: 17.5,
                    relative_humidity_2m: 62,
                    precipitation: 0,
                    weather_code: 2,
                    cloud_cover: 35,
                    wind_speed_10m: 9.4,
                    wind_direction_10m: 220,
                    wind_gusts_10m: 18.1,
                    is_day: 1,
                },
            }), { status: 200 })));

        const rows = await cmd.func({ location: 'Seattle' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            location: 'Seattle',
            region: 'Washington',
            country: 'United States',
            timezone: 'America/Los_Angeles',
            temperature: 18.2,
            humidity: 62,
            isDay: true,
            weather: 'Partly cloudy',
        });
    });

    it('rejects empty location', async () => {
        await expect(cmd.func({ location: '' })).rejects.toBeInstanceOf(ArgumentError);
    });
});

describe('open-meteo forecast', () => {
    const cmd = getRegistry().get('open-meteo/forecast');

    it('skips geocoding for lat,lon and passes imperial units', async () => {
        const calls = [];
        vi.stubGlobal('fetch', vi.fn((url) => {
            calls.push(String(url));
            return Promise.resolve(new Response(JSON.stringify({
                timezone: 'America/New_York',
                daily: {
                    time: ['2026-07-03'],
                    weather_code: [61],
                    temperature_2m_min: [70],
                    temperature_2m_max: [82],
                    apparent_temperature_min: [71],
                    apparent_temperature_max: [85],
                    precipitation_sum: [0.12],
                    precipitation_probability_max: [40],
                    wind_speed_10m_max: [12],
                    wind_gusts_10m_max: [20],
                },
            }), { status: 200 }));
        }));

        const rows = await cmd.func({ location: '40.7128,-74.0060', days: 1, units: 'imperial' });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('temperature_unit=fahrenheit');
        expect(rows[0]).toMatchObject({
            rank: 1,
            location: '40.7128,-74.0060',
            weather: 'Slight rain',
            tempMax: 82,
            precipitationProbability: 40,
        });
    });

    it('promotes missing geocode results to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 })));
        await expect(cmd.func({ location: 'No Such Place' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('rejects --days out of range', async () => {
        await expect(cmd.func({ location: 'Seattle', days: 17 })).rejects.toBeInstanceOf(ArgumentError);
    });
});

describe('open-meteo hourly', () => {
    const cmd = getRegistry().get('open-meteo/hourly');

    it('returns hourly forecast rows', async () => {
        vi.stubGlobal('fetch', vi.fn((url) => {
            expect(String(url)).toContain('forecast_days=1');
            expect(String(url)).toContain('hourly=temperature_2m');
            return Promise.resolve(new Response(JSON.stringify({
                timezone: 'America/New_York',
                hourly: {
                    time: ['2026-07-03T00:00', '2026-07-03T01:00'],
                    temperature_2m: [70, 71],
                    relative_humidity_2m: [60, 61],
                    precipitation_probability: [10, 20],
                    precipitation: [0, 0.01],
                    weather_code: [0, 2],
                    wind_speed_10m: [8, 9],
                    wind_gusts_10m: [14, 15],
                },
            }), { status: 200 }));
        }));

        const rows = await cmd.func({ location: '40.7128,-74.0060', hours: 2, units: 'imperial' });
        expect(rows).toEqual([
            {
                rank: 1,
                location: '40.7128,-74.0060',
                region: null,
                country: null,
                time: '2026-07-03T00:00',
                weather: 'Clear sky',
                temperature: 70,
                humidity: 60,
                precipitationProbability: 10,
                precipitation: 0,
                windSpeed: 8,
                windGusts: 14,
            },
            expect.objectContaining({ rank: 2, weather: 'Partly cloudy', temperature: 71 }),
        ]);
    });

    it('rejects --hours out of range', async () => {
        await expect(cmd.func({ location: 'Seattle', hours: 169 })).rejects.toBeInstanceOf(ArgumentError);
    });
});

describe('open-meteo air-quality', () => {
    const cmd = getRegistry().get('open-meteo/air-quality');

    it('geocodes and maps air quality rows', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(geocodeBody), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                timezone: 'America/Los_Angeles',
                hourly: {
                    time: ['2026-07-03T00:00'],
                    us_aqi: [12],
                    european_aqi: [8],
                    pm10: [5.1],
                    pm2_5: [3.1],
                    nitrogen_dioxide: [7.2],
                    ozone: [55.5],
                    uv_index: [0],
                },
            }), { status: 200 })));

        const rows = await cmd.func({ location: 'Seattle', hours: 1 });
        expect(String(fetch.mock.calls[1][0])).toContain('air-quality');
        expect(rows).toEqual([{
            rank: 1,
            location: 'Seattle',
            region: 'Washington',
            country: 'United States',
            time: '2026-07-03T00:00',
            usAqi: 12,
            europeanAqi: 8,
            pm10: 5.1,
            pm25: 3.1,
            nitrogenDioxide: 7.2,
            ozone: 55.5,
            uvIndex: 0,
        }]);
    });

    it('promotes empty hourly air quality responses to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
            hourly: { time: [] },
        }), { status: 200 }))));
        await expect(cmd.func({ location: '40.7128,-74.0060', hours: 1 })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
