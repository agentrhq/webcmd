import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { buildMediumTagUrl, loadMediumPosts } from './utils.js';
cli({
    site: 'medium',
    name: 'feed',
    access: 'read',
    description: 'Medium popular posts Feed',
    domain: 'medium.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'topic', default: '', help: 'Topic (for example technology, programming, ai)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts to return' },
    ],
    columns: ['rank', 'title', 'author', 'date', 'readTime', 'claps'],
    func: async (page, args) => loadMediumPosts(page, buildMediumTagUrl(args.topic), Number(args.limit) || 20),
});
