import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import '../search.js';

function createPage(payload) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(payload),
  };
}

function createDomPage(html, url = 'https://www.facebook.com/search/top?q=ai') {
  const dom = new JSDOM(html, { url });
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation((script) => (
      Function('window', 'document', `return ${script};`)(dom.window, dom.window.document)
    )),
  };
}

function searchCommand() {
  return getRegistry().get('facebook/search');
}

describe('facebook search', () => {
  it('registers a function command with the existing row contract', () => {
    const command = searchCommand();
    expect(command).toBeDefined();
    expect(command.columns).toEqual(['index', 'title', 'text', 'url']);
    expect(command.func).toBeTypeOf('function');
  });

  it('navigates home then to search results before extracting', async () => {
    const page = createPage({ status: 'ok', rows: [{ index: 1, title: 'X', text: 'x', url: 'https://www.facebook.com/x' }] });
    await searchCommand().func(page, { query: 'AI agent', limit: 3 });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://www.facebook.com');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://www.facebook.com/search/top?q=AI%20agent', { settleMs: 4000 });
    expect(String(page.evaluate.mock.calls[0]?.[0] ?? '')).not.toContain('window.location.href');
  });

  it('extracts feed links while dropping search, chrome, and obfuscated decoys', async () => {
    const page = createDomPage(`
      <div role="feed">
        <div><a role="link" href="https://www.facebook.com/carol.page">Carol's Page</a><span>Public figure · 12K followers</span></div>
        <div><a role="link" href="https://www.facebook.com/groups/1234567/">AI Builders Group</a><span>Group · 3K members</span></div>
        <div><a role="link" href="https://www.facebook.com/dave/posts/9988">Dave's post about AI agents</a></div>
        <a role="link" href="https://www.facebook.com/search/top?q=aaaa">See more results</a>
        <a role="link" href="https://www.facebook.com/search?q=bare">Bare search decoy</a>
        <a role="link" href="https://www.facebook.com/marketplace">Marketplace</a>
        <a role="link" href="https://www.facebook.com/messages/t/123">Messages</a>
        <a role="link" href="https://evil-cdn.com/x">1234567890123456</a>
        <a role="link" href="https://www.facebook.com/a.b.c">a b c d e f</a>
      </div>
    `);

    const rows = await searchCommand().func(page, { query: 'ai', limit: 10 });
    expect(rows.map((row) => row.url)).toEqual([
      'https://www.facebook.com/carol.page',
      'https://www.facebook.com/groups/1234567/',
      'https://www.facebook.com/dave/posts/9988',
    ]);
    expect(rows[0].title).toBe("Carol's Page");
  });

  it('deduplicates result URLs and honours the limit', async () => {
    const page = createDomPage(`
      <div role="feed">
        <div><a href="https://www.facebook.com/carol.page">Carol's Page</a></div>
        <div><a href="https://www.facebook.com/carol.page?ref=xyz">Carol's Page again</a></div>
        <div><a href="https://www.facebook.com/erin">Erin</a></div>
      </div>
    `);

    const rows = await searchCommand().func(page, { query: 'ai', limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe('https://www.facebook.com/carol.page');
  });

  it('keeps distinct permalink.php posts apart by their identity query', async () => {
    // permalink.php / story.php / watch encode identity in the query string;
    // deduping on pathname alone collapses different posts into one row.
    const page = createDomPage(`
      <div role="feed">
        <div><a role="link" href="https://www.facebook.com/permalink.php?story_fbid=1001&id=50">First distinct post about AI research</a></div>
        <div><a role="link" href="https://www.facebook.com/permalink.php?story_fbid=2002&id=50">Second distinct post about AI safety</a></div>
        <div><a role="link" href="https://www.facebook.com/watch/?v=111">Video one about AI agents here</a></div>
        <div><a role="link" href="https://www.facebook.com/watch/?v=222">Video two about AI agents here</a></div>
      </div>
    `);

    const rows = await searchCommand().func(page, { query: 'ai', limit: 10 });
    expect(rows.map((row) => row.url)).toEqual([
      'https://www.facebook.com/permalink.php?story_fbid=1001&id=50',
      'https://www.facebook.com/permalink.php?story_fbid=2002&id=50',
      'https://www.facebook.com/watch/?v=111',
      'https://www.facebook.com/watch/?v=222',
    ]);
  });

  it('keeps profile and photo identities without treating arbitrary query params as identity', async () => {
    const page = createDomPage(`
      <div role="feed">
        <div><a role="link" href="https://www.facebook.com/profile.php?id=1001&ref=search">First profile result with details</a></div>
        <div><a role="link" href="https://www.facebook.com/profile.php?id=2002&ref=search">Second profile result with details</a></div>
        <div><a role="link" href="https://www.facebook.com/photo.php?fbid=3003&id=1001&__tn__=R">Photo result with useful details</a></div>
        <div><a role="link" href="https://www.facebook.com/realpage?id=tracking-a">Same vanity page first render</a></div>
        <div><a role="link" href="https://www.facebook.com/realpage?id=tracking-b">Same vanity page second render</a></div>
      </div>
    `);

    const rows = await searchCommand().func(page, { query: 'ai', limit: 10 });
    expect(rows.map((row) => row.url)).toEqual([
      'https://www.facebook.com/profile.php?id=1001',
      'https://www.facebook.com/profile.php?id=2002',
      'https://www.facebook.com/photo.php?fbid=3003&id=1001',
      'https://www.facebook.com/realpage',
    ]);
  });

  it('dedupes one post rendered with different per-render tracking nonces', async () => {
    // FB appends __cft__ / __tn__ nonces that differ on every render; keeping
    // them in the key would make the same post appear as multiple rows.
    const page = createDomPage(`
      <div role="feed">
        <div><a role="link" href="https://www.facebook.com/permalink.php?story_fbid=1001&id=50&__cft__[0]=nonceA&__tn__=R">Same post rendered once here now</a></div>
        <div><a role="link" href="https://www.facebook.com/permalink.php?story_fbid=1001&id=50&__cft__[0]=nonceB&__tn__=H">Same post rendered twice here now</a></div>
      </div>
    `);

    const rows = await searchCommand().func(page, { query: 'ai', limit: 10 });
    expect(rows.map((row) => row.url)).toEqual(['https://www.facebook.com/permalink.php?story_fbid=1001&id=50']);
  });

  it('drops l.facebook.com / lm.facebook.com outbound-redirect shims', async () => {
    // /l.php?u=… wrappers are external-link redirects, not search entities; their
    // pathname would otherwise slip through the vanity catch-all.
    const page = createDomPage(`
      <div role="feed">
        <div><a role="link" href="https://www.facebook.com/realpage">Real Page result here</a></div>
        <a role="link" href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com&h=AbC">External article link in a post</a>
        <a role="link" href="https://lm.facebook.com/l.php?u=https%3A%2F%2Fexample.org">Another external redirect link here</a>
      </div>
    `);

    const rows = await searchCommand().func(page, { query: 'ai', limit: 10 });
    expect(rows.map((row) => row.url)).toEqual(['https://www.facebook.com/realpage']);
  });

  it('validates query and limit before navigation', async () => {
    const page = createPage({ status: 'ok', rows: [] });
    await expect(searchCommand().func(page, { query: '  ', limit: 3 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(searchCommand().func(page, { query: 'ok', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('maps auth, empty, drift, and malformed payloads to typed errors', async () => {
    await expect(searchCommand().func(createPage({ status: 'auth', rows: [] }), { query: 'q', limit: 1 }))
      .rejects.toBeInstanceOf(AuthRequiredError);
    await expect(searchCommand().func(createPage({ status: 'no_rows', rows: [], diagnostics: {} }), { query: 'q', limit: 1 }))
      .rejects.toBeInstanceOf(EmptyResultError);
    await expect(searchCommand().func(createPage({ status: 'no_rows', rows: [], diagnostics: { anchorCount: 40, mainTextLength: 800 } }), { query: 'q', limit: 1 }))
      .rejects.toBeInstanceOf(CommandExecutionError);
    await expect(searchCommand().func(createPage({ rows: null }), { query: 'q', limit: 1 }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });
});
