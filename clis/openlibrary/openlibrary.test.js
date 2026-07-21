import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import './search.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('openlibrary search adapter', () => {
    const cmd = getRegistry().get('openlibrary/search');

    it('registers an anonymous read-only public command', () => {
        expect(cmd).toMatchObject({
            site: 'openlibrary',
            name: 'search',
            access: 'read',
            browser: false,
        });
        expect(cmd.columns).toEqual([
            'rank', 'workId', 'title', 'authors', 'firstPublishYear',
            'editionCount', 'isbn', 'languages', 'url',
        ]);
    });

    it('rejects empty queries and out-of-range limits before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ query: '', limit: 5 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'algorithms', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'algorithms', limit: 51 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps Open Library results into stable book rows', async () => {
        const payload = {
            numFound: 1,
            docs: [{
                key: '/works/OL123W',
                title: 'Dynamic Programming',
                author_name: ['Richard Bellman'],
                first_publish_year: 1957,
                edition_count: 4,
                isbn: ['9780691079516', '069107951X'],
                language: ['eng'],
            }],
        };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd.func({ query: 'dynamic programming', limit: 5 });

        expect(rows).toEqual([{
            rank: 1,
            workId: 'OL123W',
            title: 'Dynamic Programming',
            authors: 'Richard Bellman',
            firstPublishYear: 1957,
            editionCount: 4,
            isbn: '9780691079516',
            languages: 'eng',
            url: 'https://openlibrary.org/works/OL123W',
        }]);
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=dynamic+programming'), expect.objectContaining({
            headers: expect.objectContaining({ accept: 'application/json' }),
        }));
    });

    it('throws typed errors for empty results and failed responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ docs: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'nothing', limit: 5 })).rejects.toThrow(EmptyResultError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('unavailable', { status: 503 })));
        await expect(cmd.func({ query: 'anything', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });
});
