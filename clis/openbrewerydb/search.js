// openbrewerydb search — partial, case-insensitive brewery name search.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    BREWERY_COLUMNS,
    OPENBREWERYDB_BASE,
    openBreweryDbFetch,
    projectBrewery,
    requireBoundedInt,
    requireString,
} from './utils.js';

cli({
    site: 'openbrewerydb',
    name: 'search',
    access: 'read',
    description: 'Search Open Brewery DB for breweries by name',
    domain: 'api.openbrewerydb.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Brewery name or partial name' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-200)' },
        { name: 'page', type: 'int', default: 1, help: 'Results page (positive integer)' },
    ],
    columns: ['rank', ...BREWERY_COLUMNS],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 200, 'limit');
        const page = requireBoundedInt(args.page, 1, 10000, 'page');
        const url = `${OPENBREWERYDB_BASE}/breweries/search?query=${encodeURIComponent(query)}&per_page=${limit}&page=${page}`;
        const body = await openBreweryDbFetch(url, 'openbrewerydb search');
        const breweries = Array.isArray(body) ? body : [];
        if (!breweries.length) {
            throw new EmptyResultError('openbrewerydb search', `No breweries matched "${query}".`);
        }
        return breweries.map((brewery, index) => ({ rank: (page - 1) * limit + index + 1, ...projectBrewery(brewery) }));
    },
});
