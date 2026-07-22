import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { fetchPosts, mapPost, parseLimit } from './utils.js';

cli({
    site: 'bmwblog',
    name: 'latest',
    access: 'read',
    description: 'List the latest BMWBLOG articles',
    domain: 'www.bmwblog.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of articles (1-50)' },
    ],
    columns: ['rank', 'title', 'date', 'author', 'section', 'excerpt', 'url'],
    func: async (args) => {
        const limit = parseLimit(args.limit);
        const posts = await fetchPosts({ per_page: limit, orderby: 'date', order: 'desc' }, 'bmwblog latest');
        const rows = posts.map((post, index) => mapPost(post, index + 1)).filter((row) => row.title && row.url);
        if (!rows.length) {
            throw new EmptyResultError('bmwblog latest', 'BMWBLOG returned no published articles');
        }
        return rows;
    },
});
