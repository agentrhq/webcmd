import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './search.js';

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
