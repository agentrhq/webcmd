import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const BASE_URL = 'https://www.bikewale.com';
const HEADERS = {
  'Accept': 'text/html,application/xhtml+xml',
  'User-Agent': 'Mozilla/5.0 (compatible; webcmd-bikewale/1.0)',
};

const SECTION_PATHS = {
  trending: ['featuredCarsWidget', 'trendingModels'],
  popular: ['featuredCarsWidget', 'popularModels'],
  electric: ['featuredCarsWidget', 'electricModels'],
  upcoming: ['featuredCarsWidget', 'upcomingModels'],
  offers: ['offerModels'],
  scooters: ['bestBikes', 'bestScooters'],
  mileage: ['bestBikes', 'bestMileageBikes'],
  sports: ['bestBikes', 'bestSportsBikes'],
  cruiser: ['bestBikes', 'bestCruiserBikes'],
};

function parseLimit(raw) {
  const limit = Number(raw ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ArgumentError('limit must be an integer from 1 to 50');
  }
  return limit;
}

function parseSection(raw) {
  const section = String(raw ?? 'trending').trim().toLowerCase();
  if (!Object.hasOwn(SECTION_PATHS, section)) {
    throw new ArgumentError(`section must be one of: ${Object.keys(SECTION_PATHS).join(', ')}`);
  }
  return section;
}

function extractInitialState(html) {
  const marker = 'window.__INITIAL_STATE__ = ';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new CommandExecutionError('BikeWale homepage did not include __INITIAL_STATE__');

  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) throw new CommandExecutionError('BikeWale homepage state did not start with JSON');

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
          throw new CommandExecutionError(`BikeWale homepage state was malformed JSON: ${error?.message || error}`);
        }
      }
    }
  }
  throw new CommandExecutionError('BikeWale homepage state JSON was not closed');
}

function getPath(obj, parts) {
  return parts.reduce((value, key) => value?.[key], obj);
}

function absoluteUrl(makeMaskingName, modelMaskingName) {
  if (!makeMaskingName || !modelMaskingName) return '';
  return new URL(`/${makeMaskingName}-bikes/${modelMaskingName}/`, BASE_URL).toString();
}

function specValue(model, pattern) {
  const specs = [...(model?.keySpecs || []), ...(model?.extraSpecs || [])];
  const spec = specs.find((item) => pattern.test(String(item?.title || '')));
  return String(spec?.keySpecsValue?.[0]?.text || '');
}

cli({
  site: 'bikewale',
  name: 'featured',
  description: 'List featured BikeWale bike sections from the public homepage.',
  access: 'read',
  example: 'webcmd bikewale featured --section trending --limit 10 -f yaml',
  domain: 'www.bikewale.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'section', type: 'string', default: 'trending', help: 'Section: trending, popular, electric, upcoming, offers, scooters, mileage, sports, cruiser' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of rows to return (1-50)' },
  ],
  columns: [
    'rank',
    'section',
    'title',
    'url',
    'price',
    'formattedPrice',
    'priceLabel',
    'makeName',
    'modelName',
    'modelId',
    'fuelType',
    'displacement',
  ],
  func: async (args) => {
    const section = parseSection(args.section);
    const limit = parseLimit(args.limit);

    let resp;
    try {
      resp = await fetch(BASE_URL, { headers: HEADERS });
    } catch (error) {
      throw new CommandExecutionError(`bikewale homepage request failed: ${error?.message || error}`);
    }
    if (!resp.ok) throw new CommandExecutionError(`bikewale homepage failed: HTTP ${resp.status}`);

    const html = await resp.text();
    const state = extractInitialState(html);
    const rows = getPath(state.homePage || {}, SECTION_PATHS[section]);
    if (!Array.isArray(rows)) throw new CommandExecutionError(`BikeWale section "${section}" was not found in homepage state`);
    if (rows.length === 0) throw new EmptyResultError('bikewale featured', `section "${section}" returned no rows`);

    return rows.slice(0, limit).map((model, index) => {
      const priceOverview = model?.priceOverview || {};
      const title = `${model?.makeName || ''} ${model?.modelName || ''}`.trim();
      return {
        rank: index + 1,
        section,
        title,
        url: absoluteUrl(model?.makeMaskingName, model?.modelMaskingName),
        price: Number(priceOverview.price || 0),
        formattedPrice: String(priceOverview.formattedPrice || ''),
        priceLabel: String(priceOverview.priceLabel || ''),
        makeName: String(model?.makeName || ''),
        modelName: String(model?.modelName || ''),
        modelId: Number(model?.modelId || 0),
        fuelType: specValue(model, /fuel/i),
        displacement: specValue(model, /displacement/i),
      };
    });
  },
});
