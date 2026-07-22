// openbrewerydb brewery — fetch one brewery by its Open Brewery DB id.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    BREWERY_COLUMNS,
    OPENBREWERYDB_BASE,
    openBreweryDbFetch,
    projectBrewery,
    requireString,
} from './utils.js';

cli({
    site: 'openbrewerydb',
    name: 'brewery',
    access: 'read',
    description: 'Get one Open Brewery DB brewery by id',
    domain: 'api.openbrewerydb.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Open Brewery DB brewery id (returned by search)' },
    ],
    columns: BREWERY_COLUMNS,
    func: async (args) => {
        const id = requireString(args.id, 'brewery id');
        const brewery = await openBreweryDbFetch(
            `${OPENBREWERYDB_BASE}/breweries/${encodeURIComponent(id)}`,
            `openbrewerydb brewery ${id}`,
        );
        if (!brewery || !brewery.id) {
            throw new EmptyResultError('openbrewerydb brewery', `No brewery found for id "${id}".`);
        }
        return [projectBrewery(brewery)];
    },
});
