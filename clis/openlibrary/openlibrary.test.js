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

    it('rejects bad args before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ query: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'hobbit', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'hobbit', limit: 101 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ query: 'hobbit', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when no works match', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ numFound: 0, docs: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'zzzzzzzzzz-no-book', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('maps work rows with stable ids and canonical Open Library URLs', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            numFound: 1,
            docs: [{
                key: '/works/OL27448W',
                title: 'The Lord of the Rings',
                author_name: ['J.R.R. Tolkien', 'Christopher Tolkien'],
                first_publish_year: 1954,
                edition_count: 251,
                language: ['eng', 'fre', 'ger'],
                subject: ['Middle Earth', 'Fantasy'],
                isbn: ['9780261103252', '0261103253'],
            }],
        }), { status: 200 })));

        const rows = await cmd.func({ query: 'lord of the rings', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1,
            workKey: 'OL27448W',
            title: 'The Lord of the Rings',
            authors: 'J.R.R. Tolkien, Christopher Tolkien',
            firstPublishYear: 1954,
            editionCount: 251,
            languages: 'eng, fre, ger',
            subjects: 'Middle Earth, Fantasy',
            isbn: '9780261103252',
            url: 'https://openlibrary.org/works/OL27448W',
        });
    });
});
