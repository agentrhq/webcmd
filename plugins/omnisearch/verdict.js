/**
 * OmniSearch verdict — synthesize what the community thinks about a topic.
 *
 * Runs the multi-source research sweep, then returns an opinionated summary:
 * per-platform top results + the single highest-traction item + which platforms
 * are most engaged. This is "signal, not search" — a verdict, not a link dump.
 */
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { hnSearch, lobstersSearch, stackoverflowSearch, githubSearch, arxivSearch, devtoSearch } from './sources.js';

function requireQuery(value) {
  const s = String(value ?? '').trim();
  if (!s) throw new ArgumentError('a topic is required');
  return s;
}

cli({
  site: 'omnisearch',
  name: 'verdict',
  tags: ['search'],
  access: 'read',
  description: "Synthesize the community's verdict on a topic across all public platforms (signal, not search)",
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'topic', required: true, positional: true, help: 'Topic to synthesize' },
    { name: 'perSource', type: 'int', default: 3, help: 'Top results per source to consider' },
  ],
  columns: ['verdict', 'topResult', 'topSource', 'topScore', 'platforms', 'totalResults'],
  func: async (kwargs) => {
    const topic = requireQuery(kwargs.topic);
    const raw = Number(kwargs.perSource ?? 3);
    if (!Number.isInteger(raw) || raw <= 0) throw new ArgumentError('perSource must be a positive integer');
    const perSource = Math.min(raw, 10);

    const fetchers = [
      () => hnSearch(topic, perSource),
      () => stackoverflowSearch(topic, perSource),
      () => githubSearch(topic, perSource),
      () => arxivSearch(topic, perSource),
      () => devtoSearch(topic, perSource),
      () => lobstersSearch(topic, perSource),
    ];

    let results;
    try {
      const outcomes = await Promise.allSettled(fetchers.map((f) => f()));
      results = outcomes.filter((o) => o.status === 'fulfilled').map((o) => o.value);
    } catch (err) {
      throw new CommandExecutionError(`verdict failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const all = results.flat();
    if (!all.length) {
      throw new EmptyResultError('omnisearch/verdict', `no results for "${topic}"`);
    }

    // Highest-traction single result across all sources (by score, fallback commentCount)
    const top = all.reduce((a, b) => {
      const as = (a.score ?? 0) + (a.commentCount ?? 0);
      const bs = (b.score ?? 0) + (b.commentCount ?? 0);
      return bs > as ? b : a;
    });

    const platformCounts = {};
    for (const r of all) platformCounts[r.platform] = (platformCounts[r.platform] ?? 0) + 1;
    const platforms = Object.entries(platformCounts).map(([p, n]) => `${p}(${n})`).join(', ');

    return [{
      verdict: `Community signal on "${topic}": strongest result is "${top.title.slice(0, 100)}" on ${top.platform} (score ${top.score}, ${top.commentCount} comments).`,
      topResult: top.title,
      topSource: top.platform,
      topScore: (top.score ?? 0) + (top.commentCount ?? 0),
      platforms,
      totalResults: all.length,
    }];
  },
});
