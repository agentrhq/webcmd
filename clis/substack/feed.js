import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { buildSubstackBrowseUrl, loadSubstackFeed } from './utils.js';
cli({
    site: 'substack',
    name: 'feed',
    access: 'read',
    description: 'Substack popular posts Feed',
    domain: 'substack.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'category', default: 'all', help: 'Post category: all, tech, business, culture, politics, science, health' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts to return' },
    ],
    columns: ['rank', 'title', 'author', 'date', 'readTime', 'url'],
    func: async (page, args) => loadSubstackFeed(page, buildSubstackBrowseUrl(args.category), Number(args.limit) || 20),
});
