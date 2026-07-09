import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import {
  BASE,
  DEFAULT_LOCATION,
  browserLocation,
  districtHeaders,
  fetchMovieSessions,
} from './_lib.js';

function validateText(raw, name, max = 160) {
  const value = String(raw || '').trim();
  if (!value) throw new ArgumentError(`${name} is required`);
  if (value.length > max) throw new ArgumentError(`${name} must be ${max} characters or fewer`);
  return value;
}

function validateOptionalText(raw, name, max = 120) {
  if (raw == null || raw === '') return '';
  return validateText(raw, name, max);
}

function validateLimit(raw) {
  const limit = Number(raw ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ArgumentError('limit must be an integer from 1 to 200');
  }
  return limit;
}

function validateMoney(raw, name) {
  if (raw == null || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new ArgumentError(`${name} must be a positive number`);
  return value;
}

function validateCityKey(raw) {
  if (raw == null || raw === '') return '';
  const cityKey = String(raw).trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(cityKey)) {
    throw new ArgumentError('city-key must contain only lowercase letters, numbers, and hyphens');
  }
  return cityKey;
}

function validateDate(raw) {
  if (raw == null || raw === '') return '';
  const date = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ArgumentError('date must be in YYYY-MM-DD format');
  return date;
}

function validateClock(raw, name) {
  if (raw == null || raw === '') return null;
  const value = String(raw).trim();
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new ArgumentError(`${name} must be in HH:MM 24-hour format`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stateKey(value) {
  return normalize(value).replace(/\s+/g, '-');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .replace(/[\W_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function extractContentId(value) {
  const match = String(value || '').match(/(?:MV)?(\d{4,})/i);
  return match ? match[1] : '';
}

function isDistrictMovieUrl(value) {
  try {
    const url = new URL(value, BASE);
    return url.hostname.endsWith('district.in') && /\/movies\/.+MV\d+/i.test(url.pathname);
  } catch {
    return false;
  }
}

function makeBookingUrl(movieUrl, cityKey) {
  const url = new URL(movieUrl, BASE);
  const match = url.pathname.match(/^\/movies\/(.+?)-movie-tickets(?:-in-[a-z0-9-]+)?-MV(\d+)/i);
  if (!match) throw new ArgumentError('movie must be a District movie URL or a movie search query');
  url.pathname = `/movies/${match[1]}-movie-tickets-in-${cityKey}-MV${match[2]}`;
  return url;
}

async function searchMovie(query, loc) {
  const body = {
    get_search_results_request_type: 1,
    post_body: { hp_selected_tab_id: 'home_v2' },
    search_id: crypto.randomUUID(),
    keyword: query,
    tab_id: 'movies',
  };

  const resp = await fetch(`${BASE}/gw/web/search`, {
    method: 'POST',
    headers: {
      ...districtHeaders({ loc, referer: `${BASE}/search` }),
      'Content-Type': 'application/json',
      Origin: BASE,
      'x-available-tabs': 'movies',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new CommandExecutionError(`district movie search failed: HTTP ${resp.status}`);
  const data = await resp.json();
  const movie = (Array.isArray(data?.results) ? data.results : []).find((item) => {
    return String(item.entity_type || '') === 'EntityTypeMovie' && item.id;
  });
  if (!movie) throw new EmptyResultError('district showtimes', `No movie result found for "${query}"`);
  return `${BASE}/movies/${slugify(movie.display_title)}-movie-tickets-MV${movie.id}`;
}

async function fetchLocationSearch(body) {
  const resp = await fetch(`${BASE}/gw/web/get_location_search`, {
    method: 'POST',
    headers: {
      ...districtHeaders({ loc: DEFAULT_LOCATION, referer: BASE }),
      'Content-Type': 'application/json',
      Origin: BASE,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new CommandExecutionError(`district location search failed: HTTP ${resp.status}`);
  return resp.json();
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

function nearestCity(entity, cities) {
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

function cityToLocation(city, source = 'city') {
  return {
    cityId: city.city_id,
    pCityId: city.city_id,
    long: Number(city.city_long),
    lat: Number(city.city_lat),
    pCityKey: String(city.city_key || '').toLowerCase(),
    pStateKey: stateKey(city.state_name),
    countryId: '1',
    placeType: 'GOOGLE_PLACE',
    placeId: '',
    subzoneId: '',
    cityName: String(city.city_name || ''),
    pCityName: String(city.city_name || ''),
    source,
  };
}

function entityToLocation(entity, city, source = 'near') {
  const base = city ? cityToLocation(city, source) : { ...DEFAULT_LOCATION, source };
  return {
    ...base,
    long: Number(entity.long || base.long),
    lat: Number(entity.lat || base.lat),
    placeType: entity.google_place_id ? 'GOOGLE_PLACE' : 'POI',
    placeId: String(entity.google_place_id || entity.poi_id || ''),
    cityName: String(city?.city_name || base.cityName || ''),
    pCityName: String(city?.city_name || base.pCityName || ''),
    source,
  };
}

async function resolveLocationQuery(query, preferCity) {
  const [searchData, allData] = await Promise.all([
    fetchLocationSearch({ searched_text: query }),
    fetchLocationSearch({}),
  ]);
  const cities = Array.isArray(allData?.cities) ? allData.cities : [];
  const q = normalize(query);
  if (preferCity) {
    const exactCity = cities.find((city) => {
      return [city.city_name, city.cleaned_city_name, city.city_key].map(normalize).includes(q);
    });
    if (exactCity) return cityToLocation(exactCity, 'city');
  }

  const entities = Array.isArray(searchData?.entities) ? searchData.entities : [];
  const entity = preferCity
    ? entities.find((item) => String(item.entity_type || '').includes('CITY')) || entities[0]
    : entities.find((item) => normalize(item.title) === q) || entities[0];
  if (!entity) throw new EmptyResultError('district showtimes', `No location found for "${query}"`);
  const city = String(entity.entity_type || '').includes('CITY')
    ? cities.find((item) => normalize(item.city_name) === normalize(entity.title) || normalize(item.city_key) === q)
    : nearestCity(entity, cities);
  return String(entity.entity_type || '').includes('CITY')
    ? cityToLocation(city || { city_id: '', city_key: '', city_lat: entity.lat, city_long: entity.long, city_name: entity.title, state_name: '' }, 'city')
    : entityToLocation(entity, city, 'near');
}

async function resolveCityKey(cityKey) {
  const allData = await fetchLocationSearch({});
  const city = (Array.isArray(allData?.cities) ? allData.cities : []).find((item) => {
    return normalize(item.city_key) === normalize(cityKey);
  });
  return city ? cityToLocation(city, 'city-key') : { ...DEFAULT_LOCATION, pCityKey: cityKey, source: 'city-key' };
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new CommandExecutionError('District booking page did not include session data');
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    throw new CommandExecutionError(`District session data could not be parsed: ${err.message}`);
  }
}

function pricesFor(areas) {
  return (Array.isArray(areas) ? areas : [])
    .map((area) => Number(area.price))
    .filter((price) => Number.isFinite(price));
}

function moneyRange(areas) {
  const prices = pricesFor(areas);
  if (!prices.length) return '';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `INR ${min}` : `INR ${min}-${max}`;
}

function formatDateTime(value, options) {
  if (!value) return '';
  const date = new Date(`${value}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...options }).format(date);
}

function sessionMinute(value) {
  const time = formatDateTime(value, { hour: '2-digit', minute: '2-digit', hour12: false });
  const match = time.match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function languageFor(movie) {
  const languages = Array.isArray(movie.languages) ? movie.languages : [];
  return String(movie.primary_language || languages[0] || '').trim();
}

function matchesText(value, filter) {
  return !filter || normalize(value).includes(normalize(filter));
}

function rowsFromPayload(payload, loc, formatId, contentId, filters, limit) {
  const movie = payload?.meta?.movie || {};
  const selectedDate = payload?.meta?.selectedShowDate || '';
  const language = languageFor(movie);
  const cinemas = [
    ...(Array.isArray(payload?.pageData?.nearbyCinemas) ? payload.pageData.nearbyCinemas : []),
    ...(Array.isArray(payload?.pageData?.farCinemas) ? payload.pageData.farCinemas : []),
  ];

  const rows = [];
  for (const cinema of cinemas) {
    const info = cinema.cinemaInfo || {};
    const cinemaName = String(info.name || info.label || '');
    if (!matchesText(cinemaName, filters.cinema)) continue;

    for (const session of Array.isArray(cinema.sessions) ? cinema.sessions : []) {
      const minute = sessionMinute(session.showTime);
      const format = String(session.scrnFmt || '');
      const prices = pricesFor(session.areas);
      if (filters.after != null && minute != null && minute < filters.after) continue;
      if (filters.before != null && minute != null && minute > filters.before) continue;
      if (filters.maxPrice && prices.length && Math.min(...prices) > filters.maxPrice) continue;
      if (!matchesText(language, filters.language)) continue;
      if (!matchesText(format, filters.quality)) continue;

      const encSessionId = String(session.encSessionId || `${session.cid}-${session.sid}-${String(session.mid || '').toLowerCase()}-${session.cid}`);
      rows.push({
        rank: rows.length + 1,
        movie: String(movie.name || ''),
        language,
        date: selectedDate || formatDateTime(session.showTime, { year: 'numeric', month: '2-digit', day: '2-digit' }),
        time: formatDateTime(session.showTime, { hour: '2-digit', minute: '2-digit', hour12: true }),
        cinema: cinemaName,
        format,
        priceRange: moneyRange(session.areas),
        available: Number(session.avail || 0),
        showId: encSessionId,
        formatId: String(formatId || session.mcd || ''),
        url: `${BASE}/movies/seat-layout/${formatId || session.mcd}?encsessionid=${encodeURIComponent(encSessionId)}&freeseating=false&fromsessions=true&type=MOVIES&contentid=${contentId}&fromdate=${selectedDate}&citykey=${encodeURIComponent(loc.pCityKey || '')}`,
      });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

async function resolveLocation(page, args) {
  const city = validateOptionalText(args.city, 'city');
  const near = validateOptionalText(args.near, 'near');
  const cityKey = validateCityKey(args['city-key']);
  if (near) return resolveLocationQuery(near, false);
  if (city) return resolveLocationQuery(city, true);
  if (cityKey) return resolveCityKey(cityKey);
  return browserLocation(page);
}

cli({
  site: 'district',
  name: 'showtimes',
  aliases: ['shows'],
  access: 'read',
  description: 'List District movie showtimes with location, time, cinema, language, price, and format filters',
  domain: 'www.district.in',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  siteSession: 'persistent',
  args: [
    { name: 'movie', positional: true, required: true, help: 'Movie name or District movie URL' },
    { name: 'date', help: 'Show date in YYYY-MM-DD format; defaults to District selected date' },
    { name: 'city', help: 'District city name/key, for example Bangalore or Bengaluru' },
    { name: 'near', help: 'Area, mall, or locality to search near, for example Indiranagar' },
    { name: 'city-key', help: 'Legacy District city key override, for example bengaluru' },
    { name: 'after', help: 'Only shows at or after HH:MM, 24-hour time' },
    { name: 'before', help: 'Only shows at or before HH:MM, 24-hour time' },
    { name: 'cinema', help: 'Filter cinema/theatre name, for example PVR, INOX, Orion' },
    { name: 'language', help: 'Filter movie language, for example English, Hindi, Kannada' },
    { name: 'max-price', type: 'float', help: 'Only shows with at least one ticket class at or below this price' },
    { name: 'quality', help: 'Generic format/quality filter, for example 2D, 3D, IMAX, IMAX 3D, 4DX' },
    { name: 'limit', type: 'int', default: 50, help: 'Maximum showtime rows to return (1-200)' },
  ],
  columns: [
    'rank',
    'movie',
    'language',
    'date',
    'time',
    'cinema',
    'format',
    'priceRange',
    'available',
    'showId',
    'formatId',
    'url',
  ],
  func: async (page, args) => {
    const movieInput = validateText(args.movie, 'movie');
    const date = validateDate(args.date);
    const limit = validateLimit(args.limit);
    const filters = {
      after: validateClock(args.after, 'after'),
      before: validateClock(args.before, 'before'),
      cinema: validateOptionalText(args.cinema, 'cinema'),
      language: validateOptionalText(args.language, 'language'),
      maxPrice: validateMoney(args['max-price'], 'max-price'),
      quality: validateOptionalText(args.quality, 'quality'),
    };
    const loc = await resolveLocation(page, args);
    if (!loc.pCityKey) throw new CommandExecutionError('Could not resolve District city key for showtimes');

    const movieUrl = isDistrictMovieUrl(movieInput) ? movieInput : await searchMovie(movieInput, loc);
    const contentId = extractContentId(movieUrl);
    const bookingUrl = makeBookingUrl(movieUrl, loc.pCityKey);
    if (date) bookingUrl.searchParams.set('fromdate', date);

    const resp = await fetch(bookingUrl, {
      headers: districtHeaders({
        loc,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        referer: movieUrl,
      }),
    });
    if (!resp.ok) throw new CommandExecutionError(`district booking page failed: HTTP ${resp.status}`);

    const nextData = extractNextData(await resp.text());
    const state = nextData.props?.pageProps?.initialState?.movies || {};
    const formatId = state.queryState?.frmtid || Object.keys(state.movieSessions || {})[0] || '';
    const payload = await fetchMovieSessions({
      loc,
      contentId,
      formatId,
      date,
      referer: bookingUrl.toString(),
    });

    const showDates = Array.isArray(payload?.meta?.showDates) ? payload.meta.showDates : [];
    if (date && showDates.length && !showDates.includes(date)) {
      throw new EmptyResultError('district showtimes', `No showtimes found for ${date}; available dates: ${showDates.join(', ')}`);
    }

    const rows = rowsFromPayload(payload, loc, formatId, contentId, filters, limit);
    if (!rows.length) throw new EmptyResultError('district showtimes', `No showtimes matched the requested filters for "${movieInput}"`);
    return rows;
  },
});
