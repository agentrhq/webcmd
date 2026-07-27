import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

import { articleText, fetchPosts, plainText } from './lib/api.js';

function articleSlug(raw) {
    let url;
    try {
        url = new URL(String(raw ?? ''));
    } catch {
        throw new ArgumentError('Provide a valid TechCrunch article URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol)
        || !['techcrunch.com', 'www.techcrunch.com'].includes(url.hostname.toLowerCase())) {
        throw new ArgumentError('Provide a valid TechCrunch article URL.');
    }
    const match = url.pathname.match(/^\/\d{4}\/\d{2}\/\d{2}\/([^/]+)\/?$/);
    if (!match) {
        throw new ArgumentError('Provide a valid TechCrunch article URL.');
    }
    try {
        return decodeURIComponent(match[1]);
    } catch {
        throw new ArgumentError('Provide a valid TechCrunch article URL.');
    }
}

function articleCategories(post) {
    const graph = post?.yoast_head_json?.schema?.['@graph'];
    const article = Array.isArray(graph)
        ? graph.find(node => node?.['@type'] === 'NewsArticle')
        : null;
    const sections = article?.articleSection;
    return Array.isArray(sections) ? sections : sections ? [sections] : [];
}

export async function articleTechCrunch(args, request = fetch) {
    const slug = articleSlug(args.url);
    const posts = await fetchPosts({
        slug,
        per_page: 1,
        _fields: 'date,link,title,content,yoast_head_json.author,yoast_head_json.description,yoast_head_json.schema',
    }, request);
    const post = posts[0];
    if (!post) {
        throw new EmptyResultError(
            'techcrunch article',
            `No TechCrunch article found for "${slug}".`,
        );
    }

    const content = articleText(post?.content?.rendered);
    if (!content) {
        throw new EmptyResultError(
            'techcrunch article',
            `The TechCrunch article "${slug}" has no readable content.`,
        );
    }
    return [{
        title: plainText(post?.title?.rendered),
        author: plainText(post?.yoast_head_json?.author) || null,
        publishedAt: post?.date || null,
        categories: articleCategories(post),
        description: plainText(post?.yoast_head_json?.description) || null,
        content,
        url: post?.link || String(args.url),
    }];
}

cli({
    site: 'techcrunch',
    name: 'article',
    access: 'read',
    description: 'Read a TechCrunch article from its URL',
    domain: 'techcrunch.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'url', positional: true, required: true, type: 'string', help: 'TechCrunch article URL' },
    ],
    columns: ['title', 'author', 'publishedAt', 'categories', 'description', 'content', 'url'],
    func: args => articleTechCrunch(args),
});
