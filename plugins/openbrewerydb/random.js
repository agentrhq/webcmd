// openbrewerydb random — return one or more random brewery records.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    BREWERY_COLUMNS,
    OPENBREWERYDB_BASE,
    openBreweryDbFetch,
    projectBrewery,
    requireBoundedInt,
} from './utils.js';

cli({
    site: 'openbrewerydb',
    name: 'random',
    access: 'read',
    description: 'Get random breweries from Open Brewery DB',
    domain: 'api.openbrewerydb.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'count', type: 'int', default: 1, help: 'Number of random breweries (1-50)' },
    ],
    columns: BREWERY_COLUMNS,
    func: async (args) => {
        const count = requireBoundedInt(args.count, 1, 50, 'count');
        const body = await openBreweryDbFetch(
            `${OPENBREWERYDB_BASE}/breweries/random?size=${count}`,
            'openbrewerydb random',
        );
        const breweries = Array.isArray(body) ? body : body ? [body] : [];
        if (!breweries.length) {
            throw new EmptyResultError('openbrewerydb random', 'Open Brewery DB returned no random breweries.');
        }
        return breweries.map(projectBrewery);
    },
});
