import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { fastaiFetch, requireBoundedInt, requireString, topicUrl } from './utils.js';

cli({
    site: 'fastai',
    name: 'search',
    access: 'read',
    description: 'Search public fast.ai forum topics and posts',
    domain: 'forums.fast.ai',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Words to search for' },
        { name: 'limit', type: 'int', default: 20, help: 'Maximum matches to return (1-50)' },
    ],
    columns: ['topic_id', 'title', 'post_number', 'author', 'excerpt', 'created_at', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 50, 'limit');
        const body = await fastaiFetch(`/search.json?q=${encodeURIComponent(query)}`, 'search');
        const posts = Array.isArray(body?.posts) ? body.posts : [];
        const topics = new Map(
            (Array.isArray(body?.topics) ? body.topics : []).map((topic) => [topic.id, topic]),
        );
        if (!posts.length) {
            throw new EmptyResultError('fastai search', `No public forum posts matched "${query}".`);
        }
        return posts.slice(0, limit).map((post) => {
            const topic = topics.get(post.topic_id) ?? {};
            const baseUrl = topicUrl({ id: post.topic_id, slug: topic.slug });
            return {
                topic_id: post.topic_id,
                title: String(topic.title ?? ''),
                post_number: post.post_number,
                author: String(post.username ?? ''),
                excerpt: String(post.blurb ?? '').replace(/\s+/g, ' ').trim(),
                created_at: String(post.created_at ?? ''),
                url: baseUrl ? `${baseUrl}/${post.post_number}` : '',
            };
        });
    },
});
