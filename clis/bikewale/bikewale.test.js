import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import './search.js';

const cmd = getRegistry().get('bikewale/search');

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('bikewale search adapter', () => {
    it('rejects invalid args before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ query: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'x'.repeat(81) })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'activa', limit: 21 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP failures to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })));
        await expect(cmd.func({ query: 'activa' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError on empty suggestions', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
        await expect(cmd.func({ query: 'no-such-bike' })).rejects.toThrow(EmptyResultError);
    });

    it('maps BikeWale suggestions to round-trippable public rows', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
            {
                payload: {
                    modelName: 'Activa', maskingName: 'activa-6g', makeId: 7,
                    makeName: 'Honda', makeMaskingName: 'honda', modelId: 1354,
                    url: '/honda-bikes/activa-6g/',
                },
                suggestionType: 2,
                displayName: 'Honda Activa',
                additionalInfo: '',
            },
            {
                payload: {
                    modelName: 'Activa 7G', makeId: 7, makeName: 'Honda', modelId: 1986,
                    url: '/honda-bikes/activa-7g/',
                },
                suggestionType: 3,
                displayName: 'Honda Activa 7G',
                additionalInfo: 'Coming Soon',
            },
        ]), { status: 200 })));
        const rows = await cmd.func({ query: 'activa', limit: 2 });
        expect(rows).toEqual([
            {
                rank: 1,
                name: 'Honda Activa',
                make: 'Honda',
                model: 'Activa',
                type: 2,
                additionalInfo: '',
                modelId: 1354,
                makeId: 7,
                url: 'https://www.bikewale.com/honda-bikes/activa-6g/',
            },
            {
                rank: 2,
                name: 'Honda Activa 7G',
                make: 'Honda',
                model: 'Activa 7G',
                type: 3,
                additionalInfo: 'Coming Soon',
                modelId: 1986,
                makeId: 7,
                url: 'https://www.bikewale.com/honda-bikes/activa-7g/',
            },
        ]);
    });
});
