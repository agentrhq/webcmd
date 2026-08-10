/**
 * opinions research — aggregate opinions about a topic across no-login
 * public platforms (Hacker News + Lobste.rs) into one feed.
 *
 * No login. Combines HN Algolia stories and Lobste.rs newest stories filtered
 * by keyword, tagging each row with its platform. Use for quick opinion /
 * problem reconnaissance on a topic, product, or persona.
 */
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const HN_SEARCH = 'https://hn.algolia.com/api/v1/search';
const LOBSTERS = 'https://lobste.rs/newest.json';

function requireQuery(value) {
  const s = String(value ?? '').trim();
  if (!s) throw new ArgumentError('a research topic/query is required');
  return s;
}

async function hnSearch(query, limit) {
  const url = new URL(HN_SEARCH);
  url.searchParams.set('query', query);
  url.searchParams.set('tags', 'story');
  url.searchParams.set('hitsPerPage', String(limit));
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return (Array.isArray(json?.hits) ? json.hits : []).slice(0, limit).map((h) => ({
    platform: 'hackernews',
    title: String(h.title ?? h.story_title ?? '').trim(),
    author: String(h.author ?? ''),
    score: h.points ?? 0,
    comments: h.num_comments ?? 0,
    created_at: String(h.created_at ?? ''),
    url: String(h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`),
    text: '',
  }));
}

async function lobstersSearch(query, limit) {
  const res = await fetch(LOBSTERS, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; webcmd-opinions/0.1)' },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  const q = query.toLowerCase();
  return rows
    .filter((s) =>
      String(s.title ?? '').toLowerCase().includes(q) ||
      String(s.description_plain ?? '').toLowerCase().includes(q) ||
      (Array.isArray(s.tags) && s.tags.some((t) => t.toLowerCase().includes(q))),
    )
    .slice(0, limit)
    .map((s) => ({
      platform: 'lobsters',
      title: String(s.title ?? '').trim(),
      author: String(s.submitter_user ?? ''),
      score: s.score ?? 0,
      comments: s.comment_count ?? 0,
      created_at: String(s.created_at ?? ''),
      url: String(s.comments_url ?? ''),
      text: String(s.description_plain ?? ''),
    }));
}

cli({
  site: 'opinions',
  name: 'research',
  tags: ['search'],
  access: 'read',
  description: "Aggregate opinions/problems about a topic across no-login platforms (Hacker News + Lobste.rs)",
  domain: 'hn.algolia.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Topic, product, or problem to research' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results per platform' },
  ],
  columns: ['platform', 'title', 'author', 'score', 'comments', 'created_at', 'url', 'text'],
  func: async (kwargs) => {
    const query = requireQuery(kwargs.query);
    const raw = Number(kwargs.limit ?? 20);
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }
    const limit = Math.min(raw, 50);
    const perPlatform = Math.ceil(limit / 2);

    let rows;
    try {
      const [hn, lob] = await Promise.all([hnSearch(query, perPlatform), lobstersSearch(query, perPlatform)]);
      rows = [...hn, ...lob];
    } catch (err) {
      throw new CommandExecutionError(`research aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!rows.length) {
      throw new EmptyResultError('opinions/research', `no opinions found across platforms for "${query}"`);
    }

    return rows.slice(0, limit);
  },
});