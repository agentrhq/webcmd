import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { fetchPosts, mapPost, parseLimit, requireQuery } from './utils.js';

cli({
    site: 'bmwblog',
    name: 'search',
    access: 'read',
    description: 'Search BMWBLOG articles',
    domain: 'www.bmwblog.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (1-50)' },
    ],
    columns: ['rank', 'title', 'date', 'author', 'section', 'excerpt', 'url'],
    func: async (args) => {
        const query = requireQuery(args.query);
        const limit = parseLimit(args.limit);
        const posts = await fetchPosts({ search: query, per_page: limit }, 'bmwblog search');
        const rows = posts.map((post, index) => mapPost(post, index + 1)).filter((row) => row.title && row.url);
        if (!rows.length) {
            throw new EmptyResultError('bmwblog search', `No BMWBLOG articles matched "${query}"`);
        }
        return rows;
    },
});
