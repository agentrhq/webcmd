// Shared District helpers. Not a command module — discovery skips files that
// do not register a cli() command, so this is import-only for the adapters in
// this directory. Keep every seat-layout URL and session-state rule here so
// seats.js and checkout.js cannot drift apart (a dropped `fromdate` in one
// copy once made District report "booking closed" for a future-dated show).
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
  getErrorMessage,
} from '@agentrhq/webcmd/errors';

export const BASE = 'https://www.district.in';
export const GUEST_TOKEN = '1212';

export const DEFAULT_LOCATION = {
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
  source: 'adapter-default',
};

// ── validation ──

export function validateTimeout(raw, { def, min, max }) {
  const timeout = Number(raw ?? def);
  if (!Number.isInteger(timeout) || timeout < min || timeout > max) {
    throw new ArgumentError(`timeout must be an integer from ${min} to ${max} seconds`);
  }
  return timeout;
}

export function validateShowId(raw) {
  const showId = String(raw || '').trim();
  if (!showId) throw new ArgumentError('show is required');
  if (!/^\d+-\d+-[a-z0-9]+-\d+$/i.test(showId)) {
    throw new ArgumentError('show must be a District seat-layout URL or showId like 1067859-5829-ob1emi-1067859');
  }
  return showId;
}

export function validateId(raw, name) {
  const value = String(raw || '').trim();
  if (!value) throw new ArgumentError(`${name} is required when show is not a seat-layout URL`);
  if (!/^[a-z0-9]+$/i.test(value)) throw new ArgumentError(`${name} must contain only letters and numbers`);
  return value;
}

// ── seat-layout target and URL ──

export function parseSeatUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim(), BASE);
    const match = url.pathname.match(/^\/movies\/seat-layout\/([^/]+)$/i);
    if (!url.hostname.endsWith('district.in') || !match) return null;

    const showId = url.searchParams.get('encsessionid') || '';
    const contentId = url.searchParams.get('contentid') || url.searchParams.get('content_id') || '';
    if (!showId) throw new ArgumentError('seat-layout URL must include encsessionid');
    if (!contentId) throw new ArgumentError('seat-layout URL must include contentid');

    return {
      showId: validateShowId(showId),
      formatId: validateId(match[1], 'format-id'),
      contentId: validateId(contentId, 'content-id'),
      fromDate: url.searchParams.get('fromdate') || url.searchParams.get('fromDate') || '',
      cityKey: (url.searchParams.get('citykey') || '').toLowerCase(),
    };
  } catch (error) {
    if (error instanceof ArgumentError) throw error;
    return null;
  }
}

export function makeSeatUrl({ showId, formatId, contentId, fromDate, cityKey }) {
  const url = new URL(`${BASE}/movies/seat-layout/${formatId}`);
  url.searchParams.set('encsessionid', showId);
  url.searchParams.set('freeseating', 'false');
  url.searchParams.set('fromsessions', 'true');
  url.searchParams.set('type', 'MOVIES');
  url.searchParams.set('contentid', contentId);
  if (fromDate) url.searchParams.set('fromdate', fromDate);
  // District ignores this param; it rides along so seat-layout URLs stay
  // self-contained and the adapters can align the browser location to the
  // show's city (see openSeatMap).
  if (cityKey) url.searchParams.set('citykey', cityKey);
  return url.toString();
}

export function resolveSeatTarget(args) {
  const fromUrl = parseSeatUrl(args.show);
  if (fromUrl) return fromUrl;
  return {
    showId: validateShowId(args.show),
    formatId: validateId(args['format-id'], 'format-id'),
    contentId: validateId(args['content-id'], 'content-id'),
    fromDate: '',
    cityKey: '',
  };
}

// ── navigation and page-state waits ──

export async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    if (!/net::ERR_ABORTED/i.test(getErrorMessage(error))) throw error;
  }
}

export class BookingClosedError extends CommandExecutionError {
  constructor() {
    super('District says booking is now closed for this show');
  }
}

/**
 * Poll a predicate until it reports ok. The predicate may return
 * `{ ok, message, closed }`; `closed: true` means District's "booking is now
 * closed" modal is showing on the genuine seat-layout page. Predicates that
 * do not compute `closed` fall back to a body-text match.
 */
