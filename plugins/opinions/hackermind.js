/**
 * opinions hackermind — search Hacker News stories & comments for opinions.
 *
 * No login. Uses the public HN Algolia API, which indexes stories and
 * comments. Good for researching what the tech/startup community is saying
 * about a topic, product, or problem.
 */
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const API = 'https://hn.algolia.com/api/v1/search';

function requireQuery(value) {
  const s = String(value ?? '').trim();
  if (!s) throw new ArgumentError('a search query is required');
  return s;
}

cli({
  site: 'opinions',
  name: 'hackermind',
  tags: ['search'],
  access: 'read',
  description: "Search Hacker News stories & comments for opinions (no login)",
  domain: 'hn.algolia.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Topic, product, or problem to research' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    {
      name: 'scope',
      default: 'story',
      help: 'What to search: story (headlines) or comment (reply text)',
      choices: ['story', 'comment'],
    },
  ],
  columns: ['rank', 'id', 'object_type', 'title', 'author', 'points', 'comments', 'created_at', 'url'],
  func: async (kwargs) => {
    const query = requireQuery(kwargs.query);
    const raw = Number(kwargs.limit ?? 20);
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }
    const limit = Math.min(raw, 100);
    const scope = String(kwargs.scope ?? 'story');

    const url = new URL(API);
    url.searchParams.set('query', query);
    url.searchParams.set('tags', scope === 'comment' ? 'comment' : 'story');
    url.searchParams.set('hitsPerPage', String(limit));

    let json;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new CommandExecutionError(`HN Algolia request failed: HTTP ${res.status}`);
      json = await res.json();
    } catch (err) {
      if (err instanceof CommandExecutionError) throw err;
      throw new CommandExecutionError(`HN Algolia request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const hits = Array.isArray(json?.hits) ? json.hits : [];
    if (!hits.length) {
      throw new EmptyResultError('opinions/hackermind', `no results for "${query}"`);
    }

    return hits.slice(0, limit).map((h, index) => ({
      rank: index + 1,
      id: h.objectID,
      object_type: scope,
      title: String(h.title ?? h.story_title ?? h.comment_text ?? '').replace(/<[^>]+>/g, '').trim(),
      author: String(h.author ?? ''),
      points: h.points ?? 0,
      comments: h.num_comments ?? 0,
      created_at: String(h.created_at ?? ''),
      url: String(h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`),
    }));
  },
});