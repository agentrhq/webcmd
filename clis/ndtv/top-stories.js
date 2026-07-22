// ndtv top-stories — public RSS feed, no browser or account required.
//
// Strategy: PUBLIC_API
// Contract: stable public RSS exposed by FeedBurner for NDTV top stories.
// Evidence: https://feeds.feedburner.com/ndtvnews-top-stories returns HTTP 200
// with current NDTV article titles, dates, descriptions, and canonical links.
// Why not simpler: ndtv.com homepage anonymous fetch returns HTTP 403 in this
// environment, while the official public RSS replay is anonymous and read-only.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { ndtvFetchTopStoriesRss, parseNdtvTopStoriesRss, requireNdtvLimit } from './utils.js';

cli({
  site: 'ndtv',
  name: 'top-stories',
  access: 'read',
  description: 'NDTV top stories from the public RSS feed',
  domain: 'www.ndtv.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 5, help: 'Number of top stories to return (1-50, default 5)' },
  ],
  columns: ['rank', 'title', 'description', 'pubDate', 'id', 'url'],
  defaultFormat: 'table',
  func: async (args) => {
    const limit = requireNdtvLimit(args.limit, 5, 50);
    const xml = await ndtvFetchTopStoriesRss();
    const items = parseNdtvTopStoriesRss(xml);
    if (!items.length) {
      throw new EmptyResultError('ndtv top-stories', 'NDTV top stories feed returned no items.');
    }
    return items.slice(0, limit).map((item, i) => ({ rank: i + 1, ...item }));
  },
});
