import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import './article.js';

const TWEET_ID = '1234567890';

function createPage(articleResult) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'csrf-token' }]),
    evaluate: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(articleResult),
  };
}

function createPageWithEvaluateResults(evaluateResults) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'csrf-token' }]),
    evaluate: vi.fn().mockImplementation(() => Promise.resolve(evaluateResults.shift())),
  };
}

function validArticlePayload(tweetOverrides = {}) {
  return {
    data: {
      tweetResult: {
        result: {
          tweet: {
            rest_id: TWEET_ID,
            legacy: { full_text: 'fallback text' },
            core: {
              user_results: {
                result: { legacy: { screen_name: 'alice' } },
              },
            },
            article: {
              article_results: {
                result: {
                  title: 'Long article',
                  content_state: {
                    blocks: [{ type: 'unstyled', text: 'body' }],
                  },
                },
              },
            },
            ...tweetOverrides,
          },
        },
      },
    },
  };
}

async function evaluateArticleFetchScript(script, fetchImplementation) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(fetchImplementation);
  try {
    return await eval(`(${script})`)();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function createFetchPage(fetchImplementation) {
  const page = createPageWithEvaluateResults([]);
  page.evaluate
    .mockImplementationOnce(() => Promise.resolve(null))
    .mockImplementationOnce((script) => evaluateArticleFetchScript(script, fetchImplementation));
  return page;
}

function jsonResponse(payload, overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(payload),
    ...overrides,
  };
}

describe('twitter article command', () => {
  const command = getRegistry().get('twitter/article');
  const rows = [{
    title: 'Long article',
    author: 'alice',
    content: 'body',
    url: `https://x.com/alice/status/${TWEET_ID}`,
  }];

  it('accepts raw Cloak rows and legacy Browser Bridge envelopes', async () => {
    await expect(command.func(createPage(rows), { 'tweet-id': TWEET_ID })).resolves.toEqual(rows);
    await expect(command.func(createPage({ session: 'browser:default', data: rows }), { 'tweet-id': TWEET_ID }))
      .resolves.toEqual(rows);
  });

  it('unwraps legacy envelopes while resolving article URLs', async () => {
    const page = createPageWithEvaluateResults([
      { session: 'browser:default', data: TWEET_ID },
      null,
      rows,
    ]);

    await expect(command.func(page, { 'tweet-id': 'https://x.com/i/article/987654321' }))
      .resolves.toEqual(rows);
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://x.com/i/article/987654321');
    expect(page.goto).toHaveBeenNthCalledWith(2, `https://x.com/i/status/${TWEET_ID}`);
  });

  it('maps 401 and 403 API responses to AuthRequiredError', async () => {
    for (const httpStatus of [401, 403]) {
      await expect(command.func(createPage({ httpStatus }), { 'tweet-id': TWEET_ID }))
        .rejects.toBeInstanceOf(AuthRequiredError);
    }
  });

  it('fails closed for malformed evaluated response payloads', async () => {
    for (const value of [null, 42, {}, { session: 'browser:default', data: {} }]) {
      await expect(command.func(createPage(value), { 'tweet-id': TWEET_ID }))
        .rejects.toBeInstanceOf(CommandExecutionError);
    }
  });

  it('reports invalid JSON and network failures as typed command errors', async () => {
    const invalidJsonPage = createFetchPage(async () => ({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('invalid JSON')),
    }));
    await expect(command.func(invalidJsonPage, { 'tweet-id': TWEET_ID }))
      .rejects.toBeInstanceOf(CommandExecutionError);

    const networkPage = createFetchPage(async () => {
      throw new Error('socket closed');
    });
    await expect(command.func(networkPage, { 'tweet-id': TWEET_ID }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('rejects null and array GraphQL roots', async () => {
    for (const payload of [null, []]) {
      const page = createFetchPage(async () => jsonResponse(payload));
      await expect(command.func(page, { 'tweet-id': TWEET_ID }))
        .rejects.toBeInstanceOf(CommandExecutionError);
    }
  });

  it('surfaces GraphQL errors instead of returning a generic not-found error', async () => {
    const page = createFetchPage(async () => jsonResponse({
      errors: [{ message: 'rate limited' }],
    }));

    await expect(command.func(page, { 'tweet-id': TWEET_ID }))
      .rejects.toThrow(/GraphQL errors/);
  });

  it('requires the returned tweet identity to match the request', async () => {
    const page = createFetchPage(async () => jsonResponse(validArticlePayload({ rest_id: '999' })));

    await expect(command.func(page, { 'tweet-id': TWEET_ID }))
      .rejects.toThrow(/did not match requested tweet/);
  });

  it('requires a valid author screen name', async () => {
    for (const screenName of ['', 'bad/name']) {
      const payload = validArticlePayload({
        core: { user_results: { result: { legacy: { screen_name: screenName } } } },
      });
      const page = createFetchPage(async () => jsonResponse(payload));
      await expect(command.func(page, { 'tweet-id': TWEET_ID }))
        .rejects.toThrow(/valid author screen name/);
    }
  });

  it('fails closed for malformed tweet, article, content, and block shapes', async () => {
    const payloads = [
      { data: { tweetResult: { result: 'not-an-object' } } },
      { data: { tweetResult: { result: { tweet: 'not-an-object' } } } },
      validArticlePayload({ article: { article_results: { result: 'not-an-object' } } }),
      validArticlePayload({ article: { article_results: { result: { content_state: [] } } } }),
      validArticlePayload({ article: { article_results: { result: { content_state: { blocks: {} } } } } }),
    ];

    for (const payload of payloads) {
      const page = createFetchPage(async () => jsonResponse(payload));
      await expect(command.func(page, { 'tweet-id': TWEET_ID }))
        .rejects.toBeInstanceOf(CommandExecutionError);
    }
  });

  it('keeps the valid note-tweet fallback', async () => {
    const payload = validArticlePayload({
      article: undefined,
      note_tweet: { note_tweet_results: { result: { text: 'A long note' } } },
    });
    const page = createFetchPage(async () => jsonResponse(payload));

    await expect(command.func(page, { 'tweet-id': TWEET_ID })).resolves.toEqual([{
      title: '(Note Tweet)',
      author: 'alice',
      content: 'A long note',
      url: `https://x.com/alice/status/${TWEET_ID}`,
    }]);
  });
});
