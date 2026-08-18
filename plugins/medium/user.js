import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { buildMediumUserUrl, loadMediumPosts } from './utils.js';
cli({
    site: 'medium',
    name: 'user',
    access: 'read',
    description: 'Get Medium user posts',
    domain: 'medium.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'username', required: true, positional: true, help: 'Medium username(for example @username or username)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts to return' },
    ],
    columns: ['rank', 'title', 'date', 'readTime', 'claps', 'url'],
    func: async (page, args) => loadMediumPosts(page, buildMediumUserUrl(args.username), Number(args.limit) || 20),
});
