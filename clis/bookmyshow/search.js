// bookmyshow search — search movies and events across BookMyShow.
//
// Searches BookMyShow's autocomplete/search endpoint for movies, events, venues,
// and other entities matching a query. Results include the entity category and a
// direct URL.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    BMS_BASE, bmsFetch, buildProvenance, cleanText,
    requireBoundedInt, requireString, validateCity,
    bmsTitle, bmsLanguage, bmsGenre, bmsRating, bmsDate,
} from './utils.js';

// Search responses use a different shape from listing endpoints — the result
// array can appear under docs, data, arrEvents, or at the top level.
function unwrapSearchResults(body) {
    if (body?.docs && Array.isArray(body.docs)) return body.docs;
    if (body?.data && Array.isArray(body.data)) return body.data;
    if (body?.arrEvents && Array.isArray(body.arrEvents)) return body.arrEvents;
    if (body?.BookMyShow?.arrEvents && Array.isArray(body.BookMyShow.arrEvents)) {
        return body.BookMyShow.arrEvents;
    }
    return Array.isArray(body) ? body : [];
}

cli({
    site: 'bookmyshow',
    name: 'search',
    access: 'read',
    description: 'Search movies, events, and venues on BookMyShow',
    domain: 'in.bookmyshow.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', positional: true, type: 'string', required: true, help: 'Search term (movie title, event name, venue, etc.)' },
        { name: 'city', type: 'string', default: 'mumbai', help: 'City slug for regional results (e.g. mumbai, delhi-ncr)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (1-50)' },
    ],
    columns: [
        'rank', 'title', 'category', 'language', 'genre',
        'rating', 'releaseDate', 'sourceUrl', 'fetchedAt', 'url',
    ],
    func: async (page, args) => {
        const query = requireString(args.query, 'query');
        const city = validateCity(args.city);
        const limit = requireBoundedInt(args.limit, 20, 1, 50, 'limit');

        const endpoint = `${BMS_BASE}/api/search/suggest?q=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`;
        const body = await bmsFetch(page, endpoint, `bookmyshow search "${query}"`);
        const results = unwrapSearchResults(body);

        if (results.length === 0) {
            throw new EmptyResultError(
                'bookmyshow search',
                `No results found for "${query}" in ${city}.`,
            );
        }

        const provenance = buildProvenance(endpoint);
        return results.slice(0, limit).map((item, i) => {
            const searchCategory = cleanText(
                item.EventType ?? item.strEventType ?? item.Type
                ?? item.group ?? item.category ?? '',
            );
            const itemUrl = item.url ?? item.EventURL ?? item.strEventURL ?? '';
            const fullUrl = itemUrl
                ? (itemUrl.startsWith('http') ? itemUrl : `${BMS_BASE}${itemUrl}`)
                : `${BMS_BASE}/${city}`;

            return {
                rank: i + 1,
                title: bmsTitle(item),
                category: searchCategory,
                language: bmsLanguage(item),
                genre: bmsGenre(item),
                rating: bmsRating(item),
                releaseDate: bmsDate(item),
                ...provenance,
                url: fullUrl,
            };
        });
    },
});
