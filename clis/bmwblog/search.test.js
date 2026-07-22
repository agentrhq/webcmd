import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './search.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('bmwblog search adapter', () => {
    const cmd = getRegistry().get('bmwblog/search');

    it('declares an anonymous read-only command', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(false);
        expect(String(cmd.strategy)).toContain('public');
    });

    it('rejects an empty query and out-of-range limit before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ query: '   ', limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func({ query: 'M3', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func({ query: 'M3', limit: 51 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func({ query: 'M3', limit: 1.5 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps published posts with stable ids and canonical URLs', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
            {
                id: 515560,
                date_gmt: '2026-07-20T12:00:00',
                link: 'https://www.bmwblog.com/2026/07/20/bmw-m340i-vs-m3/',
                slug: 'bmw-m340i-vs-m3',
                title: { rendered: 'BMW M340i &amp; M3: Buyer&#8217;s Guide' },
                excerpt: { rendered: '<p>Compare the <strong>two cars</strong>&hellip;</p>' },
            },
        ]), { status: 200 })));

        const rows = await cmd.func({ query: 'M3', limit: 5 });

        expect(rows).toEqual([{
            rank: 1,
            id: 515560,
            title: 'BMW M340i & M3: Buyer’s Guide',
            date: '2026-07-20T12:00:00Z',
            excerpt: 'Compare the two cars…',
            url: 'https://www.bmwblog.com/2026/07/20/bmw-m340i-vs-m3/',
        }]);
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('search=M3'),
            expect.objectContaining({
                redirect: 'error',
                headers: expect.objectContaining({ Accept: 'application/json' }),
            }),
        );
    });

    it('throws EmptyResultError when no posts match', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
        await expect(cmd.func({ query: 'no-such-bmw', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('rejects malformed nested fields, dates, entities, and non-canonical URLs', async () => {
        const makePost = (overrides = {}) => ({
            id: 1,
            date_gmt: '2026-07-20T12:00:00',
            link: 'https://www.bmwblog.com/2026/07/20/article/',
            title: { rendered: 'Article' },
            excerpt: { rendered: '<p>Excerpt</p>' },
            ...overrides,
        });
        const expectRejectedPost = async (post) => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([post]), { status: 200 })));
            await expect(cmd.func({ query: 'M3', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        };

        await expectRejectedPost(makePost({ id: null }));
        await expectRejectedPost(makePost({ id: Number.MAX_SAFE_INTEGER + 1 }));
        await expectRejectedPost(makePost({ title: { rendered: { text: 'Article' } } }));
        await expectRejectedPost(makePost({ excerpt: {} }));
        await expectRejectedPost(makePost({ date_gmt: 'not-a-date' }));
        await expectRejectedPost(makePost({ date_gmt: '2026-02-30T12:00:00' }));
        await expectRejectedPost(makePost({ title: { rendered: '&#99999999;' } }));
        await expectRejectedPost(makePost({ title: { rendered: '&#27;' } }));
        await expectRejectedPost(makePost({ title: { rendered: 'Article\u001b[31m' } }));
        await expectRejectedPost(makePost({ link: { rendered: 'https://www.bmwblog.com/article/' } }));
        await expectRejectedPost(makePost({ link: 'https://example.com/not-bmwblog/' }));
        await expectRejectedPost(makePost({ link: 'https://user:pass@www.bmwblog.com/article/' }));
        await expectRejectedPost(makePost({ link: 'https://www.bmwblog.com:8443/article/' }));
        await expectRejectedPost(makePost({ link: 'https://www.bmwblog.com/article/' }));
        await expectRejectedPost(makePost({ link: 'https://www.bmwblog.com/2026/07/20/article/?ref=test' }));
        await expectRejectedPost(makePost({ link: 'https://www.bmwblog.com/2026/07/20/article/#section' }));
    });

    it('preserves unsupported or malformed entity text instead of rejecting legitimate content', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{
            id: 1,
            date_gmt: '2026-07-20T12:00:00',
            link: 'https://www.bmwblog.com/2026/07/20/article/',
            title: { rendered: 'BMW &deg; &unsupported; &#xZZ; &#;' },
            excerpt: { rendered: '<p>Source text</p>' },
        }]), { status: 200 })));

        const rows = await cmd.func({ query: 'BMW', limit: 5 });
        expect(rows[0].title).toBe('BMW &deg; &unsupported; &#xZZ; &#;');
    });

    it('maps HTTP, network, malformed JSON, and malformed shape failures to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
        await expect(cmd.func({ query: 'M3', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        await expect(cmd.func({ query: 'M3', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
        await expect(cmd.func({ query: 'M3', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
        await expect(cmd.func({ query: 'M3', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
