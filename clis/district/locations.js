import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const BASE = 'https://www.district.in';
const GUEST_TOKEN = '1212';

function validateQuery(raw) {
  const query = String(raw || '').trim();
  if (!query) throw new ArgumentError('query is required');
  if (query.length > 120) throw new ArgumentError('query must be 120 characters or fewer');
  return query;
}

function validateLimit(raw) {
  const limit = Number(raw ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ArgumentError('limit must be an integer from 1 to 50');
  }
  return limit;
}

function headersFor() {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Content-Type': 'application/json',
    Origin: BASE,
    Referer: `${BASE}/`,
    'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36',
    'x-guest-token': GUEST_TOKEN,
    'x-app-type': 'ed_web',
    'x-client-id': 'district-web',
    'x-app-version': '11.11.1',
    'x-device-id': crypto.randomUUID(),
  };
}

async function fetchLocationSearch(body) {
  const resp = await fetch(`${BASE}/gw/web/get_location_search`, {
    method: 'POST',
    headers: headersFor(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new CommandExecutionError(`district locations request failed: HTTP ${resp.status}`);

  const data = await resp.json();
  if (data?.status?.status === 'STATUS_FAILURE') {
    throw new CommandExecutionError(data.status.message || 'district locations request failed');
  }
  return data;
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distanceKm(aLat, aLng, bLat, bLng) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function kindFor(entity) {
  const type = String(entity.entity_type || '');
  if (type.includes('CITY')) return 'city';
  if (type.includes('GOOGLE_PLACE')) return 'google_place';
  if (type.includes('POI')) return String(entity.poi_type || 'poi').trim().toLowerCase() || 'poi';
  return 'location';
}

function cityRecordFor(entity, cities) {
  const entityName = normalize(entity.title || entity.fullname);
  const entityState = normalize(String(entity.subtitle || '').split(',').at(-1));

  const exact = cities.find((city) => {
    const names = [
      city.city_name,
      city.cleaned_city_name,
      city.city_key,
    ].map(normalize);
    return names.includes(entityName)
      || (normalize(city.city_name) === entityName && (!entityState || normalize(city.state_name) === entityState));
  });
  if (exact) return exact;

  const lat = Number(entity.lat);
  const lng = Number(entity.long);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let nearest = null;
  for (const city of cities) {
    const cityLat = Number(city.city_lat);
    const cityLng = Number(city.city_long);
    if (!Number.isFinite(cityLat) || !Number.isFinite(cityLng)) continue;
    const km = distanceKm(lat, lng, cityLat, cityLng);
    if (!nearest || km < nearest.km) nearest = { city, km };
  }
  return nearest && nearest.km <= 80 ? nearest.city : null;
}

function scoreFor(entity, query, index) {
  const q = normalize(query);
  const title = normalize(entity.title);
  const full = normalize(`${entity.title} ${entity.subtitle} ${entity.fullname}`);
  let score = 1000 - index;
  if (title === q) score += 5000;
  else if (title.startsWith(q)) score += 3000;
  else if (full.includes(q)) score += 1000;
  if (kindFor(entity) === 'city') score += 600;
  return score;
}

function rowFor(entity, index, query, cities, primaryCity) {
  const city = cityRecordFor(entity, cities) || {};
  const kind = kindFor(entity);
  const placeId = String(entity.google_place_id || entity.poi_id || '');
  const dist = Number(entity.distance);
  const samePrimaryCity = primaryCity?.city_id && city.city_id === primaryCity.city_id;
  return {
    score: scoreFor(entity, query, index) + (samePrimaryCity ? 450 : 0),
    row: {
      rank: index + 1,
      name: String(entity.title || entity.fullname || '').trim(),
      kind,
      city: String(city.city_name || (kind === 'city' ? entity.title : '') || '').trim(),
      state: String(city.state_name || '').trim(),
      cityKey: String(city.city_key || '').trim(),
      cityId: String(city.city_id || '').trim(),
      placeId,
      lat: Number(entity.lat || 0),
      lng: Number(entity.long || 0),
      distanceKm: Number.isFinite(dist) ? Number((dist / 1000).toFixed(1)) : 0,
      source: 'district_location_search',
    },
  };
}

cli({
  site: 'district',
  name: 'locations',
  aliases: ['location-search'],
  access: 'read',
  description: 'Search District-supported cities, areas, malls, and places for booking filters',
  domain: 'www.district.in',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'query',
      positional: true,
      required: true,
      help: 'City, area, mall, or locality, for example "bangalore" or "indiranagar"',
    },
    {
      name: 'limit',
      type: 'int',
      default: 10,
      help: 'Maximum location rows to return (1-50)',
    },
  ],
  columns: [
    'rank',
    'name',
    'kind',
    'city',
    'state',
    'cityKey',
    'cityId',
    'placeId',
    'lat',
    'lng',
    'distanceKm',
    'source',
  ],
  func: async (args) => {
    const query = validateQuery(args.query);
    const limit = validateLimit(args.limit);
    const [searchData, allData] = await Promise.all([
      fetchLocationSearch({ searched_text: query }),
      fetchLocationSearch({}),
    ]);

    const cities = Array.isArray(allData?.cities) ? allData.cities : [];
    const entities = Array.isArray(searchData?.entities) ? searchData.entities : [];
    if (!entities.length) throw new EmptyResultError('district locations', `No locations found for "${query}"`);

    const queryNorm = normalize(query);
    const primaryCity = entities
      .filter((entity) => kindFor(entity) === 'city')
      .map((entity) => cityRecordFor(entity, cities))
      .find((city) => city && [city.city_name, city.cleaned_city_name, city.city_key].map(normalize).includes(queryNorm));

    return entities
      .map((entity, index) => rowFor(entity, index, query, cities, primaryCity))
      .filter((item) => item.row.name && Number.isFinite(item.row.lat) && Number.isFinite(item.row.lng))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item, index) => ({ ...item.row, rank: index + 1 }));
  },
});
