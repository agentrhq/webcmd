import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import '../country.js';
import '../region.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('rest-countries country adapter', () => {
    const cmd = getRegistry().get('rest-countries/country');

    it('rejects bad args before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ name: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ name: 'japan', limit: 9999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('throttled', { status: 429 })));
        await expect(cmd.func({ name: 'japan' })).rejects.toThrow(CommandExecutionError);
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ name: 'no-country-by-this-name' })).rejects.toThrow(EmptyResultError);
    });

    it('maps a v3.1 deprecation envelope to CommandExecutionError, not EmptyResultError', async () => {
        const retiredResponse = () => new Response(JSON.stringify({
            success: false,
            data: null,
            errors: [{ message: 'This API version has been deprecated. Please visit https://restcountries.com/docs/countries/legacy-api-deprecation to migrate to our new version (v5).' }],
        }), { status: 200 });
        vi.stubGlobal('fetch', vi.fn().mockImplementation(retiredResponse));
        let error;
        try {
            await cmd.func({ name: 'japan' });
            throw new Error('expected retired API response to throw');
        } catch (err) {
            error = err;
        }
        expect(error).toMatchObject({
            name: 'CommandExecutionError',
            hint: expect.stringMatching(/webcmd adapter path rest-countries\/country/),
        });
        expect(error.hint).not.toMatch(/utils\.js base URL|curl another country API/i);
        expect(error).not.toBeInstanceOf(EmptyResultError);
    });

    it('does not label every success:false envelope as retired', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: false,
            errors: [{ message: 'temporary upstream failure' }],
        }), { status: 200 })));

        await expect(cmd.func({ name: 'japan' })).rejects.not.toThrow(/retired REST Countries/i);
    });

    it('round-trips cca3 from row into restcountries.com alpha URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
            {
                name: { common: 'Japan', official: 'Japan' },
                cca2: 'JP', cca3: 'JPN', ccn3: '392',
                capital: ['Tokyo'],
                region: 'Asia', subregion: 'Eastern Asia',
                population: 125000000, area: 377000,
                languages: { jpn: 'Japanese' },
                currencies: { JPY: { name: 'Japanese yen', symbol: '¥' } },
                latlng: [36, 138], timezones: ['UTC+09:00'], independent: true, unMember: true, landlocked: false, flag: '🇯🇵',
            },
        ]), { status: 200 })));
        const rows = await cmd.func({ name: 'japan', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, commonName: 'Japan', cca2: 'JP', cca3: 'JPN',
            capital: 'Tokyo', region: 'Asia',
            languages: 'Japanese', currencies: 'JPY (Japanese yen)',
            latitude: 36, longitude: 138,
            url: 'https://restcountries.com/v3.1/alpha/jpn',
        });
    });
});

describe('rest-countries region adapter', () => {
    const cmd = getRegistry().get('rest-countries/region');

    it('rejects unknown regions before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ region: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ region: 'middle-earth' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws EmptyResultError on empty payload', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
        await expect(cmd.func({ region: 'oceania' })).rejects.toThrow(EmptyResultError);
    });

    it('sorts by population descending so largest country is rank 1', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
            { name: { common: 'Tuvalu' }, cca3: 'TUV', population: 12000 },
            { name: { common: 'Australia' }, cca3: 'AUS', population: 26000000 },
            { name: { common: 'Fiji' }, cca3: 'FJI', population: 900000 },
        ]), { status: 200 })));
        const rows = await cmd.func({ region: 'oceania' });
        expect(rows.map((r) => r.commonName)).toEqual(['Australia', 'Fiji', 'Tuvalu']);
        expect(rows[0]).toMatchObject({ cca3: 'AUS', url: 'https://restcountries.com/v3.1/alpha/aus' });
    });
});
