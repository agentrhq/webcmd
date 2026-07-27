import assert from 'node:assert/strict';
import test from 'node:test';
import { getRegistry } from '@agentrhq/webcmd/registry';

import { articleTechCrunch } from '../article.js';
import { searchTechCrunch } from '../search.js';

const post = {
    id: 1,
    date: '2026-07-27T00:00:00',
    link: 'https://techcrunch.com/2026/07/27/ai-story/',
    title: { rendered: 'AI story' },
    excerpt: { rendered: '<p>Summary</p>' },
    yoast_head_json: {
        author: 'Reporter',
        description: 'Summary',
    },
};

const articlePost = {
    ...post,
    content: {
        rendered: '<p>First paragraph.</p><p>Second <strong>paragraph</strong>.</p>',
    },
    yoast_head_json: {
        author: 'Reporter',
        description: 'Summary',
        schema: {
            '@graph': [{
                '@type': 'NewsArticle',
                articleSection: ['AI', 'Startups'],
            }],
        },
    },
};

function fakeRequest(posts = [post]) {
    const request = async (url) => {
        request.calls.push(String(url));
        return {
            ok: true,
            json: async () => posts,
        };
    };
    request.calls = [];
    return request;
}

test('search requires a query or --latest', async () => {
    await assert.rejects(
        () => searchTechCrunch({}, fakeRequest()),
        /query or --latest/,
    );
});

test('search rejects a query combined with --latest', async () => {
    await assert.rejects(
        () => searchTechCrunch({ query: 'AI', latest: true }, fakeRequest()),
        /cannot be combined/,
    );
});

test('search returns TechCrunch API results in relevance order', async () => {
    const request = fakeRequest();

    const rows = await searchTechCrunch({ query: 'AI', limit: 1 }, request);

    assert.deepEqual(rows, [{
        rank: 1,
        title: 'AI story',
        author: 'Reporter',
        publishedAt: '2026-07-27T00:00:00',
        description: 'Summary',
        url: 'https://techcrunch.com/2026/07/27/ai-story/',
    }]);
    assert.match(request.calls[0], /search=AI/);
    assert.match(request.calls[0], /orderby=relevance/);
});

test('search --latest requests newest posts without a query', async () => {
    const request = fakeRequest();

    await searchTechCrunch({ latest: true, limit: 2 }, request);

    assert.match(request.calls[0], /orderby=date/);
    assert.match(request.calls[0], /order=desc/);
    assert.doesNotMatch(request.calls[0], /search=/);
});

test('search rejects invalid limits', async () => {
    await assert.rejects(
        () => searchTechCrunch({ latest: true, limit: 51 }, fakeRequest()),
        /integer between 1 and 50/,
    );
});

test('requests identify WebCMD because TechCrunch rejects Node fetch defaults', async () => {
    const request = async (_url, options) => {
        assert.match(options.headers['User-Agent'], /^webcmd\//);
        return { ok: true, json: async () => [post] };
    };

    await searchTechCrunch({ latest: true, limit: 1 }, request);
});

test('article accepts only TechCrunch article URLs', async () => {
    await assert.rejects(
        () => articleTechCrunch({ url: 'https://example.com/story' }, fakeRequest()),
        /TechCrunch article URL/,
    );
    await assert.rejects(
        () => articleTechCrunch({
            url: 'https://techcrunch.com/2026/07/27/%E0%A4%A/',
        }, fakeRequest()),
        error => error.code === 'ARGUMENT',
    );
});

test('article returns metadata and readable full text', async () => {
    const request = fakeRequest([articlePost]);

    const rows = await articleTechCrunch({
        url: 'https://techcrunch.com/2026/07/27/ai-story/',
    }, request);

    assert.deepEqual(rows, [{
        title: 'AI story',
        author: 'Reporter',
        publishedAt: '2026-07-27T00:00:00',
        categories: ['AI', 'Startups'],
        description: 'Summary',
        content: 'First paragraph.\n\nSecond paragraph.',
        url: 'https://techcrunch.com/2026/07/27/ai-story/',
    }]);
    assert.match(request.calls[0], /slug=ai-story/);
});

test('article reports a missing story', async () => {
    await assert.rejects(
        () => articleTechCrunch({
            url: 'https://techcrunch.com/2026/07/27/missing/',
        }, fakeRequest([])),
        error => error.code === 'EMPTY_RESULT'
            && /No TechCrunch article found/.test(error.hint),
    );
});

test('registered non-browser handlers do not treat the debug flag as fetch', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = fakeRequest([articlePost]);
        const registry = getRegistry();

        const search = registry.get('techcrunch/search');
        const article = registry.get('techcrunch/article');
        assert.ok(search?.func);
        assert.ok(article?.func);
        await search.func({ latest: true, limit: 1 }, false);
        await article.func({
            url: 'https://techcrunch.com/2026/07/27/ai-story/',
        }, false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
