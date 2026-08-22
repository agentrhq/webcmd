import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import '../research.js';
import '../verdict.js';

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Fake fetch helpers
// ---------------------------------------------------------------------------

/** Reddit JSON API shape */
function redditResponse(posts) {
  return {
    data: {
      children: posts.map((p) => ({ kind: 't3', data: p })),
    },
  };
}

/** HN Algolia shape */
function hnResponse(hits) {
  return { hits };
}

/** Generic 200 OK stub */
function stubFetch(handler) {
  vi.stubGlobal('fetch', async (input) => {
    const body = await handler(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

// ---------------------------------------------------------------------------
// redditSearch (via sources.js)
// ---------------------------------------------------------------------------

describe('redditSearch', () => {
  it('returns normalized rows from Reddit JSON API', async () => {
    const { redditSearch } = await import('../sources.js');

    stubFetch(() =>
      redditResponse([
        {
          title: 'Why Rust is fast',
          author: 'rustacean',
          score: 420,
          num_comments: 87,
          created_utc: 1700000000,
          url: 'https://example.com/rust-fast',
          selftext: '',
          permalink: '/r/rust/comments/abc/why_rust_is_fast/',
        },
      ]),
    );

    const rows = await redditSearch('rust', 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('reddit');
    expect(rows[0].title).toBe('Why Rust is fast');
    expect(rows[0].author).toBe('rustacean');
    expect(rows[0].score).toBe(420);
    expect(rows[0].commentCount).toBe(87);
    expect(rows[0].url).toBe('https://example.com/rust-fast');
    expect(rows[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('falls back to permalink when url field is absent', async () => {
    const { redditSearch } = await import('../sources.js');

    stubFetch(() =>
      redditResponse([
        {
          title: 'A self post',
          author: 'op',
          score: 10,
          num_comments: 2,
          created_utc: 1700000000,
          url: null,
          selftext: 'Some body text',
          permalink: '/r/programming/comments/xyz/a_self_post/',
        },
      ]),
    );

    const rows = await redditSearch('selfpost', 5);
    expect(rows[0].url).toBe('https://www.reddit.com/r/programming/comments/xyz/a_self_post/');
  });

  it('returns empty array when Reddit returns no children', async () => {
    const { redditSearch } = await import('../sources.js');
    stubFetch(() => ({ data: { children: [] } }));
    const rows = await redditSearch('xyzzy-no-results', 5);
    expect(rows).toHaveLength(0);
  });

  it('hits the correct Reddit search endpoint', async () => {
    const { redditSearch } = await import('../sources.js');
    const calls = [];
    vi.stubGlobal('fetch', async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: { children: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await redditSearch('browser automation', 10);
    expect(calls[0]).toContain('reddit.com/search.json');
    expect(calls[0]).toContain('browser+automation');
  });
});

// ---------------------------------------------------------------------------
// omnisearch research — Reddit integration
// ---------------------------------------------------------------------------

describe('omnisearch research with reddit source', () => {
  it('returns Reddit rows when sources=reddit', async () => {
    const command = getRegistry().get('omnisearch/research');

    stubFetch(() =>
      redditResponse([
        {
          title: 'Playwright vs Puppeteer',
          author: 'tester',
          score: 300,
          num_comments: 45,
          created_utc: 1700000000,
          url: 'https://example.com/pw-vs-pp',
          selftext: '',
          permalink: '/r/webdev/comments/pw-vs-pp/',
        },
      ]),
    );

    const rows = await command.func({ query: 'playwright', limit: 5, sources: 'reddit' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].platform).toBe('reddit');
    expect(rows[0].title).toBe('Playwright vs Puppeteer');
  });

  it('includes reddit in default sources', () => {
    const command = getRegistry().get('omnisearch/research');
    const sourcesArg = command.args.find((a) => a.name === 'sources');
    expect(sourcesArg.default).toContain('reddit');
  });

  it('handles reddit failure gracefully when other sources succeed', async () => {
    const command = getRegistry().get('omnisearch/research');

    vi.stubGlobal('fetch', async (input) => {
      if (String(input).includes('reddit.com')) {
        return new Response('Service Unavailable', { status: 503 });
      }
      // HN succeeds
      return new Response(
        JSON.stringify(hnResponse([
          { objectID: '1', title: 'HN result', author: 'a', points: 10, num_comments: 2, created_at: '2026-01-01T00:00:00Z', url: 'https://example.com' },
        ])),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    // Should not throw — Reddit failure is isolated via Promise.allSettled
    const rows = await command.func({ query: 'test', limit: 5, sources: 'hn,reddit' });
    expect(rows.some((r) => r.platform === 'hackernews')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Original limit test (kept for regression)
// ---------------------------------------------------------------------------

describe('omnisearch research — limit enforcement', () => {
  it('honors the total limit when research is narrowed to one source', async () => {
    const hits = [
      { objectID: '1', title: 'One',   author: 'a', points: 5, num_comments: 1, created_at: '2026-01-01T00:00:00Z', url: 'https://example.com/1' },
      { objectID: '2', title: 'Two',   author: 'b', points: 4, num_comments: 2, created_at: '2026-01-02T00:00:00Z', url: 'https://example.com/2' },
      { objectID: '3', title: 'Three', author: 'c', points: 3, num_comments: 3, created_at: '2026-01-03T00:00:00Z', url: 'https://example.com/3' },
      { objectID: '4', title: 'Four',  author: 'd', points: 2, num_comments: 4, created_at: '2026-01-04T00:00:00Z', url: 'https://example.com/4' },
      { objectID: '5', title: 'Five',  author: 'e', points: 1, num_comments: 5, created_at: '2026-01-05T00:00:00Z', url: 'https://example.com/5' },
    ];
    vi.stubGlobal('fetch', async (input) => {
      const count = Number(new URL(input).searchParams.get('hitsPerPage'));
      return new Response(JSON.stringify({ hits: hits.slice(0, count) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const command = getRegistry().get('omnisearch/research');
    const rows = await command.func({ query: 'webcmd', limit: 5, sources: 'hn' });
    expect(rows.map((row) => row.title)).toEqual(['One', 'Two', 'Three', 'Four', 'Five']);
  });
});
