import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
function headers() {
    return {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
    };
}
function trim(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
function publicationBaseUrl(publication) {
    if (publication?.custom_domain)
        return `https://${publication.custom_domain}`;
    if (publication?.subdomain)
        return `https://${publication.subdomain}.substack.com`;
    return '';
}
async function searchPosts(keyword, limit) {
    const url = new URL('https://substack.com/api/v1/post/search');
    url.searchParams.set('query', keyword);
    url.searchParams.set('page', '0');
    url.searchParams.set('includePlatformResults', 'true');
    const resp = await fetch(url, { headers: headers() });
    if (!resp.ok)
        throw new CommandExecutionError(`Substack post search failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.slice(0, limit).map((item, index) => ({
        rank: index + 1,
        title: trim(item?.title),
        author: trim(item?.publishedBylines?.[0]?.name),
        date: trim(item?.post_date).split('T')[0] || trim(item?.post_date),
        description: trim(item?.description || item?.subtitle || item?.truncated_body_text).slice(0, 150),
        url: trim(item?.canonical_url),
    }));
}
async function searchPublications(keyword, limit) {
    const url = new URL('https://substack.com/api/v1/profile/search');
    url.searchParams.set('query', keyword);
    url.searchParams.set('page', '0');
    const resp = await fetch(url, { headers: headers() });
    if (!resp.ok)
        throw new CommandExecutionError(`Substack publication search failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.slice(0, limit).map((item, index) => {
        const publication = item?.primaryPublication || item?.publicationUsers?.[0]?.publication || {};
        return {
            rank: index + 1,
            title: trim(publication?.name || item?.name),
            author: trim(item?.name),
            date: '',
            description: trim(publication?.hero_text || item?.bio).slice(0, 150),
            url: publicationBaseUrl(publication),
        };
    });
}
cli({
    site: 'substack',
    name: 'search',
    access: 'read',
    description: 'Search Substack posts and newsletters',
    domain: 'substack.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'keyword', required: true, positional: true, help: 'Search keyword' },
        { name: 'type', default: 'posts', choices: ['posts', 'publications'], help: 'Search type(posts=posts, publications=Newsletter)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results to return' },
    ],
    columns: ['rank', 'title', 'author', 'date', 'description', 'url'],
    func: async (args) => {
        const limit = Math.max(1, Math.min(Number(args.limit) || 20, 50));
        return args.type === 'publications'
            ? searchPublications(args.keyword, limit)
            : searchPosts(args.keyword, limit);
    },
});
