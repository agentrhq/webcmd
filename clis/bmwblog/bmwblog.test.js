import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import './search.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('bmwblog search adapter', () => {
    const cmd = getRegistry().get('bmwblog/search');

    it('registers an anonymous public API command with useful article columns', () => {
        expect(cmd).toBeTruthy();
        expect(cmd?.browser).toBe(false);
        expect(cmd?.strategy).toBe('public');
        expect(cmd?.access).toBe('read');
        expect(cmd?.columns).toEqual(['rank', 'id', 'title', 'slug', 'published', 'excerpt', 'url']);
    });

    it('requires a non-empty search query before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ query: '   ', limit: 5 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requires a bounded positive limit before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ query: 'iX3', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'iX3', limit: 51 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps WordPress posts into stable article rows', async () => {
        const posts = [
            {
                id: 515381,
                date: '2026-07-10T08:30:00',
                slug: 'bmw-ix3-nearly-100000-orders',
                link: 'https://www.bmwblog.com/2026/07/10/bmw-ix3-nearly-100000-orders/',
                title: { rendered: 'The New BMW iX3 Is Closing In On 100,000 Orders' },
                excerpt: { rendered: '<p>BMW&#8217;s new SUV has strong demand &amp; momentum.</p>\n' },
            },
        ];
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(posts), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd.func({ query: 'iX3', limit: '5' });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.origin + url.pathname).toBe('https://www.bmwblog.com/wp-json/wp/v2/posts');
        expect(url.searchParams.get('search')).toBe('iX3');
        expect(url.searchParams.get('per_page')).toBe('5');
        expect(rows).toEqual([
            {
                rank: 1,
                id: 515381,
                title: 'The New BMW iX3 Is Closing In On 100,000 Orders',
                slug: 'bmw-ix3-nearly-100000-orders',
                published: '2026-07-10',
                excerpt: 'BMW’s new SUV has strong demand & momentum.',
                url: 'https://www.bmwblog.com/2026/07/10/bmw-ix3-nearly-100000-orders/',
            },
        ]);
    });

    it('surfaces empty result pages as EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));

        await expect(cmd.func({ query: 'definitely-no-such-bmwblog-term', limit: 5 }))
            .rejects.toThrow(EmptyResultError);
    });

    it('wraps HTTP, network, and malformed JSON failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Server error', { status: 500 })));
        await expect(cmd.func({ query: 'iX3', limit: 5 })).rejects.toThrow(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
        await expect(cmd.func({ query: 'iX3', limit: 5 })).rejects.toThrow(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
        await expect(cmd.func({ query: 'iX3', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });
});
