/**
 * OmniSearch arxiv — search arXiv research papers.
 * No login. Uses the public arXiv Atom API.
 */
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { arxivSearch } from './sources.js';

function requireQuery(value) {
  const s = String(value ?? '').trim();
  if (!s) throw new ArgumentError('a search query is required');
  return s;
}

cli({
  site: 'omnisearch',
  name: 'arxiv',
  tags: ['search'],
  access: 'read',
  description: "Search arXiv research papers (no login)",
  domain: 'export.arxiv.org',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Research topic' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['platform', 'title', 'author', 'score', 'commentCount', 'createdAt', 'url', 'text'],
  func: async (kwargs) => {
    const query = requireQuery(kwargs.query);
    const raw = Number(kwargs.limit ?? 20);
    if (!Number.isInteger(raw) || raw <= 0) throw new ArgumentError('limit must be a positive integer');
    const limit = Math.min(raw, 50);
    let rows;
    try {
      rows = await arxivSearch(query, limit);
    } catch (err) {
      throw new CommandExecutionError(err instanceof Error ? err.message : String(err));
    }
    if (!rows.length) throw new EmptyResultError('omnisearch/arxiv', `no results for "${query}"`);
    return rows;
  },
});
