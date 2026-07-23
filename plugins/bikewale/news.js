import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const BASE_URL = 'https://www.bikewale.com';
const HEADERS = {
  'Accept': 'text/html,application/xhtml+xml',
  'User-Agent': 'Mozilla/5.0 (compatible; webcmd-bikewale/1.0)',
};

function parseLimit(raw) {
  const limit = Number(raw ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ArgumentError('limit must be an integer from 1 to 50');
  }
  return limit;
}

function parsePage(raw) {
  const page = Number(raw ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000) {
    throw new ArgumentError('page must be a positive integer');
  }
  return page;
}

function newsUrl(page) {
  return new URL(page === 1 ? '/news/' : `/news/page/${page}/`, BASE_URL).toString();
}

function absoluteUrl(path) {
  if (!path) return '';
  try {
    return new URL(path, BASE_URL).toString();
  } catch {
    return '';
  }
}

function extractInitialState(html) {
  const marker = 'window.__INITIAL_STATE__ = ';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new CommandExecutionError('BikeWale news page did not include __INITIAL_STATE__');

  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) throw new CommandExecutionError('BikeWale news page state did not start with JSON');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch (error) {
          throw new CommandExecutionError(`BikeWale news page state was malformed JSON: ${error?.message || error}`);
        }
      }
    }
  }
  throw new CommandExecutionError('BikeWale news page state JSON was not closed');
}

cli({
  site: 'bikewale',
  name: 'news',
  description: 'Fetch latest BikeWale bike news from the public news listing.',
  access: 'read',
  example: 'webcmd bikewale news --limit 10 -f yaml',
  domain: 'www.bikewale.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of news articles to return (1-50)' },
    { name: 'page', type: 'int', default: 1, help: 'News listing page number' },
  ],
  columns: [
    'rank',
    'title',
    'url',
    'author',
    'publishedAgo',
    'category',
    'views',
    'id',
    'imageUrl',
  ],
  func: async (args) => {
    const limit = parseLimit(args.limit);
    const page = parsePage(args.page);
    const url = newsUrl(page);

    let resp;
    try {
      resp = await fetch(url, { headers: HEADERS });
    } catch (error) {
      throw new CommandExecutionError(`bikewale news request failed: ${error?.message || error}`);
    }
    if (!resp.ok) throw new CommandExecutionError(`bikewale news failed: HTTP ${resp.status}`);

    const html = await resp.text();
    const state = extractInitialState(html);
    const rows = state.editorialListing?.contentData;
    if (!Array.isArray(rows)) throw new CommandExecutionError('BikeWale news state did not include editorialListing.contentData');
    if (rows.length === 0) throw new EmptyResultError('bikewale news', `page ${page} returned no articles`);

    return rows.slice(0, limit).map((article, index) => ({
      rank: index + 1,
      title: String(article?.title || '').trim(),
      url: absoluteUrl(article?.url),
      author: String(article?.authorName || ''),
      publishedAgo: String(article?.displayDate || ''),
      category: String(article?.categoryMaskingName || ''),
      views: Number(article?.views || 0),
      id: Number(article?.basicId || 0),
      imageUrl: absoluteUrl(article?.imagePath),
    }));
  },
});
