/**
 * omnisearch lobsters — Lobste.rs newest / active discussions.
 *
 * No login. Uses the public lobste.rs JSON endpoint. Lobste.rs is a
 * Reddit/HN-style community; good for surfacing what developers are
 * discussing about a topic right now.
 */
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const SORTS = {
  newest: 'https://lobste.rs/newest.json',
  active: 'https://lobste.rs/active.json',
  hot: 'https://lobste.rs/hottest.json',
};

function requireSort(value) {
  const s = String(value ?? 'newest').toLowerCase();
  if (s === 'new') s = 'newest';
  if (!SORTS[s]) throw new ArgumentError(`sort must be one of: ${Object.keys(SORTS).join(', ')}`);
  return s;
}

cli({
  site: 'omnisearch',
  name: 'lobsters',
  access: 'read',
  description: "Lobste.rs newest / active / hot discussions (no login)",
  domain: 'lobste.rs',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of stories' },
    { name: 'sort', default: 'newest', help: 'Sort order: newest, active, hot', choices: ['newest', 'active', 'hot'] },
  ],
  columns: ['rank', 'id', 'title', 'author', 'score', 'commentCount', 'createdAt', 'tags', 'url'],
  func: async (kwargs) => {
    const sort = requireSort(kwargs.sort);
    const raw = Number(kwargs.limit ?? 20);
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }
    const limit = Math.min(raw, 100);

    let rows;
    try {
      const res = await fetch(SORTS[sort], {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; webcmd-omnisearch/0.1)' },
      });
      if (!res.ok) throw new CommandExecutionError(`lobste.rs request failed: HTTP ${res.status}`);
      rows = await res.json();
    } catch (err) {
      if (err instanceof CommandExecutionError) throw err;
      throw new CommandExecutionError(`lobste.rs request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!Array.isArray(rows) || !rows.length) {
      throw new EmptyResultError('omnisearch/lobsters', 'lobste.rs returned no stories');
    }

    return rows.slice(0, limit).map((s, index) => ({
      rank: index + 1,
      id: s.short_id,
      title: String(s.title ?? '').trim(),
      author: String(s.submitter_user ?? ''),
      score: s.score ?? 0,
      commentCount: s.comment_count ?? 0,
      createdAt: String(s.created_at ?? ''),
      tags: Array.isArray(s.tags) ? s.tags.join(', ') : '',
      url: String(s.comments_url ?? s.short_id_url ?? ''),
    }));
  },
});