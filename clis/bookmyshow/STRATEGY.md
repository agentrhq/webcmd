# BookMyShow Adapter — Strategy Note

## All Commands

Strategy: COOKIE (PAGE_FETCH)
Contract: internal-unstable
Evidence:
- observed request/state: BookMyShow exposes internal JSON API endpoints at
  `in.bookmyshow.com/api/movies-data/now-showing-movies/{city}`,
  `in.bookmyshow.com/api/movies-data/upcoming-movies/{city}`,
  `in.bookmyshow.com/api/events-data/events/{city}`,
  `in.bookmyshow.com/api/search/suggest`,
  `in.bookmyshow.com/api/home/regions`,
  `in.bookmyshow.com/api/movies-data/movie-details/{code}/{city}`.
- auth source: None — endpoints are unauthenticated, but protected by
  Cloudflare JS challenge. Browser session provides cf_clearance cookies.
- replay result: 200 + JSON containing target movie/event/city data when
  fetched from browser context with valid Cloudflare session.

Why COOKIE (PAGE_FETCH):
- PUBLIC_API: Ruled out — Cloudflare returns 403 to bare Node fetch().
  The JS challenge requires a real browser to solve the turnstile, then
  subsequent requests within that browser context pass through.
- COOKIE via page.fetchJson(): All API calls run inside the browser page
  via webcmd's page.fetchJson(), which carries credentials: 'include'.
  The browser's cf_clearance cookie satisfies Cloudflare automatically.
  No login or user auth is needed — just a live browser session.
- INTERCEPT: Not needed — no request signing or HMAC. The APIs accept
  plain GET requests once Cloudflare is satisfied.
- UI_SELECTOR/DOM_STATE: Would require scraping DOM instead of clean JSON.
  The JSON endpoints exist and work fine from browser context.

Risk:
- drift risk: MEDIUM — These are internal endpoints without a public contract.
  BookMyShow can change response shapes, add auth, or remove endpoints without
  notice. The adapter uses defensive response parsing (multiple fallback paths
  for field names) to mitigate this.
- verification fixture: Adapter handles multiple known response shapes
  (moviesData.BookMyShow.arrEvents, moviesData.arrEvents, arrEvents, etc.)
  to absorb wrapper changes without breakage.