export async function waitFor(page, label, timeout, predicateSource) {
  const deadline = Date.now() + timeout * 1000;
  let lastState = '';
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicateSource);
    if (result?.ok) return result;
    lastState = result?.message || lastState;
    if (result?.closed ?? /booking is now closed/i.test(lastState)) {
      throw new BookingClosedError();
    }
    await page.wait(Math.min(1, Math.max(0.2, (deadline - Date.now()) / 1000)));
  }
  throw new TimeoutError(label, timeout, lastState || 'Timed out waiting for District page state');
}

// The persistent site tab can carry a stale "Booking is now closed" modal from a
// previous command; dismiss it so it is not mistaken for this show's state.
export async function dismissClosedModal(page) {
  return page.evaluate(`
    (() => {
      const text = document.body ? document.body.innerText : '';
      if (!/booking is now closed/i.test(text)) return false;
      const okay = [...document.querySelectorAll('button,[role="button"]')]
        .find((el) => /^okay$/i.test((el.innerText || '').trim()));
      if (okay) okay.click();
      return true;
    })()
  `);
}

/**
 * Navigate to a seat-layout URL and wait until the seat map has rendered.
 * Clears any stale closed-booking modal inherited from the persistent tab and
 * re-navigates once before treating the modal as this show's real state.
 * Throws BookingClosedError when District genuinely reports the show closed.
 */
export async function ensureSeatLayout(page, url, timeout) {
  await safeGoto(page, url);
  if (await dismissClosedModal(page)) {
    await page.wait(0.5);
    await safeGoto(page, url);
  }
  await waitFor(page, 'district seat map', timeout, `
    (() => {
      const available = document.querySelectorAll('#available-seat,[id="selected-seat"] span').length;
      const bodyText = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240) : '';
      const closed = /booking is now closed/i.test(bodyText)
        && /\\/movies\\/seat-layout\\//.test(location.href);
      return { ok: available > 0, closed, message: bodyText };
    })()
  `);
}

// ── location picker (shared by set-location and the seat-map alignment) ──

export async function openLocationPicker(page) {
  const result = await page.evaluate(`
    (() => {
      const header = document.querySelector('#master-header') || document;
      const buttons = [...header.querySelectorAll('button[aria-label]')];
      const target = buttons.find((button) => {
        const text = (button.innerText || '').replace(/\\s+/g, ' ').trim();
        const label = button.getAttribute('aria-label') || '';
        return text && label && !/button|user avatar|search/i.test(label);
      });
      if (!target) return { ok: false, message: 'Could not find the District location button' };
      target.click();
      return { ok: true };
    })()
  `);
  if (!result?.ok) throw new CommandExecutionError(result?.message || 'Could not open District location picker');
}

