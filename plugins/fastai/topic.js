import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { FASTAI_BASE, fastaiFetch, htmlToText, requireBoundedInt } from './utils.js';

cli({
    site: 'fastai',
    name: 'topic',
    access: 'read',
    description: 'Read a public fast.ai forum topic and its replies by numeric id',
    domain: 'forums.fast.ai',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Numeric topic id from a forum URL' },
        { name: 'max-length', type: 'int', default: 10000, help: 'Maximum characters per post (1-50000)' },
    ],
    columns: ['topic_id', 'title', 'post_number', 'author', 'created_at', 'reply_to', 'body', 'url'],
    func: async (args) => {
        const id = String(args.id ?? '').trim();
        if (!/^\d+$/.test(id) || Number(id) <= 0) {
            throw new ArgumentError('fastai topic id must be a positive integer');
        }
        const maxLength = requireBoundedInt(args['max-length'], 10000, 50000, 'max-length');
        const topic = await fastaiFetch(`/t/${id}.json`, 'topic');
        const posts = Array.isArray(topic?.post_stream?.posts) ? topic.post_stream.posts : [];
        if (!topic || !posts.length) {
            throw new EmptyResultError(`fastai topic ${id}`, 'Topic not found or it has no public posts.');
        }
        return posts.map((post) => {
            const body = htmlToText(post.cooked);
            return {
                topic_id: topic.id,
                title: String(topic.title ?? ''),
                post_number: post.post_number,
                author: String(post.username ?? ''),
                created_at: String(post.created_at ?? ''),
                reply_to: post.reply_to_post_number ?? null,
                body: body.length > maxLength ? `${body.slice(0, maxLength)}\n\n... [truncated]` : body,
                url: `${FASTAI_BASE}${post.post_url || `/t/${topic.slug || '-'}/${topic.id}/${post.post_number}`}`,
            };
        });
    },
});
