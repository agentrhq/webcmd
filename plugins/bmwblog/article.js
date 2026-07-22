import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { fetchPosts, mapArticle, parseArticleSlug } from './utils.js';

cli({
    site: 'bmwblog',
    name: 'article',
    access: 'read',
    description: 'Read a BMWBLOG article by URL or slug',
    domain: 'www.bmwblog.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'url-or-slug', required: true, positional: true, help: 'BMWBLOG article URL or slug' },
    ],
    columns: ['title', 'date', 'author', 'sections', 'excerpt', 'url', 'content'],
    func: async (args) => {
        const slug = parseArticleSlug(args['url-or-slug']);
        const posts = await fetchPosts({ slug, per_page: 1 }, 'bmwblog article');
        if (!posts.length) {
            throw new EmptyResultError('bmwblog article', `Article "${slug}" was not found`);
        }
        const article = mapArticle(posts[0]);
        if (!article.title || !article.url) {
            throw new CommandExecutionError('bmwblog article returned an unexpected article shape');
        }
        if (!article.content) {
            throw new EmptyResultError('bmwblog article', `Article "${slug}" has no readable content`);
        }
        return [article];
    },
});
