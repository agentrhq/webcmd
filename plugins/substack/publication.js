import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { loadSubstackArchive } from './utils.js';
cli({
    site: 'substack',
    name: 'publication',
    access: 'read',
    description: 'Get a specific Substack Newsletter latest posts',
    domain: 'substack.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: 'Newsletter URL(for example https://example.substack.com)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts to return' },
    ],
    columns: ['rank', 'title', 'date', 'description', 'url'],
    func: async (page, args) => loadSubstackArchive(page, args.url.replace(/\/$/, ''), Number(args.limit) || 20),
});
