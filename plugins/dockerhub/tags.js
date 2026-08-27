// dockerhub tags — list public tags for a Docker Hub repository.
//
// Hits `https://hub.docker.com/v2/repositories/<owner>/<name>/tags/?page_size=<limit>`.
// Returns normalized rows of tags: tag, lastUpdated, size, architectures, url.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { HUB_BASE, hubFetch, parseImage, requireBoundedInt, trimDate } from './utils.js';

cli({
    site: 'dockerhub',
    name: 'tags',
    access: 'read',
    description: 'List public tags for a Docker Hub repository',
    domain: 'hub.docker.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'image', positional: true, required: true, help: 'Image name (e.g. "nginx", "library/nginx", "bitnami/redis")' },
        { name: 'limit', type: 'int', default: 25, help: 'Maximum tags to return (1-100)' },
    ],
    columns: ['tag', 'lastUpdated', 'size', 'architectures', 'url'],
    func: async (args) => {
        const { owner, name } = parseImage(args.image);
        const limit = requireBoundedInt(args.limit, 25, 100);
        const url = `${HUB_BASE}/repositories/${owner}/${name}/tags/?page_size=${limit}`;
        const body = await hubFetch(url, 'dockerhub tags');
        const list = Array.isArray(body?.results) ? body.results : [];
        if (!list.length) {
            throw new EmptyResultError('dockerhub tags', `No tags found for repository "${args.image}".`);
        }
        
        return list.slice(0, limit).map((t) => {
            const tag = String(t.name ?? '').trim();
            const lastUpdated = trimDate(t.last_updated ?? t.tag_last_pushed);
            const sizeBytes = t.full_size != null ? Number(t.full_size) : 0;
            // Convert to MB with 2 decimal places
            const sizeMB = sizeBytes > 0 ? `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB` : '0.00 MB';
            
            // Extract distinct architectures
            const images = Array.isArray(t.images) ? t.images : [];
            const archs = [...new Set(images.map(img => img.architecture).filter(Boolean))].join(', ');
            
            const imageSlug = owner === 'library' ? `library/${name}` : `${owner}/${name}`;
            
            return {
                tag,
                lastUpdated,
                size: sizeMB,
                architectures: archs || null,
                url: `https://hub.docker.com/r/${imageSlug}/tags?name=${encodeURIComponent(tag)}`,
            };
        });
    },
});
