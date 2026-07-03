import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './asset.js';
import './captions.js';
import './metadata.js';
import './search.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('nasa-images search', () => {
    const cmd = getRegistry().get('nasa-images/search');

    it('searches NASA Images and maps collection rows', async () => {
        const calls = [];
        vi.stubGlobal('fetch', vi.fn((url) => {
            calls.push(String(url));
            return Promise.resolve(new Response(JSON.stringify({
                collection: {
                    items: [{
                        data: [{
                            nasa_id: 'as11-40-5874',
                            title: 'Apollo 11 Mission image',
                            media_type: 'image',
                            center: 'JSC',
                            date_created: '1969-07-21T00:00:00Z',
                            description: 'Astronaut Edwin Aldrin poses beside the flag.',
                            keywords: ['APOLLO 11 FLIGHT', 'MOON'],
                        }],
                        links: [{ href: 'https://images-assets.nasa.gov/image/as11-40-5874/as11-40-5874~thumb.jpg' }],
                    }],
                },
            }), { status: 200 }));
        }));

        const rows = await cmd.func({ query: 'apollo 11', limit: 1, 'year-start': 1969, 'year-end': 1969, center: 'JSC' });
        expect(calls[0]).toContain('q=apollo+11');
        expect(calls[0]).toContain('media_type=image');
        expect(calls[0]).toContain('year_start=1969');
        expect(rows).toEqual([{
            rank: 1,
            nasaId: 'as11-40-5874',
            title: 'Apollo 11 Mission image',
            mediaType: 'image',
            center: 'JSC',
            dateCreated: '1969-07-21T00:00:00Z',
            description: 'Astronaut Edwin Aldrin poses beside the flag.',
            keywords: 'APOLLO 11 FLIGHT, MOON',
            previewUrl: 'https://images-assets.nasa.gov/image/as11-40-5874/as11-40-5874~thumb.jpg',
            assetUrl: 'https://images-api.nasa.gov/asset/as11-40-5874',
            url: 'https://images.nasa.gov/details/as11-40-5874',
        }]);
    });

    it('omits media_type when searching all media', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
            collection: { items: [{ data: [{ nasa_id: 'demo', title: 'Demo' }] }] },
        }), { status: 200 }))));

        await cmd.func({ query: 'apollo', 'media-type': 'all' });
        expect(String(fetch.mock.calls[0][0])).not.toContain('media_type=');
    });

    it('rejects empty queries', async () => {
        await expect(cmd.func({ query: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects out-of-range limits', async () => {
        await expect(cmd.func({ query: 'apollo', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes empty results to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
            collection: { items: [] },
        }), { status: 200 }))));
        await expect(cmd.func({ query: 'not-a-real-query' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('nasa-images asset', () => {
    const cmd = getRegistry().get('nasa-images/asset');

    it('lists asset file URLs', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
            collection: {
                items: [
                    { href: 'http://images-assets.nasa.gov/image/as11-40-5874/as11-40-5874~orig.jpg' },
                    { href: 'http://images-assets.nasa.gov/image/as11-40-5874/metadata.json' },
                ],
            },
        }), { status: 200 }))));

        await expect(cmd.func({ nasaId: 'as11-40-5874' })).resolves.toEqual([
            {
                rank: 1,
                nasaId: 'as11-40-5874',
                variant: 'orig',
                extension: 'jpg',
                url: 'http://images-assets.nasa.gov/image/as11-40-5874/as11-40-5874~orig.jpg',
            },
            {
                rank: 2,
                nasaId: 'as11-40-5874',
                variant: 'metadata',
                extension: 'json',
                url: 'http://images-assets.nasa.gov/image/as11-40-5874/metadata.json',
            },
        ]);
    });

    it('rejects missing NASA ids', async () => {
        await expect(cmd.func({ nasaId: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('treats missing assets as empty results', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))));
        await expect(cmd.func({ nasaId: 'missing' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('nasa-images metadata', () => {
    const cmd = getRegistry().get('nasa-images/metadata');

    it('returns the metadata URL', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
            location: 'https://images-assets.nasa.gov/image/as11-40-5874/metadata.json',
        }), { status: 200 }))));

        await expect(cmd.func({ nasaId: 'as11-40-5874' })).resolves.toEqual([{
            nasaId: 'as11-40-5874',
            metadataUrl: 'https://images-assets.nasa.gov/image/as11-40-5874/metadata.json',
        }]);
    });

    it('requires the metadata location', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))));
        await expect(cmd.func({ nasaId: 'as11-40-5874' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('nasa-images captions', () => {
    const cmd = getRegistry().get('nasa-images/captions');

    it('returns the captions URL', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
            location: 'https://images-assets.nasa.gov/video/172_ISS-Slosh/172_ISS-Slosh.srt',
        }), { status: 200 }))));

        await expect(cmd.func({ nasaId: '172_ISS-Slosh' })).resolves.toEqual([{
            nasaId: '172_ISS-Slosh',
            captionsUrl: 'https://images-assets.nasa.gov/video/172_ISS-Slosh/172_ISS-Slosh.srt',
        }]);
    });

    it('treats missing captions as empty results', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))));
        await expect(cmd.func({ nasaId: 'as11-40-5874' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
