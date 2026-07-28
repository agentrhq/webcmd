import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { __test__ } from './utils.js';
import './movies.js';
import './upcoming.js';
import './events.js';
import './search.js';
import './cities.js';
import './movie.js';

// Mock page object that simulates webcmd's IPage for browser-context commands.
// Supports both fetchJson() for API-backed commands and goto()/evaluate() for SSR commands.
function makeMockPage(fetchJsonImpl) {
    return { fetchJson: typeof fetchJsonImpl === 'function' ? fetchJsonImpl : vi.fn().mockResolvedValue(fetchJsonImpl) };
}

function makeSsrMockPage(ssrData) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(JSON.stringify(ssrData)),
        fetchJson: vi.fn(),
    };
}

// Helper: build SSR discover data with movie cards matching BMS __INITIAL_STATE__ shape
function makeDiscoverData(cards) {
    return {
        listings: [{
            type: 'flexbox',
            cards: cards.map((c) => ({
                id: c.groupCode || 'EG001',
                type: 'vertical',
                ctaUrl: c.url || `https://in.bookmyshow.com/movies/mumbai/test/${c.eventCode}`,
                text: [
                    { components: [{ type: 'text', text: c.title || '' }] },
                    { components: [{ type: 'text', text: c.certification || '' }] },
                    { components: [{ type: 'text', text: c.language || '' }] },
                ],
                analytics: {
                    event_code: c.eventCode || '',
                    title: c.title || '',
                    genre: c.genre || '',
                    language: c.language || '',
                },
                image: { url: '', altText: c.title || '' },
            })),
        }],
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ─── Utils Unit Tests ───

describe('bookmyshow utils', () => {
    describe('formatDuration', () => {
        it('formats hours and minutes', () => {
            expect(__test__.formatDuration(175)).toBe('2h 55m');
            expect(__test__.formatDuration(90)).toBe('1h 30m');
        });

        it('formats hours-only', () => {
            expect(__test__.formatDuration(120)).toBe('2h');
            expect(__test__.formatDuration(60)).toBe('1h');
        });

        it('formats minutes-only', () => {
            expect(__test__.formatDuration(45)).toBe('45m');
            expect(__test__.formatDuration(1)).toBe('1m');
        });

        it('returns empty for invalid values', () => {
            expect(__test__.formatDuration(0)).toBe('');
            expect(__test__.formatDuration(-5)).toBe('');
            expect(__test__.formatDuration(null)).toBe('');
            expect(__test__.formatDuration(undefined)).toBe('');
            expect(__test__.formatDuration('abc')).toBe('');
        });
    });

    describe('extractSlug', () => {
        it('converts titles to URL slugs', () => {
            expect(__test__.extractSlug('Pushpa 2: The Rule')).toBe('pushpa-2-the-rule');
            expect(__test__.extractSlug('Spider-Man: No Way Home')).toBe('spider-man-no-way-home');
        });

        it('handles empty and null', () => {
            expect(__test__.extractSlug('')).toBe('');
            expect(__test__.extractSlug(null)).toBe('');
            expect(__test__.extractSlug(undefined)).toBe('');
        });
    });

    describe('cleanText', () => {
        it('strips HTML tags', () => {
            expect(__test__.cleanText('<b>Bold</b> text')).toBe('Bold text');
        });

        it('normalizes whitespace', () => {
            expect(__test__.cleanText('  hello   world  ')).toBe('hello world');
        });

        it('handles null/undefined', () => {
            expect(__test__.cleanText(null)).toBe('');
            expect(__test__.cleanText(undefined)).toBe('');
        });
    });

    describe('joinList', () => {
        it('joins array values', () => {
            expect(__test__.joinList(['Drama', 'Action'])).toBe('Drama, Action');
        });

        it('filters falsy values', () => {
            expect(__test__.joinList(['Drama', '', null, 'Action'])).toBe('Drama, Action');
        });

        it('handles non-arrays', () => {
            expect(__test__.joinList('not-array')).toBe('');
            expect(__test__.joinList(null)).toBe('');
        });
    });

    describe('requireBoundedInt', () => {
        it('accepts valid integers', () => {
            expect(__test__.requireBoundedInt(5, 20, 1, 100)).toBe(5);
            expect(__test__.requireBoundedInt('10', 20, 1, 100)).toBe(10);
        });

        it('uses default when undefined', () => {
            expect(__test__.requireBoundedInt(undefined, 20, 1, 100)).toBe(20);
        });

        it('throws for below minimum', () => {
            expect(() => __test__.requireBoundedInt(0, 20, 1, 100)).toThrow(ArgumentError);
        });

        it('throws for above maximum', () => {
            expect(() => __test__.requireBoundedInt(200, 20, 1, 100)).toThrow(ArgumentError);
        });

        it('throws for non-integers', () => {
            expect(() => __test__.requireBoundedInt('abc', 20, 1, 100)).toThrow(ArgumentError);
        });
    });

    describe('field accessors', () => {
        it('bmsTitle extracts from multiple property names', () => {
            expect(__test__.bmsTitle({ EventTitle: 'A' })).toBe('A');
            expect(__test__.bmsTitle({ strEventTitle: 'B' })).toBe('B');
            expect(__test__.bmsTitle({ Title: 'C' })).toBe('C');
            expect(__test__.bmsTitle({ text: 'D' })).toBe('D');
            expect(__test__.bmsTitle({ name: 'E' })).toBe('E');
            expect(__test__.bmsTitle({})).toBe('');
        });

        it('bmsRating returns rounded number or null', () => {
            expect(__test__.bmsRating({ avgRating: 8.567 })).toBe(8.6);
            expect(__test__.bmsRating({ fAvgRating: 7 })).toBe(7);
            expect(__test__.bmsRating({})).toBeNull();
        });

        it('bmsVotes returns number or null', () => {
            expect(__test__.bmsVotes({ totalVotes: 1500 })).toBe(1500);
            expect(__test__.bmsVotes({ dwTotalVotes: '2000' })).toBe(2000);
            expect(__test__.bmsVotes({})).toBeNull();
        });

        it('bmsPrice returns number or null', () => {
            expect(__test__.bmsPrice({ EventMinPrice: '499' })).toBe(499);
            expect(__test__.bmsPrice({})).toBeNull();
        });
    });

    describe('unwrapBmsArray', () => {
        it('unwraps BookMyShow.arrEvents wrapper', () => {
            const body = { moviesData: { BookMyShow: { arrEvents: [{ id: 1 }] } } };
            expect(__test__.unwrapBmsArray(body, 'moviesData')).toEqual([{ id: 1 }]);
        });

        it('unwraps direct arrEvents', () => {
            const body = { moviesData: { arrEvents: [{ id: 2 }] } };
            expect(__test__.unwrapBmsArray(body, 'moviesData')).toEqual([{ id: 2 }]);
        });

        it('unwraps bare arrEvents', () => {
            const body = { arrEvents: [{ id: 3 }] };
            expect(__test__.unwrapBmsArray(body, 'moviesData')).toEqual([{ id: 3 }]);
        });

        it('unwraps top-level array', () => {
            expect(__test__.unwrapBmsArray([{ id: 4 }], 'moviesData')).toEqual([{ id: 4 }]);
        });

        it('returns empty array for unknown shape', () => {
            expect(__test__.unwrapBmsArray({ unknown: 'shape' }, 'moviesData')).toEqual([]);
        });

        it('uses custom arrayKey', () => {
            const body = { venuesData: { arrVenues: [{ id: 5 }] } };
            expect(__test__.unwrapBmsArray(body, 'venuesData', 'arrVenues')).toEqual([{ id: 5 }]);
        });
    });

    describe('buildProvenance', () => {
        it('includes sourceUrl and ISO fetchedAt', () => {
            const p = __test__.buildProvenance('https://example.com/api');
            expect(p.sourceUrl).toBe('https://example.com/api');
            expect(p.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });

    describe('buildMovieUrl / buildEventUrl', () => {
        it('builds complete movie URL', () => {
            expect(__test__.buildMovieUrl('mumbai', 'pushpa-2', 'ET001'))
                .toBe('https://in.bookmyshow.com/mumbai/movies/pushpa-2/ET001');
        });

        it('returns empty when slug or code is missing', () => {
            expect(__test__.buildMovieUrl('mumbai', '', 'ET001')).toBe('');
            expect(__test__.buildMovieUrl('mumbai', 'slug', '')).toBe('');
        });
    });
});

// ─── bmsFetch Error Handling (API-backed commands like cities) ───

describe('bookmyshow bmsFetch', () => {
    it('maps network failure to CommandExecutionError', async () => {
        const page = makeMockPage(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
        const cmd = getRegistry().get('bookmyshow/cities');
        await expect(cmd.func(page, { limit: 10 })).rejects.toThrow(CommandExecutionError);
    });

    it('maps 404 error to EmptyResultError', async () => {
        const page = makeMockPage(vi.fn().mockRejectedValue(new Error('HTTP 404 Not Found')));
        const cmd = getRegistry().get('bookmyshow/cities');
        await expect(cmd.func(page, { limit: 10 })).rejects.toThrow(EmptyResultError);
    });

    it('maps fetch error to CommandExecutionError', async () => {
        const page = makeMockPage(vi.fn().mockRejectedValue(new Error('HTTP 403 Forbidden')));
        const cmd = getRegistry().get('bookmyshow/cities');
        await expect(cmd.func(page, { limit: 10 })).rejects.toThrow(CommandExecutionError);
    });

    it('rejects non-object response shape', async () => {
        const page = makeMockPage(vi.fn().mockResolvedValue('string-not-object'));
        const cmd = getRegistry().get('bookmyshow/cities');
        await expect(cmd.func(page, { limit: 10 })).rejects.toThrow(CommandExecutionError);
    });
});

// ─── Movies Adapter ───

describe('bookmyshow movies adapter', () => {
    const cmd = getRegistry().get('bookmyshow/movies');

    it('registers with correct columns including provenance', () => {
        expect(cmd).toBeDefined();
        expect(cmd.columns).toContain('sourceUrl');
        expect(cmd.columns).toContain('fetchedAt');
        expect(cmd.browser).toBe(true);
        expect(cmd.strategy).toBe('cookie');
    });

    it('rejects empty city before navigation', async () => {
        const page = makeSsrMockPage({});
        await expect(cmd.func(page, { city: '', limit: 10 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects out-of-range limit', async () => {
        const page = makeSsrMockPage({});
        await expect(cmd.func(page, { city: 'mumbai', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(page, { city: 'mumbai', limit: 200 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws EmptyResultError when no movies found', async () => {
        const data = makeDiscoverData([]);
        const page = makeSsrMockPage(data);
        await expect(cmd.func(page, { city: 'mumbai', limit: 10 })).rejects.toThrow(EmptyResultError);
    });

    it('extracts movie cards from SSR state', async () => {
        const data = makeDiscoverData([
            { eventCode: 'ET00412327', title: 'Pushpa 2', language: 'hindi', genre: 'action|drama', certification: 'UA' },
            { eventCode: 'ET00387241', title: 'Singham Again', language: 'hindi', genre: 'action', certification: 'UA' },
        ]);
        const page = makeSsrMockPage(data);

        const rows = await cmd.func(page, { city: 'mumbai', limit: 10 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            rank: 1,
            eventCode: 'ET00412327',
            title: 'Pushpa 2',
            language: 'hindi',
            genre: 'action|drama',
            certification: 'UA',
        });
        expect(rows[0].sourceUrl).toContain('bookmyshow.com');
        expect(rows[0].fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(rows[0].url).toContain('bookmyshow.com');
        expect(rows[1].rank).toBe(2);
    });

    it('respects limit parameter', async () => {
        const cards = Array.from({ length: 30 }, (_, i) => ({
            eventCode: `ET00${String(i).padStart(4, '0')}`,
            title: `Movie ${i + 1}`,
        }));
        const page = makeSsrMockPage(makeDiscoverData(cards));
        const rows = await cmd.func(page, { city: 'mumbai', limit: 5 });
        expect(rows).toHaveLength(5);
        expect(rows[4].rank).toBe(5);
    });
});

// ─── Upcoming Adapter ───

describe('bookmyshow upcoming adapter', () => {
    const cmd = getRegistry().get('bookmyshow/upcoming');

    it('registers with correct columns', () => {
        expect(cmd).toBeDefined();
        expect(cmd.columns).toContain('sourceUrl');
        expect(cmd.browser).toBe(true);
    });

    it('maps upcoming movie data correctly', async () => {
        const data = makeDiscoverData([{
            eventCode: 'ET00500001', title: 'War 2', language: 'hindi',
            genre: 'action|thriller', certification: 'UA',
        }]);
        const page = makeSsrMockPage(data);

        const rows = await cmd.func(page, { city: 'delhi-ncr', limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1,
            eventCode: 'ET00500001',
            title: 'War 2',
            language: 'hindi',
        });
    });
});

// ─── Events Adapter ───

describe('bookmyshow events adapter', () => {
    const cmd = getRegistry().get('bookmyshow/events');

    it('registers with correct columns including provenance', () => {
        expect(cmd).toBeDefined();
        expect(cmd.columns).toContain('sourceUrl');
        expect(cmd.columns).toContain('fetchedAt');
    });

    it('filters by category', async () => {
        const body = {
            eventsData: {
                arrEvents: [
                    { EventTitle: 'Rock Concert', EventCode: 'EV001', EventGroup: 'Music', VenueName: 'Phoenix Arena' },
                    { EventTitle: 'Comedy Night', EventCode: 'EV002', EventGroup: 'Comedy', VenueName: 'Canvas Laugh' },
                    { EventTitle: 'Jazz Festival', EventCode: 'EV003', EventGroup: 'Music', VenueName: 'Blue Frog' },
                ],
            },
        };
        const page = makeMockPage(body);

        const rows = await cmd.func(page, { city: 'mumbai', category: 'music', limit: 10 });
        expect(rows).toHaveLength(2);
        expect(rows[0].title).toBe('Rock Concert');
        expect(rows[1].title).toBe('Jazz Festival');
    });

    it('throws EmptyResultError when category filter matches nothing', async () => {
        const body = {
            eventsData: {
                arrEvents: [
                    { EventTitle: 'Rock Concert', EventCode: 'EV001', EventGroup: 'Music' },
                ],
            },
        };
        const page = makeMockPage(body);
        await expect(cmd.func(page, { city: 'mumbai', category: 'sports', limit: 10 }))
            .rejects.toThrow(EmptyResultError);
    });

    it('returns numeric price with INR currency', async () => {
        const body = {
            eventsData: {
                arrEvents: [
                    { EventTitle: 'Show', EventCode: 'EV001', EventGroup: 'Music', EventMinPrice: '499' },
                ],
            },
        };
        const page = makeMockPage(body);

        const rows = await cmd.func(page, { city: 'bengaluru', limit: 10 });
        expect(rows[0].price).toBe(499);
        expect(rows[0].currency).toBe('INR');
    });

    it('returns null price/currency when absent', async () => {
        const body = {
            eventsData: {
                arrEvents: [
                    { EventTitle: 'Free Show', EventCode: 'EV001', EventGroup: 'Music' },
                ],
            },
        };
        const page = makeMockPage(body);
        const rows = await cmd.func(page, { city: 'mumbai', limit: 10 });
        expect(rows[0].price).toBeNull();
        expect(rows[0].currency).toBeNull();
    });
});

// ─── Search Adapter ───

describe('bookmyshow search adapter', () => {
    const cmd = getRegistry().get('bookmyshow/search');

    it('registers with correct columns including provenance', () => {
        expect(cmd).toBeDefined();
        expect(cmd.columns).toContain('sourceUrl');
        expect(cmd.columns).toContain('fetchedAt');
    });

    it('rejects empty query before fetching', async () => {
        const page = makeMockPage(vi.fn());
        await expect(cmd.func(page, { query: '', city: 'mumbai', limit: 10 })).rejects.toThrow(ArgumentError);
        expect(page.fetchJson).not.toHaveBeenCalled();
    });

    it('unwraps docs[] shape', async () => {
        const body = {
            docs: [{
                EventTitle: 'Pushpa 2',
                EventType: 'MT',
                EventLanguage: 'Hindi',
                EventGenre: 'Action',
                avgRating: 8.5,
                url: '/mumbai/movies/pushpa-2/ET00412327',
            }],
        };
        const page = makeMockPage(body);
        const rows = await cmd.func(page, { query: 'pushpa', city: 'mumbai', limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ title: 'Pushpa 2', category: 'MT', rating: 8.5 });
        expect(rows[0].url).toContain('bookmyshow.com');
    });

    it('unwraps data[] shape', async () => {
        const body = { data: [{ EventTitle: 'Test', EventType: 'CT' }] };
        const page = makeMockPage(body);
        const rows = await cmd.func(page, { query: 'test', city: 'mumbai', limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('Test');
    });

    it('unwraps arrEvents shape', async () => {
        const body = { arrEvents: [{ EventTitle: 'Event', EventType: 'EV' }] };
        const page = makeMockPage(body);
        const rows = await cmd.func(page, { query: 'event', city: 'mumbai', limit: 10 });
        expect(rows).toHaveLength(1);
    });

    it('throws EmptyResultError for no matches', async () => {
        const body = { docs: [] };
        const page = makeMockPage(body);
        await expect(cmd.func(page, { query: 'xyznonexistent', city: 'mumbai', limit: 10 }))
            .rejects.toThrow(EmptyResultError);
    });
});

// ─── Cities Adapter ───

describe('bookmyshow cities adapter', () => {
    const cmd = getRegistry().get('bookmyshow/cities');

    it('registers with correct columns including provenance', () => {
        expect(cmd).toBeDefined();
        expect(cmd.columns).toContain('sourceUrl');
        expect(cmd.columns).toContain('fetchedAt');
    });

    it('merges top and other cities with deduplication', async () => {
        const body = {
            BookMyShow: {
                TopCities: [
                    { RegionCode: 'MUMBAI', RegionName: 'Mumbai', SubRegion: 'Maharashtra' },
                    { RegionCode: 'DELHI', RegionName: 'Delhi-NCR', SubRegion: 'Delhi' },
                ],
                OtherCities: [
                    { RegionCode: 'JAIPUR', RegionName: 'Jaipur', SubRegion: 'Rajasthan' },
                    { RegionCode: 'MUMBAI', RegionName: 'Mumbai', SubRegion: 'Maharashtra' },
                ],
            },
        };
        const page = makeMockPage(body);

        const rows = await cmd.func(page, { limit: 50 });
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({ code: 'mumbai', name: 'Mumbai', isTopCity: true });
        expect(rows[2]).toMatchObject({ code: 'jaipur', name: 'Jaipur', isTopCity: false });
    });

    it('handles regions[] shape', async () => {
        const body = { regions: [{ RegionCode: 'PUNE', RegionName: 'Pune' }] };
        const page = makeMockPage(body);
        const rows = await cmd.func(page, { limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0].code).toBe('pune');
    });

    it('throws EmptyResultError when no cities', async () => {
        const body = { BookMyShow: { TopCities: [] } };
        const page = makeMockPage(body);
        await expect(cmd.func(page, { limit: 10 })).rejects.toThrow(EmptyResultError);
    });
});

// ─── Movie Detail Adapter ───

describe('bookmyshow movie detail adapter', () => {
    const cmd = getRegistry().get('bookmyshow/movie');

    it('registers with field/value columns', () => {
        expect(cmd).toBeDefined();
        expect(cmd.columns).toEqual(['field', 'value']);
    });

    it('rejects empty event code before fetching', async () => {
        const page = makeMockPage(vi.fn());
        await expect(cmd.func(page, { code: '', city: 'mumbai' })).rejects.toThrow(ArgumentError);
        expect(page.fetchJson).not.toHaveBeenCalled();
    });

    it('maps movie detail to field/value pairs with provenance', async () => {
        const body = {
            movieData: {
                EventTitle: 'Pushpa 2',
                EventCode: 'ET00412327',
                EventLanguage: 'Hindi',
                EventGenre: 'Action|Drama',
                EventCensor: 'UA',
                Length: 175,
                avgRating: 8.5,
                totalVotes: 12500,
                EventDate: '2024-12-06',
                EventSynopsis: 'The rule of the jungle is simple.',
                cast: [{ name: 'Allu Arjun' }, { name: 'Rashmika Mandanna' }],
                crew: [{ name: 'Sukumar', role: 'Director' }],
            },
        };
        const page = makeMockPage(body);

        const rows = await cmd.func(page, { code: 'ET00412327', city: 'mumbai' });
        const fields = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(fields.title).toBe('Pushpa 2');
        expect(fields.language).toBe('Hindi');
        expect(fields.duration).toBe('2h 55m');
        expect(fields.rating).toBe('8.5');
        expect(fields.director).toBe('Sukumar');
        expect(fields.cast).toBe('Allu Arjun, Rashmika Mandanna');
        expect(fields.synopsis).toBe('The rule of the jungle is simple.');
        expect(fields.sourceUrl).toContain('movie-details');
        expect(fields.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('handles missing cast and crew gracefully', async () => {
        const body = {
            movieData: {
                EventTitle: 'Minimal Movie',
                EventLanguage: 'Tamil',
            },
        };
        const page = makeMockPage(body);
        const rows = await cmd.func(page, { code: 'ET001', city: 'chennai' });
        const fieldNames = rows.map((r) => r.field);
        expect(fieldNames).toContain('title');
        expect(fieldNames).not.toContain('cast');
        expect(fieldNames).not.toContain('director');
    });

    it('throws EmptyResultError when movie not found', async () => {
        const body = { movieData: {} };
        const page = makeMockPage(body);
        await expect(cmd.func(page, { code: 'ET99999999', city: 'mumbai' }))
            .rejects.toThrow(EmptyResultError);
    });
});
