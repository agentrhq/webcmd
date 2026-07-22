import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { fastaiFetch, requireBoundedInt, topicUrl } from './utils.js';

cli({
    site: 'fastai',
    name: 'latest',
    access: 'read',
    description: 'List recently active topics on the fast.ai forums',
    domain: 'forums.fast.ai',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Maximum topics to return (1-30)' },
        { name: 'page', type: 'int', default: 1, help: 'Results page (1-based)' },
    ],
    columns: ['id', 'title', 'replies', 'views', 'likes', 'last_poster', 'last_posted_at', 'url'],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 30, 'limit');
        const page = requireBoundedInt(args.page, 1, 1000, 'page');
        const body = await fastaiFetch(`/latest.json?page=${page - 1}`, 'latest');
        const topics = Array.isArray(body?.topic_list?.topics) ? body.topic_list.topics : [];
        if (!topics.length) {
            throw new EmptyResultError('fastai latest', `No topics were returned for page ${page}.`);
        }
        return topics.slice(0, limit).map((topic) => ({
            id: topic.id,
            title: String(topic.title ?? ''),
            replies: Number(topic.reply_count ?? 0),
            views: Number(topic.views ?? 0),
            likes: Number(topic.like_count ?? 0),
            last_poster: String(topic.last_poster_username ?? ''),
            last_posted_at: String(topic.last_posted_at ?? ''),
            url: topicUrl(topic),
        }));
    },
});
