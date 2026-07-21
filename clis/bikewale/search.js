// bikewale search — search BikeWale's public bike/model suggestions.
//
// Hits the anonymous autocomplete endpoint used by bikewale.com's public search
// box. Results include stable model/make ids and canonical BikeWale URLs.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    AUTOCOMPLETE_SOURCES,
    BIKEWALE_BASE,
    bikewaleFetch,
    canonicalUrl,
    requireLimit,
    requireQuery,
} from './utils.js';

cli({
    site: 'bikewale',
    name: 'search',
    access: 'read',
    description: 'Search BikeWale public bike and scooter suggestions',
    domain: 'www.bikewale.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Bike, scooter, brand, or keyword (e.g. "activa", "royal enfield")' },
        { name: 'limit', type: 'int', default: 10, help: 'Maximum suggestions to return (1-20)' },
    ],
    columns: ['rank', 'name', 'make', 'model', 'type', 'additionalInfo', 'modelId', 'makeId', 'url'],
    func: async (args) => {
        const query = requireQuery(args.query);
        const limit = requireLimit(args.limit);
        const params = new URLSearchParams({
            source: AUTOCOMPLETE_SOURCES,
            value: query,
            size: String(limit),
            applicationId: '2',
            showNoResult: 'true',
            cityId: '-1',
        });
        const body = await bikewaleFetch(`${BIKEWALE_BASE}/api/v4/autocomplete/?${params.toString()}`, 'bikewale search');
        const list = Array.isArray(body) ? body : [];
        const results = list
            .filter((item) => item && typeof item === 'object' && item.displayName)
            .slice(0, limit);
        if (!results.length) {
            throw new EmptyResultError('bikewale search', `No BikeWale suggestions matched "${query}".`);
        }
        return results.map((item, i) => {
            const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
            return {
                rank: i + 1,
                name: String(item.displayName ?? '').trim(),
                make: String(payload.makeName ?? '').trim(),
                model: String(payload.modelName ?? '').trim(),
                type: item.suggestionType != null ? Number(item.suggestionType) : null,
                additionalInfo: String(item.additionalInfo ?? '').trim(),
                modelId: payload.modelId ? Number(payload.modelId) : null,
                makeId: payload.makeId ? Number(payload.makeId) : null,
                url: canonicalUrl(payload.url),
            };
        });
    },
});
