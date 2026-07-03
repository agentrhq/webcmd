import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import './current.js';
import './forecast.js';

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
