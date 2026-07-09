import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const BASE = 'https://www.district.in';
const GUEST_TOKEN = '1212';
const DEFAULT_LOCATION = {
  cityId: 1,
  pCityId: '57',
  long: 77.1165992,
  lat: 28.4080424,
  pCityKey: 'gurgaon',
  pStateKey: 'haryana',
  countryId: '1',
  placeType: 'GOOGLE_PLACE',
  placeId: 'ChIJQ3GqXwAZDTkR2IGBwuLDcCk',
  subzoneId: '645',
  cityName: 'Delhi NCR',
  pCityName: 'Gurugram',
};
const TAB_MAP = new Map([
  ['all', 'all'],
  ['dining', 'dining'],
  ['events', 'events'],
  ['movies', 'movies'],
  ['stores', 'shopping'],
  ['shopping', 'shopping'],
  ['activities', 'attraction'],
  ['attraction', 'attraction'],
  ['play', 'play'],
]);

function validateQuery(raw) {
  const query = String(raw || '').trim();
  if (!query) throw new ArgumentError('query is required');
  if (query.length > 120) throw new ArgumentError('query must be 120 characters or fewer');
  return query;
}

function validateLimit(raw) {
  const limit = Number(raw ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ArgumentError('limit must be an integer from 1 to 100');
  }
  return limit;
}

function validateTab(raw) {
  const value = String(raw || 'all').trim().toLowerCase();
  const tab = TAB_MAP.get(value);
  if (!tab) {
    throw new ArgumentError('tab must be one of all, dining, events, movies, stores, activities, or play');
  }
  return tab;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .replace(/[\W_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function absoluteUrl(path) {
  if (!path) return '';
  try {
    return new URL(path, BASE).toString();
  } catch {
    return '';
  }
}

function categoryFor(item) {
  const display = String(item.domain_title || item.display_subtitle || '').trim();
  if (display) return display.toLowerCase();
  return String(item.entity_type || '')
    .replace(/^EntityType/i, '')
    .replace(/^Res$/i, 'restaurant')
    .toLowerCase() || 'result';
}

function urlFor(item) {
  const meta = item.metadata || {};
  const type = String(item.entity_type || '');
  if (meta.web_deeplink) return absoluteUrl(meta.web_deeplink);
  if (type === 'EntityTypeMovie') return absoluteUrl(`/movies/${slugify(item.display_title)}-movie-tickets-MV${item.id}`);
  if (type === 'EntityTypeEvent') return absoluteUrl(`/events/${meta.slug || slugify(item.display_title)}-buy-tickets`);
  if (type === 'EntityTypeArtist') return absoluteUrl(`/events/${meta.slug || slugify(item.display_title)}/artist`);
  if (type === 'EntityTypeRes') return absoluteUrl(`/dining${meta.seo_url || ''}`);
  if (type === 'EntityTypeStore') return absoluteUrl(`/stores/${meta.slug || ''}`);
  return '';
}

function locationHeaders() {
  const loc = DEFAULT_LOCATION;
  return {
    'x-city-id': String(loc.cityId),
    'x-pcity-id': String(loc.pCityId),
    'x-user-lng': String(loc.long),
    'x-user-lat': String(loc.lat),
    'x-pcity-key': loc.pCityKey,
    'x-pstate-key': loc.pStateKey,
    'x-country-id': loc.countryId,
    'x-place-type': loc.placeType,
    'x-place-id': loc.placeId,
    'x-gps-lat': String(loc.lat),
    'x-gps-lng': String(loc.long),
    'x-subzone-id': loc.subzoneId,
    'x-available-tabs': 'movies,events,dining,attr_home,attraction,play,shopping,ipl',
    'x-city-name': loc.cityName,
    'x-pcity-name': loc.pCityName,
  };
}

function headersFor(tab) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Content-Type': 'application/json',
    Origin: BASE,
    Referer: `${BASE}/search`,
    'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36',
    'x-guest-token': GUEST_TOKEN,
    'x-app-type': 'ed_web',
    'x-client-id': 'district-web',
    'x-app-version': '11.11.1',
    'x-device-id': crypto.randomUUID(),
    'x-is-granular-loc': 'false',
    'x-is-events-supported': 'true',
    'x-is-movies-supported': 'true',
    'x-is-dining-supported': 'true',
    'x-gps-permission-given': '0',
    'x-available-tabs': tab === 'all' ? 'movies,events,dining' : tab,
    ...locationHeaders(),
  };
}

function rowFor(item, index) {
  const meta = item.metadata || {};
  const url = urlFor(item);
  return {
    rank: index + 1,
    title: String(item.display_title || '').trim(),
    category: categoryFor(item),
    date: String(meta.date_string_v2 || '').trim(),
    venue: String(meta.venue_name || meta.address || meta.poi_display_title || '').trim(),
    price: String(meta.price_string_v2 || meta.offer || meta.instore_offer_text || '').trim(),
    url,
  };
}

cli({
  site: 'district',
  name: 'search',
  aliases: ['s'],
  access: 'read',
  description: 'Search District by Zomato across movies, events, dining, stores, activities, and play',
  domain: 'www.district.in',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'query',
      positional: true,
      required: true,
      help: 'Search query, for example "hamlet" or "arijit"',
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      help: 'Maximum rows to return (1-100)',
    },
    {
      name: 'tab',
      default: 'all',
      help: 'Search tab: all, dining, events, movies, stores, activities, or play',
    },
  ],
  columns: ['rank', 'title', 'category', 'date', 'venue', 'price', 'url'],
  func: async (args) => {
    const query = validateQuery(args.query);
    const limit = validateLimit(args.limit);
    const tab = validateTab(args.tab);
    const body = {
      get_search_results_request_type: 1,
      post_body: { hp_selected_tab_id: tab === 'attraction' ? 'attractions_home' : 'home_v2' },
      search_id: crypto.randomUUID(),
      keyword: query,
      tab_id: tab,
    };

    const resp = await fetch(`${BASE}/gw/web/search`, {
      method: 'POST',
      headers: headersFor(tab),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new CommandExecutionError(`district search request failed: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    if (data?.status?.status === 'STATUS_FAILURE') {
      throw new CommandExecutionError(data.status.message || 'district search request failed');
    }

    const items = Array.isArray(data?.results) ? data.results : [];
    if (!items.length) {
      throw new EmptyResultError('district search', `No results found for "${query}"`);
    }

    return items
      .map(rowFor)
      .filter((row) => row.title && row.url)
      .slice(0, limit);
  },
});
