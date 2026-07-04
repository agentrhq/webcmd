import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { buildMediumSearchUrl, loadMediumPosts } from './utils.js';
cli({
    site: 'medium',
    name: 'search',
    access: 'read',
    description: 'Search Medium posts',
    domain: 'medium.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'keyword', required: true, positional: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts to return' },
    ],
    columns: ['rank', 'title', 'author', 'date', 'readTime', 'claps', 'url'],
    func: async (page, args) => loadMediumPosts(page, buildMediumSearchUrl(args.keyword), Number(args.limit) || 20),
});
