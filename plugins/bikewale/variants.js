import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const BASE_URL = 'https://www.bikewale.com';
const AUTOCOMPLETE_SOURCES = '1,2,3,5,11,15,13,14,10,16,17,4,8,9,6,19,20,21,24,7,34';
const HTML_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml',
  'User-Agent': 'Mozilla/5.0 (compatible; webcmd-bikewale/1.0)',
};
const JSON_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; webcmd-bikewale/1.0)',
};

function requiredModel(args) {
  const model = String(args.model ?? '').trim();
  if (!model) throw new ArgumentError('model is required');
  return model;
}

function parseLimit(raw) {
  const limit = Number(raw ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ArgumentError('limit must be an integer from 1 to 100');
  }
  return limit;
}

function extractInitialState(html) {
  const marker = 'window.__INITIAL_STATE__ = ';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new CommandExecutionError('BikeWale model page did not include __INITIAL_STATE__');

  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) throw new CommandExecutionError('BikeWale model state did not start with JSON');

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
          throw new CommandExecutionError(`BikeWale model state was malformed JSON: ${error?.message || error}`);
        }
      }
    }
  }
  throw new CommandExecutionError('BikeWale model state JSON was not closed');
}

function absoluteUrl(path) {
  try {
    return new URL(path, BASE_URL).toString();
  } catch {
    return '';
  }
}

async function modelUrlFromSearch(query) {
  const url = new URL('/api/v4/autocomplete/', BASE_URL);
  url.searchParams.set('source', AUTOCOMPLETE_SOURCES);
  url.searchParams.set('value', query);
  url.searchParams.set('size', '10');
  url.searchParams.set('applicationId', '2');
  url.searchParams.set('showNoResult', 'true');
  url.searchParams.set('cityId', '-1');

  let resp;
  try {
    resp = await fetch(url, { headers: JSON_HEADERS });
  } catch (error) {
    throw new CommandExecutionError(`bikewale model lookup failed: ${error?.message || error}`);
  }
  if (!resp.ok) throw new CommandExecutionError(`bikewale model lookup failed: HTTP ${resp.status}`);

  let data;
  try {
    data = await resp.json();
  } catch (error) {
    throw new CommandExecutionError(`bikewale model lookup returned malformed JSON: ${error?.message || error}`);
  }
  if (!Array.isArray(data)) throw new CommandExecutionError('bikewale model lookup returned an unexpected response shape');

  const modelSuggestion = data.find((item) => item?.payload?.url && item?.payload?.modelName && item?.suggestionType === 2)
    || data.find((item) => item?.payload?.url && item?.payload?.modelName);
  if (!modelSuggestion) throw new EmptyResultError('bikewale variants', `no model result for "${query}"`);
  return absoluteUrl(modelSuggestion.payload.url);
}

async function resolveModelUrl(input) {
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith('/')) return absoluteUrl(input);
  if (input.includes('-bikes/')) return absoluteUrl(`/${input.replace(/^\/+/, '')}`);
  if (/^[a-z0-9-]+\/[a-z0-9-]+$/i.test(input)) {
    const [makeSlug, modelSlug] = input.split('/');
    return absoluteUrl(`/${makeSlug}-bikes/${modelSlug}/`);
  }
  return modelUrlFromSearch(input);
}

function specValue(version, names) {
  const wanted = names.map((name) => name.toLowerCase());
  const specs = [...(version?.specsSummary || []), ...(version?.basicSpecs || []), ...(version?.differentSpecs || [])];
  const spec = specs.find((item) => wanted.includes(String(item?.itemName || '').toLowerCase()));
  if (!spec) return '';
  const value = String(spec.formattedValue || spec.value || '').trim();
  const unit = String(spec.unitType || '').trim();
  return value && unit && !value.toLowerCase().includes(unit.toLowerCase()) ? `${value} ${unit}` : value;
}

cli({
  site: 'bikewale',
  name: 'variants',
  description: 'List variants and prices for a BikeWale model page or search query.',
  access: 'read',
  example: 'webcmd bikewale variants "classic 350" -f yaml',
  domain: 'www.bikewale.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'model', positional: true, required: true, help: 'Model query, URL, path, or make/model slug' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of variants to return (1-100)' },
  ],
  columns: [
    'rank',
    'modelName',
    'variantName',
    'versionId',
    'url',
    'price',
    'formattedPrice',
    'priceLabel',
    'brakingSystem',
    'frontBrakeType',
    'rearBrakeType',
    'wheelType',
  ],
  func: async (args) => {
    const model = requiredModel(args);
    const limit = parseLimit(args.limit);
    const modelUrl = await resolveModelUrl(model);

    let resp;
    try {
      resp = await fetch(modelUrl, { headers: HTML_HEADERS });
    } catch (error) {
      throw new CommandExecutionError(`bikewale model page request failed: ${error?.message || error}`);
    }
    if (!resp.ok) throw new CommandExecutionError(`bikewale model page failed: HTTP ${resp.status}`);

    const html = await resp.text();
    const state = extractInitialState(html);
    const modelPage = state.modelPage || {};
    const versions = modelPage.versions;
    if (!Array.isArray(versions)) throw new CommandExecutionError('BikeWale model page did not include a variants list');
    if (versions.length === 0) throw new EmptyResultError('bikewale variants', `no variants found for "${model}"`);

    const pageModelName = `${modelPage.modelDetails?.makeName || ''} ${modelPage.modelDetails?.modelName || ''}`.trim();
    return versions.slice(0, limit).map((version, index) => {
      const priceOverview = version?.priceOverview || {};
      return {
        rank: index + 1,
        modelName: pageModelName || `${version?.makeName || ''} ${version?.modelName || ''}`.trim(),
        variantName: String(version?.versionName || ''),
        versionId: Number(version?.versionId || 0),
        url: modelUrl,
        price: Number(priceOverview.price || 0),
        formattedPrice: String(priceOverview.formattedPrice || ''),
        priceLabel: String(priceOverview.priceLabel || ''),
        brakingSystem: specValue(version, ['Braking System']),
        frontBrakeType: specValue(version, ['Front Brake Type']),
        rearBrakeType: specValue(version, ['Rear Brake Type']),
        wheelType: specValue(version, ['Wheel Type']),
      };
    });
  },
});
