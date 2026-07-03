import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, fetchJson, requireNasaId } from './utils.js';

cli({
    site: 'nasa-images',
    name: 'captions',
    access: 'read',
    description: 'Get the caption file URL for a NASA video item',
    domain: 'images-api.nasa.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'nasaId', positional: true, required: true, help: 'NASA video id, e.g. 172_ISS-Slosh' },
    ],
    columns: ['nasaId', 'captionsUrl'],
    func: async (args) => {
        const nasaId = requireNasaId(args.nasaId);
        const url = new URL(`${API_BASE}/captions/${encodeURIComponent(nasaId)}`);
        const body = await fetchJson(url, 'nasa-images captions', { emptyOn404: true });
        const captionsUrl = String(body?.location ?? '').trim();
        if (!captionsUrl) {
            throw new EmptyResultError('nasa-images captions', `No captions URL found for "${nasaId}".`);
        }
        return [{ nasaId, captionsUrl }];
    },
});
