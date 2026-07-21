// bookmyshow events — list live events (concerts, comedy, sports, plays) in a city.
//
// Fetches event listings from BookMyShow for a given Indian city. Covers all
// non-movie categories: music, comedy, sports, theatre, workshops, etc.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    BMS_BASE, bmsFetch, buildEventUrl, buildProvenance, extractSlug,
    unwrapBmsArray, requireBoundedInt, validateCity,
    bmsTitle, bmsEventCode, bmsCategory, bmsVenue, bmsDate,
    bmsPrice, bmsLanguage, bmsGenre,
} from './utils.js';

cli({
    site: 'bookmyshow',
    name: 'events',
    access: 'read',
    description: 'List live events (concerts, comedy, sports, plays) in a city on BookMyShow',
    domain: 'in.bookmyshow.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'city', positional: true, type: 'string', required: true, help: 'City slug (e.g. mumbai, delhi-ncr, bengaluru)' },
        { name: 'category', type: 'string', default: '', help: 'Filter by category (e.g. music, comedy, sports, plays, workshops)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (1-100)' },
    ],
    columns: [
        'rank', 'eventCode', 'title', 'category', 'venue',
        'date', 'price', 'currency', 'language',
        'sourceUrl', 'fetchedAt', 'url',
    ],
    func: async (page, args) => {
        const city = validateCity(args.city);
        const limit = requireBoundedInt(args.limit, 20, 1, 100, 'limit');
        const categoryFilter = String(args.category ?? '').trim().toLowerCase();

        const endpoint = `${BMS_BASE}/api/events-data/events/${city}`;
        const body = await bmsFetch(page, endpoint, `bookmyshow events ${city}`);

        let events = unwrapBmsArray(body, 'eventsData');

        if (events.length === 0) {
            throw new EmptyResultError(
                'bookmyshow events',
                `No events found for city "${city}".`,
            );
        }

        if (categoryFilter) {
            events = events.filter((e) => {
                const cat = bmsCategory(e).toLowerCase();
                const genre = bmsGenre(e).toLowerCase();
                return cat.includes(categoryFilter) || genre.includes(categoryFilter);
            });
            if (events.length === 0) {
                throw new EmptyResultError(
                    'bookmyshow events',
                    `No "${categoryFilter}" events found for city "${city}".`,
                );
            }
        }

        const provenance = buildProvenance(endpoint);
        return events.slice(0, limit).map((e, i) => {
            const title = bmsTitle(e);
            const code = bmsEventCode(e);
            const price = bmsPrice(e);
            return {
                rank: i + 1,
                eventCode: code,
                title,
                category: bmsCategory(e),
                venue: bmsVenue(e),
                date: bmsDate(e),
                price,
                currency: price != null ? 'INR' : null,
                language: bmsLanguage(e),
                ...provenance,
                url: buildEventUrl(city, extractSlug(title), code)
                    || `${BMS_BASE}/${city}/events`,
            };
        });
    },
});
