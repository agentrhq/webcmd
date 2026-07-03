import { describe, expect, it } from 'vitest';
import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { createPageMock } from '../test-utils.js';
import { __test__ as utils } from './utils.js';
import { __test__ as movies } from './movies.js';
import { __test__ as events } from './events.js';
import { __test__ as cinemas } from './cinemas.js';
import { __test__ as shows } from './shows.js';

const movieRows = [
    {
        title: 'Alpha',
        genres: 'Action/Thriller',
        eventCode: 'ET00403805',
        url: 'https://in.bookmyshow.com/movies/mumbai/alpha/ET00403805',
        image: 'https://assets.example/alpha.jpg',
    },
];

describe('bookmyshow utils', () => {
    it('normalizes common city names and validates limits', () => {
        expect(utils.resolveCity('Delhi NCR')).toMatchObject({ slug: 'national-capital-region-ncr', regionCode: 'NCR' });
        expect(utils.resolveCity('Mumbai')).toMatchObject({ slug: 'mumbai', regionCode: 'MUMBAI' });
        expect(utils.parseLimit(5, 'bookmyshow movies')).toBe(5);
        expect(() => utils.parseLimit(0, 'bookmyshow movies')).toThrow(ArgumentError);
    });

    it('parses event code and slug from BookMyShow movie URLs', () => {
        expect(utils.parseMovieRef('https://in.bookmyshow.com/movies/mumbai/alpha/ET00403805')).toEqual({
            eventCode: 'ET00403805',
            slug: 'alpha',
        });
    });
});

describe('bookmyshow movies', () => {
    it('returns visible movie cards with stable columns', async () => {
        const page = createPageMock([{ ok: true, rows: movieRows }]);
        const rows = await movies.command.func(page, { city: 'mumbai', limit: 1 });
        expect(page.goto).toHaveBeenCalledWith('https://in.bookmyshow.com/explore/home/mumbai');
        expect(rows).toEqual([{
            rank: 1,
            eventCode: 'ET00403805',
            title: 'Alpha',
            genres: 'Action/Thriller',
            city: 'mumbai',
            url: 'https://in.bookmyshow.com/movies/mumbai/alpha/ET00403805',
            image: 'https://assets.example/alpha.jpg',
        }]);
    });

    it('throws EmptyResultError when no movie cards are visible', async () => {
        const page = createPageMock([{ ok: true, rows: [] }]);
        await expect(movies.command.func(page, { city: 'mumbai', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('bookmyshow events', () => {
    it('returns visible event cards', async () => {
        const page = createPageMock([{ ok: true, rows: [{
            title: 'Sunburn Festival',
            venue: 'Mahalaxmi Race Course: Mumbai',
            category: 'Concerts',
            price: '3500 onwards',
            eventCode: 'ET00498558',
            url: 'https://in.bookmyshow.com/events/sunburn-festival-2026/ET00498558',
        }] }]);
        const rows = await events.command.func(page, { city: 'mumbai', limit: 1 });
        expect(page.goto).toHaveBeenCalledWith('https://in.bookmyshow.com/explore/events-mumbai');
        expect(rows[0]).toMatchObject({ rank: 1, title: 'Sunburn Festival', city: 'mumbai' });
    });
});

describe('bookmyshow cinemas', () => {
    it('pairs visible cinema names with addresses', async () => {
        const page = createPageMock([{ ok: true, rows: [{
            name: 'Cinepolis: Nexus Seawoods',
            address: 'Nerul, Navi Mumbai, Maharashtra 400706, India',
        }] }]);
        const rows = await cinemas.command.func(page, { city: 'mumbai', limit: 1 });
        expect(page.goto).toHaveBeenCalledWith('https://in.bookmyshow.com/mumbai/cinemas');
        expect(rows[0]).toEqual({
            rank: 1,
            name: 'Cinepolis: Nexus Seawoods',
            address: 'Nerul, Navi Mumbai, Maharashtra 400706, India',
            city: 'mumbai',
            url: 'https://in.bookmyshow.com/mumbai/cinemas',
        });
    });
});

describe('bookmyshow shows', () => {
    it('resolves a movie title before extracting visible showtimes', async () => {
        const page = createPageMock([
            { ok: true, rows: movieRows },
            { ok: true, rows: [{
                movie: 'Alpha',
                cinema: 'Ajanta Cinema Cinex: Borivali (W) Newly Renovated',
                showTime: '04:15 PM',
                format: 'DOLBY 9.5',
                status: 'AVAILABLE',
            }] },
        ]);
        const rows = await shows.command.func(page, { city: 'mumbai', movie: 'alpha', limit: 1 });
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://in.bookmyshow.com/explore/home/mumbai');
        expect(page.goto.mock.calls[1][0]).toMatch('/movies/mumbai/alpha/buytickets/ET00403805/');
        expect(rows[0]).toMatchObject({
            rank: 1,
            eventCode: 'ET00403805',
            movie: 'Alpha',
            cinema: 'Ajanta Cinema Cinex: Borivali (W) Newly Renovated',
            showTime: '04:15 PM',
        });
    });
});
