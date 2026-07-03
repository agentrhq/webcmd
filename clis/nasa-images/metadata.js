import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, fetchJson, requireNasaId } from './utils.js';

cli({
    site: 'nasa-images',
    name: 'metadata',
    access: 'read',
    description: 'Get the metadata JSON URL for a NASA media item',
    domain: 'images-api.nasa.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'nasaId', positional: true, required: true, help: 'NASA media id, e.g. as11-40-5874' },
    ],
    columns: ['nasaId', 'metadataUrl'],
    func: async (args) => {
        const nasaId = requireNasaId(args.nasaId);
        const url = new URL(`${API_BASE}/metadata/${encodeURIComponent(nasaId)}`);
        const body = await fetchJson(url, 'nasa-images metadata', { emptyOn404: true });
        const metadataUrl = String(body?.location ?? '').trim();
        if (!metadataUrl) {
            throw new EmptyResultError('nasa-images metadata', `No metadata URL found for "${nasaId}".`);
        }
        return [{ nasaId, metadataUrl }];
    },
});
