# Site Recon

**Layer 1: what kind of site is this?** Classify the site, then go directly to `api-discovery.md` to find the endpoint.

This file only classifies sites. It does not explain how to discover endpoints.

## One-Step Diagnosis

Preferred command:

```bash
webcmd browser analyze <url>
```

The command returns JSON with:

```json
{
  "pattern": "A|B|C|D|E",
  "anti_bot": [],
  "api_candidates": [],
  "nearest_adapters": [],
  "recommended_next_step": "..."
}
```

`analyze` gives Pattern classification, anti-bot signals, nearest-adapter matches, and the next step in one pass. Follow `recommended_next_step` directly in most cases.

## Manual Three-Step Diagnosis

Use this only when `analyze` is ambiguous:

```bash
webcmd browser open <url> --trace on --keep-tab true --window foreground
webcmd browser wait time 2
webcmd browser network --format json
```

Read `network` output this way:

| `network` shows | Site type | Signals |
| --- | --- | --- |
| Many `/api/...` JSON requests containing target data | **A. SPA / JSON XHR** | React/Vue style app, data loaded through fetch/XHR |
| Requests exist but are ads, analytics, or no target data | **B. SSR / inline data** | First screen data is in HTML, deeper pages may use API |
| Empty except static resources | **C. JSONP / `<script src>` driven** | Data may arrive through script tags or callback-wrapped payloads |
| API exists but returns 401/403 or signature errors | **D. Token / CSRF auth** | Pattern A plus auth headers or page-sourced tokens |
| `Content-Type: text/event-stream` or WebSocket handshake | **E. Streaming** | Live feed, chat, or tick data |

If data is loaded asynchronously, `wait time 2` may not be enough. Prefer `webcmd browser wait xhr '/api/path-fragment'` for a specific interface over blind `wait time 5`.

---

## Pattern A - SPA / JSON XHR

**Examples:** GitHub, Linear, Notion, many modern SaaS apps.

**Signals:**

- The initial URL loads shell HTML, then target data appears in network.
- `document.querySelector('main').childElementCount` starts low and is later populated by JavaScript.
- `window.React`, `window.Vue`, or `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` exists.

**Next step:** `api-discovery.md` section 1, network deep read.

**Important:** Pattern A does not automatically mean `PAGE_FETCH`.

- First inspect `api_candidates[]` from `webcmd browser analyze`: only `verdict=likely_data` entries are real candidates. `verdict=noise` entries such as analytics, beacons, or personalization do not count as API signals.
- The booking #1680 counterexample had many JSON XHRs that looked like Pattern A, but they were analytics side-channels; the final strategy was `DOM_STATE` / `UI_SELECTOR`.
- After replaying a candidate endpoint, choose strategy through `strategy-selection.md`. Consider `PAGE_FETCH` only after `PUBLIC_API` and `COOKIE_API` fail.

## Pattern B - SSR / Inline Data

**Examples:** Reddit post pages, YouTube watch pages, many Next.js / Nuxt pages.

**Signals:**

- The first `document` response already contains target data (`curl <url> | grep <known-value>`).
- `window.__INITIAL_STATE__`, `window.__NEXT_DATA__`, or `window.__NUXT__` exists.
- The first screen is still visible with JavaScript disabled.

**Next step:** `api-discovery.md` section 2 for state extraction, plus section 1 when deeper data returns to network.

## Pattern C - JSONP / `<script src>` Driven

**Examples:** older quote pages, legacy directory pages, callback-wrapped data feeds.

**Signals:**

- `network` is empty or mostly CSS/fonts.
- The page clearly displays data such as price, count, or volume.
- `document.querySelectorAll('script[src]')` includes URLs under `push`, `api`, or `data` style domains.
- Response is callback-wrapped, such as `callback123({...})`.

**Next step:** `api-discovery.md` section 3, bundle / script src search.

## Pattern D - Token / CSRF Auth

**Examples:** Twitter/X and some enterprise SaaS apps.

**Signals:**

- It is otherwise Pattern A, but `fetch(url, { credentials: 'include' })` returns 401/403.
- Network requests contain custom headers such as `X-Csrf-Token`, `Authorization: Bearer`, `X-Client-Id`, or `X-Workspace-Id`.
- 401 responses include hints like `{"code":"AUTH_REQUIRED","csrf":"..."}`.

**Next step:** `api-discovery.md` section 4 token-source investigation, then section 5 store-action / intercept fallback if needed.

## Pattern E - Streaming

**Examples:** LLM chat streams, live feeds, real-time dashboards.

**Signals:**

- `network` contains `101 Switching Protocols`.
- Response headers include `Content-Type: text/event-stream`.
- The request stays pending.

**Next step:** first find an HTTP polling endpoint with the same data. Most sites have one. Use intercept only when no polling endpoint exists.

## If Classification Fails

When diagnostic signals conflict, such as non-empty network with no target data, use this priority order:

1. Treat as A and try `api-discovery.md` section 1.
2. If that fails, treat as B and try section 2.
3. If that fails, treat as C and try section 3.
4. If 401/403 appears, switch to D and try section 4.
5. After all other paths fail, use intercept from section 5.

Do not get stuck debating classification. Classification chooses the first move; fallback order handles misses.
