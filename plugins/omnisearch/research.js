/**
 * OmniSearch research — aggregate results about a topic across all public
 * platforms into one feed.
 *
 * No login. Combines Hacker News, Lobste.rs, Stack Overflow, Dev.to, GitHub
 * issues, and arXiv, tagging each row with its platform. Use for quick
 * universal reconnaissance on a topic, product, or problem.
 */
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import {
  hnSearch,
  lobstersSearch,
  stackoverflowSearch,
  devtoSearch,
  githubSearch,
  arxivSearch,
  redditSearch,
} from './sources.js';

function requireQuery(value) {
  const s = String(value ?? '').trim();
  if (!s) throw new ArgumentError('a research topic/query is required');
  return s;
}

cli({
  site: 'omnisearch',
  name: 'research',
  tags: ['search'],
  access: 'read',
  description: "Aggregate results about a topic across all public platforms (Hacker News, Lobsters, Stack Overflow, Dev.to, GitHub, arXiv, Reddit)",
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Topic, product, or problem to research' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum total results' },
    {
      name: 'sources',
      default: 'hn,lobsters,stackoverflow,devto,github,arxiv,reddit',
      help: 'Comma-separated sources to query (default: all)',
    },
  ],
  columns: ['platform', 'title', 'author', 'score', 'commentCount', 'createdAt', 'url', 'text'],
  func: async (kwargs) => {
    const query = requireQuery(kwargs.query);
    const raw = Number(kwargs.limit ?? 20);
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }
    const limit = Math.min(raw, 50);

    const wanted = String(kwargs.sources ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const fetchers = {
      hn: () => hnSearch(query, perPlatform),
      lobsters: () => lobstersSearch(query, perPlatform),
      stackoverflow: () => stackoverflowSearch(query, perPlatform),
      devto: () => devtoSearch(query, perPlatform),
      github: () => githubSearch(query, perPlatform),
      arxiv: () => arxivSearch(query, perPlatform),
      reddit: () => redditSearch(query, perPlatform),
    };

    const selected = wanted.length ? wanted.filter((s) => fetchers[s]) : Object.keys(fetchers);
    const perPlatform = Math.ceil(limit / Math.max(selected.length, 1));

    let rows;
    try {
      // Failure isolation: one rate-limited/erroring source must not wipe out the rest.
      const outcomes = await Promise.allSettled(selected.map((key) => fetchers[key]()));
      rows = outcomes
        .filter((o) => o.status === 'fulfilled')
        .flatMap((o) => o.value);
    } catch (err) {
      throw new CommandExecutionError(`research aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!rows.length) {
      throw new EmptyResultError('omnisearch/research', `no results found across platforms for "${query}"`);
    }

    return rows.slice(0, limit);
  },
});
