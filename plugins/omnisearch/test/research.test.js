import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import '../research.js';

afterEach(() => vi.unstubAllGlobals());

describe('omnisearch research', () => {
  it('honors the total limit when research is narrowed to one source', async () => {
    const hits = [
      { objectID: '1', title: 'One', author: 'a', points: 5, num_comments: 1, created_at: '2026-01-01T00:00:00Z', url: 'https://example.com/1' },
      { objectID: '2', title: 'Two', author: 'b', points: 4, num_comments: 2, created_at: '2026-01-02T00:00:00Z', url: 'https://example.com/2' },
      { objectID: '3', title: 'Three', author: 'c', points: 3, num_comments: 3, created_at: '2026-01-03T00:00:00Z', url: 'https://example.com/3' },
      { objectID: '4', title: 'Four', author: 'd', points: 2, num_comments: 4, created_at: '2026-01-04T00:00:00Z', url: 'https://example.com/4' },
      { objectID: '5', title: 'Five', author: 'e', points: 1, num_comments: 5, created_at: '2026-01-05T00:00:00Z', url: 'https://example.com/5' },
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
