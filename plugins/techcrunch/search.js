import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

import { fetchPosts, parseLimit, postSummary } from './lib/api.js';

export async function searchTechCrunch(args, request = fetch) {
    const query = String(args.query ?? '').trim();
    const latest = args.latest === true;
    if (!query && !latest) {
        throw new ArgumentError('Provide a query or --latest.');
    }
    if (query && latest) {
        throw new ArgumentError('A search query cannot be combined with --latest.');
    }

    const limit = parseLimit(args.limit);
    const params = {
        per_page: limit,
        orderby: latest ? 'date' : 'relevance',
        order: 'desc',
        _fields: 'id,date,link,title,excerpt,yoast_head_json.author,yoast_head_json.description',
    };
    if (query) params.search = query;

    const posts = await fetchPosts(params, request);
    const rows = posts.map((post, index) => postSummary(post, index + 1))
        .filter(row => row.title && row.url);
    if (!rows.length) {
        throw new EmptyResultError(
            'techcrunch search',
            latest ? 'TechCrunch returned no recent stories.' : `No TechCrunch stories matched "${query}".`,
        );
    }
    return rows;
}

cli({
    site: 'techcrunch',
    name: 'search',
    access: 'read',
    description: 'Search TechCrunch stories or list the latest stories',
    domain: 'techcrunch.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: false, type: 'string', help: 'Words to search for' },
        { name: 'latest', type: 'boolean', default: false, help: 'List the latest stories instead of searching' },
        { name: 'limit', type: 'int', default: 20, help: 'Maximum stories to return (1-50)' },
    ],
    columns: ['rank', 'title', 'author', 'publishedAt', 'description', 'url'],
    func: searchTechCrunch,
});
