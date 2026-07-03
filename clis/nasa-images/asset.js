import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { API_BASE, collectionItems, fetchJson, requireNasaId } from './utils.js';

function fileNameFromHref(href) {
    try {
        return decodeURIComponent(new URL(href).pathname.split('/').pop() ?? '');
    } catch {
        return decodeURIComponent(String(href).split('/').pop() ?? '');
    }
}

function fileVariant(href) {
    const name = fileNameFromHref(href);
    if (/metadata\.json$/i.test(name)) return 'metadata';
    const match = name.match(/~([^./]+)(?:\.[^.]+)?$/);
    return match ? match[1] : '';
}

function fileExtension(href) {
    const match = fileNameFromHref(href).match(/\.([A-Za-z0-9]+)$/);
    return match ? match[1].toLowerCase() : '';
}

cli({
    site: 'nasa-images',
    name: 'asset',
    access: 'read',
    description: 'List downloadable asset files for a NASA media item',
    domain: 'images-api.nasa.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'nasaId', positional: true, required: true, help: 'NASA media id, e.g. as11-40-5874' },
    ],
    columns: ['rank', 'nasaId', 'variant', 'extension', 'url'],
    func: async (args) => {
        const nasaId = requireNasaId(args.nasaId);
        const url = new URL(`${API_BASE}/asset/${encodeURIComponent(nasaId)}`);
        const body = await fetchJson(url, 'nasa-images asset', { emptyOn404: true });
        const items = collectionItems(body).filter((item) => String(item?.href ?? '').trim());
        if (!items.length) {
            throw new EmptyResultError('nasa-images asset', `No asset files found for "${nasaId}".`);
        }

        return items.map((item, i) => {
            const href = String(item.href).trim();
            return {
                rank: i + 1,
                nasaId,
                variant: fileVariant(href),
                extension: fileExtension(href),
                url: href,
            };
        });
    },
});