export async function searchLocation(page, location, timeout) {
  await waitFor(page, 'district location picker', timeout, `
    (() => {
      const input = document.querySelector('input[placeholder*="Search city"], input[placeholder*="area"], input[placeholder*="locality"]');
      const message = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240) : '';
      return { ok: !!input, message };
    })()
  `);

  const filled = await page.evaluate(`
    (() => {
      const input = document.querySelector('input[placeholder*="Search city"], input[placeholder*="area"], input[placeholder*="locality"]');
      if (!input) return false;
      const value = ${JSON.stringify(location)};
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      input.focus();
      if (setter) setter.call(input, '');
      else input.value = '';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.at(-1) || '' }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  if (!filled) throw new CommandExecutionError('Could not type into the District location search input');

  await waitFor(page, 'district location search results', timeout, `
    (() => {
      const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim();
      const query = normalize(${JSON.stringify(location)});
      const buttons = [...document.querySelectorAll('[role="dialog"] button[aria-label]')];
      const results = buttons.filter((button) => {
        const label = button.getAttribute('aria-label') || '';
        return label && !/Use Current Location|Clear input/i.test(label);
      });
      const hasMatchingResult = results.some((button) => normalize(button.innerText || button.getAttribute('aria-label')).includes(query));
      const message = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240) : '';
      return { ok: results.length > 0 && hasMatchingResult, message };
    })()
  `);
}

export async function chooseLocationResult(page, location, rank) {
  const result = await page.evaluate(`
    (() => {
      const rank = ${JSON.stringify(rank)};
      const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim();
      const query = normalize(${JSON.stringify(location)});
      const buttons = [...document.querySelectorAll('[role="dialog"] button[aria-label]')].filter((button) => {
        const label = button.getAttribute('aria-label') || '';
        return label && !/Use Current Location|Clear input/i.test(label);
      });
      const records = buttons.map((button) => {
        const spans = [...button.querySelectorAll('span')].map((span) => span.innerText.trim()).filter(Boolean);
        const title = spans[0] || button.getAttribute('aria-label') || '';
        const subtitle = spans[1] || '';
        return { button, title, subtitle };
      });
      const exact = rank === 1 ? records.find((record) => normalize(record.title) === query) : null;
      const picked = exact || records[rank - 1];
      const target = picked?.button;
      if (!target) return { ok: false, message: 'No District location result at rank ' + rank };
      const title = picked.title;
      const subtitle = picked.subtitle;
      target.click();
      return { ok: true, title, subtitle };
    })()
  `);
  if (!result?.ok) throw new EmptyResultError('district location picker', result?.message || `No location result at rank ${rank}`);
  return result;
}

export async function extractAppliedLocation(page, timeout, expectedTitle) {
  const result = await waitFor(page, 'district location applied', timeout, `
    (() => {
      const parseCookie = (name) => {
        const item = document.cookie.split('; ').find((part) => part.startsWith(name + '='));
        if (!item) return null;
        try { return JSON.parse(decodeURIComponent(item.slice(name.length + 1))); } catch { return null; }
      };
      const cookieLoc = parseCookie('location');
      let storageLoc = null;
      try {
        const raw = sessionStorage.getItem('locationdata');
        storageLoc = raw ? JSON.parse(raw)?.data?.location_data || null : null;
      } catch {}
      const header = document.querySelector('#master-header button[aria-label]');
      const headerText = header ? header.innerText.replace(/\\s+/g, ' ').trim() : '';
      const expected = ${JSON.stringify(expectedTitle)};
      const applied = cookieLoc && storageLoc && (!expected || headerText.toLowerCase().includes(expected.toLowerCase()));
      return {
        ok: !!applied,
        message: headerText || (document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240) : ''),
        cookieLoc,
        storageLoc,
        headerText
      };
    })()
  `);

  const cookieLoc = result.cookieLoc || {};
  const storageLoc = result.storageLoc || {};
  return {
    status: 'location_set',
    name: String(cookieLoc.title || storageLoc.display_title || ''),
    city: String(cookieLoc.cityName || storageLoc.city_name || storageLoc.p_city_name || ''),
    state: String(cookieLoc.pStateName || storageLoc.p_state_name || ''),
    cityKey: String(cookieLoc.pCityKey || storageLoc.p_city_key || ''),
    cityId: String(cookieLoc.cityId || storageLoc.city_id || ''),
    placeId: String(cookieLoc.placeId || storageLoc.place_id || ''),
    subzoneId: String(cookieLoc.subzoneId || storageLoc.z_subzone_id || ''),
    lat: Number(cookieLoc.lat || storageLoc.user_lat || storageLoc.gps_lat || 0),
    lng: Number(cookieLoc.long || storageLoc.user_lng || storageLoc.gps_lng || 0),
    availableTabs: String(cookieLoc.availableTabsStr || ''),
    source: 'district_location_picker',
  };
}

/** Drive District's location picker end-to-end from the home page. */
export async function applyLocationViaPicker(page, query, timeout, rank = 1) {
  await safeGoto(page, BASE);
  await page.wait(1);
  await openLocationPicker(page);
  await searchLocation(page, query, timeout);
  const selected = await chooseLocationResult(page, query, rank);
  return extractAppliedLocation(page, timeout, selected.title);
}

/** Read the pCityKey from the District location cookie; the page must be on district.in. */
export async function currentCityKey(page) {
  const result = await page.evaluate(`
    (() => {
      const item = document.cookie.split('; ').find((part) => part.startsWith('location='));
      if (!item) return '';
      try { return String(JSON.parse(decodeURIComponent(item.slice('location='.length))).pCityKey || ''); } catch { return ''; }
    })()
  `);
  return String(result || '').toLowerCase();
}

/**
 * Open a show's seat map, healing the two known false "booking closed"
 * verdicts: a stale modal in the persistent tab (ensureSeatLayout handles
 * that) and a browser location pointing at a different city than the show —
 * District scopes the seat layout to the selected city and renders a bogus
 * closed modal for out-of-city sessions. When the target carries a cityKey
 * (showtimes embeds it in seat-layout URLs), a mismatch is fixed by driving
 * the location picker, then retrying once.
 */
export async function openSeatMap(page, target, timeout) {
  const url = makeSeatUrl(target);
  try {
    await ensureSeatLayout(page, url, timeout);
    return target;
  } catch (error) {
    if (!(error instanceof BookingClosedError) && !(error instanceof TimeoutError)) throw error;
    if (!target.cityKey || (await currentCityKey(page)) === target.cityKey) throw error;
    await applyLocationViaPicker(page, target.cityKey.replace(/-/g, ' '), timeout);
    await ensureSeatLayout(page, url, timeout);
    return target;
  }
}

// ── auth ──

function normalizeIdentity(userData) {
  return {
    user_id: String(userData.user_id || userData.id || ''),
    name: String(userData.name || ''),
    phone_number: String(userData.phone_number || userData.phoneNumber || ''),
    email: String(userData.email_id || userData.emailId || ''),
  };
}

/**
 * Probe District's profile endpoint from the page context. Returns the
 * identity when logged in; throws AuthRequiredError when the session is
 * anonymous. The page must already be on a district.in URL.
 */
export async function profileProbe(page) {
  const result = await page.evaluate(`
    (async () => {
      const headers = {
        'content-type': 'application/json',
        'x-client-id': 'district-web',
        'x-app-type': 'ed_web',
        'x-app-version': '11.11.1'
      };
      if (window.accessToken) headers['x-access-token'] = window.accessToken;
      if (window.refreshToken) headers['x-refresh-token'] = window.refreshToken;
      const resp = await fetch('https://www.district.in/gw/consumer/profile/billing/details', {
        headers,
        credentials: 'include'
      });
      const text = await resp.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      return { status: resp.status, text, data };
    })()
  `);

  if (!result || typeof result !== 'object') {
    throw new CommandExecutionError('District profile probe returned an unexpected response');
  }
  if (result.status === 401 || result.status === 403) {
    throw new AuthRequiredError('www.district.in', 'District profile endpoint requires login');
  }
  if (result.status < 200 || result.status >= 300) {
    throw new CommandExecutionError(`District profile probe failed: HTTP ${result.status}`);
  }

  const userData = result.data?.user_data;
  const identity = userData && typeof userData === 'object' ? normalizeIdentity(userData) : null;
  if (!identity || (!identity.user_id && !identity.name && !identity.phone_number && !identity.email)) {
    throw new AuthRequiredError('www.district.in', 'Waiting for District user identity after login');
  }

  return {
    logged_in: true,
    site: 'district',
    ...identity,
  };
}

// ── District API (location headers + movie sessions) ──

function locationHeaders(loc) {
  return {
    'x-city-id': String(loc.cityId || ''),
    'x-pcity-id': String(loc.pCityId || loc.cityId || ''),
    'x-user-lng': String(loc.long),
    'x-user-lat': String(loc.lat),
    'x-pcity-key': loc.pCityKey || '',
    'x-pstate-key': loc.pStateKey || '',
    'x-country-id': String(loc.countryId || '1'),
    'x-place-type': loc.placeType || 'GOOGLE_PLACE',
    'x-place-id': loc.placeId || '',
    'x-gps-lat': String(loc.lat),
    'x-gps-lng': String(loc.long),
    'x-subzone-id': String(loc.subzoneId || ''),
    'x-available-tabs': loc.availableTabs || 'movies,events,dining,attr_home,attraction,play,shopping,ipl',
    'x-city-name': loc.cityName || loc.pCityName || '',
    'x-pcity-name': loc.pCityName || loc.cityName || '',
  };
}

export function districtHeaders({ loc = DEFAULT_LOCATION, accept = 'application/json, text/plain, */*', referer = `${BASE}/movies/` } = {}) {
  return {
    Accept: accept,
    'Accept-Language': 'en-IN,en;q=0.9',
    Referer: referer,
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
    ...locationHeaders(loc),
  };
}

/** Read the District location cookie from the browser session, falling back to the adapter default. */
export async function browserLocation(page) {
  await safeGoto(page, BASE);
  const result = await page.evaluate(`
    (() => {
      const cookie = document.cookie.split('; ').find((part) => part.startsWith('location='));
      if (!cookie) return null;
      try { return JSON.parse(decodeURIComponent(cookie.slice('location='.length))); } catch { return null; }
    })()
  `);
  if (!result) return DEFAULT_LOCATION;
  return {
    cityId: result.cityId || result.id || DEFAULT_LOCATION.cityId,
    pCityId: result.pCityId || result.cityId || result.id || DEFAULT_LOCATION.pCityId,
    long: Number(result.long || DEFAULT_LOCATION.long),
    lat: Number(result.lat || DEFAULT_LOCATION.lat),
    pCityKey: result.pCityKey || DEFAULT_LOCATION.pCityKey,
    pStateKey: result.pStateKey || DEFAULT_LOCATION.pStateKey,
    countryId: result.countryId || '1',
    placeType: result.placeType || result.entity_type || DEFAULT_LOCATION.placeType,
    placeId: result.placeId || result.google_place_id || DEFAULT_LOCATION.placeId,
    subzoneId: result.subzoneId || DEFAULT_LOCATION.subzoneId,
    cityName: result.cityName || result.title || DEFAULT_LOCATION.cityName,
    pCityName: result.pCityName || result.cityName || DEFAULT_LOCATION.pCityName,
    availableTabs: result.availableTabsStr || DEFAULT_LOCATION.availableTabs,
    source: 'browser-location',
  };
}

export async function fetchMovieSessions({ loc, contentId, formatId, date, referer }) {
  const url = new URL(`${BASE}/gw/consumer/movies/v5/movie`);
  const params = {
    version: '3',
    site_id: '1',
    channel: 'mweb',
    child_site_id: '1',
    platform: 'district',
    movieCode: formatId || contentId,
    city_key: loc.pCityKey,
    content_id: contentId,
    latitude: String(loc.lat),
    longitude: String(loc.long),
    cinemaOrderLogic: '3',
  };
  if (date) params.date = date;
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const resp = await fetch(url, { headers: districtHeaders({ loc, referer }) });
  if (!resp.ok) throw new CommandExecutionError(`district showtimes request failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data?.status?.status === 'STATUS_FAILURE') {
    throw new CommandExecutionError(data.status.message || 'district showtimes request failed');
  }
  return data;
}

