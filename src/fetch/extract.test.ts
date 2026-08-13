import { describe, expect, it } from 'vitest';
import { extractFetchedContent } from './extract.js';

describe('extractFetchedContent', () => {
  it('converts a readable HTML response to Markdown with absolute links', () => {
    const result = extractFetchedContent({
      url: 'https://example.com/posts/one',
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><title>Example</title></head><body><article><h1>Example</h1><p>This is enough article content to let Readability identify a useful response from the document.</p><a href="/next">Next</a></article></body></html>',
    });
    expect(result.title).toBe('Example');
    expect(result.content).toContain('[Next](https://example.com/next)');
  });

  it('returns text bodies unchanged', () => {
    expect(extractFetchedContent({ url: 'https://example.com/a', contentType: 'text/plain', body: 'plain text' })).toMatchObject({ content: 'plain text', source: 'raw' });
  });

  it('rejects unsupported content types', () => {
    try {
      extractFetchedContent({ url: 'https://example.com/a', contentType: 'application/pdf', body: '' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'FETCH_UNSUPPORTED_CONTENT_TYPE' });
      return;
    }
    throw new Error('expected unsupported content type');
  });

  it('does not recommend browser rendering for binary downloads', () => {
    try {
      extractFetchedContent({ url: 'https://example.com/a', contentType: 'application/octet-stream', body: '' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'FETCH_UNSUPPORTED_CONTENT_TYPE', hint: undefined });
      return;
    }
    throw new Error('expected unsupported content type');
  });
});
