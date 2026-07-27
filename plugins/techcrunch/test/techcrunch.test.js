import assert from 'node:assert/strict';
import test from 'node:test';

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
