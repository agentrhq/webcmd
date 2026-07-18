import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const BASE_URL = 'https://www.bikewale.com';
const AUTOCOMPLETE_SOURCES = '1,2,3,5,11,15,13,14,10,16,17,4,8,9,6,19,20,21,24,7,34';
const HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; webcmd-bikewale/1.0)',
};

function requiredQuery(args) {
  const query = String(args.query ?? '').trim();
  if (!query) throw new ArgumentError('query is required');
  return query;
}

function parseLimit(raw) {
  const limit = Number(raw ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ArgumentError('limit must be an integer from 1 to 50');
  }
  return limit;
}

function absoluteUrl(path) {
  if (!path) return '';
  try {
    return new URL(path, BASE_URL).toString();
  } catch {
    return '';
  }
}

cli({
  site: 'bikewale',
  name: 'search',
  description: 'Search BikeWale for bikes, scooters, comparisons, prices, media, and related pages.',
  access: 'read',
  example: 'webcmd bikewale search "classic 350" -f yaml',
  domain: 'www.bikewale.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of suggestions to return (1-50)' },
  ],
  columns: [
    'rank',
    'title',
    'url',
    'suggestionType',
    'makeName',
    'modelName',
    'modelId',
    'versionId',
    'fuel',
    'budget',
    'segmentType',
  ],
  func: async (args) => {
    const query = requiredQuery(args);
    const limit = parseLimit(args.limit);

    const url = new URL('/api/v4/autocomplete/', BASE_URL);
    url.searchParams.set('source', AUTOCOMPLETE_SOURCES);
    url.searchParams.set('value', query);
    url.searchParams.set('size', String(limit));
    url.searchParams.set('applicationId', '2');
    url.searchParams.set('showNoResult', 'true');
    url.searchParams.set('cityId', '-1');

    let resp;
    try {
      resp = await fetch(url, { headers: HEADERS });
    } catch (error) {
      throw new CommandExecutionError(`bikewale search request failed: ${error?.message || error}`);
    }
    if (!resp.ok) throw new CommandExecutionError(`bikewale search failed: HTTP ${resp.status}`);

    let data;
    try {
      data = await resp.json();
    } catch (error) {
      throw new CommandExecutionError(`bikewale search returned malformed JSON: ${error?.message || error}`);
    }
    if (!Array.isArray(data)) throw new CommandExecutionError('bikewale search returned an unexpected response shape');
    if (data.length === 0) throw new EmptyResultError('bikewale search', `no results for "${query}"`);

    return data.slice(0, limit).map((item, index) => {
      const payload = item?.payload || {};
      return {
        rank: index + 1,
        title: String(item?.displayName || payload.modelName || '').trim(),
        url: absoluteUrl(payload.url),
        suggestionType: Number(item?.suggestionType ?? 0),
        makeName: String(payload.makeName || ''),
        modelName: String(payload.modelName || ''),
        modelId: Number(payload.modelId || 0),
        versionId: Number(payload.versionId || 0),
        fuel: String(payload.fuel || ''),
        budget: String(payload.budget || ''),
        segmentType: String(payload.segmentType || ''),
      };
    });
  },
});