/**
 * Re-resolve a possibly stale show session. A District showId encodes
 * `cid-sid-mid-cid` (cinema, session, movie-format); this looks the same
 * session up again via the sessions API and returns a fresh target for
 * makeSeatUrl, or null when the show is no longer offered.
 */
export async function refreshShowSession(page, target) {
  const [cid, sid] = String(target.showId).split('-');
  const loc = await browserLocation(page);
  const payload = await fetchMovieSessions({
    loc,
    contentId: target.contentId,
    formatId: target.formatId,
    date: target.fromDate,
    referer: `${BASE}/movies/`,
  });
  const cinemas = [
    ...(Array.isArray(payload?.pageData?.nearbyCinemas) ? payload.pageData.nearbyCinemas : []),
    ...(Array.isArray(payload?.pageData?.farCinemas) ? payload.pageData.farCinemas : []),
  ];
  for (const cinema of cinemas) {
    for (const session of Array.isArray(cinema.sessions) ? cinema.sessions : []) {
      if (String(session.sid) !== sid || String(session.cid) !== cid) continue;
      const encSessionId = String(session.encSessionId || `${session.cid}-${session.sid}-${String(session.mid || '').toLowerCase()}-${session.cid}`);
      return {
        ...target,
        showId: encSessionId,
        formatId: String(target.formatId || session.mcd || ''),
        fromDate: target.fromDate || String(payload?.meta?.selectedShowDate || ''),
      };
    }
  }
  return null;
}
