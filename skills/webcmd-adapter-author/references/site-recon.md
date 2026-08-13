# Site Recon

**Layer 1: what kind of site is this?** Classify the site, then go directly to `api-discovery.md` to find the endpoint.

This file only classifies sites. It does not explain how to discover endpoints.

## Browser-Run Diagnosis

Preferred flow:

```bash
webcmd --session <session-id> browser run --stdin --snapshot-mode tree <<'JS'
const responses = [];
page.on('response', response => {
  const contentType = response.headers()['content-type'] || '';
  if (/json|text\/event-stream/i.test(contentType) || /\/api\/|graphql/i.test(response.url())) {
    responses.push({
      url: response.url(),
      status: response.status(),
      contentType,
    });
  }
});

await page.goto('<url>');
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1500);

return {
  url: page.url(),
  title: await page.title(),
  globals: await page.evaluate(() => ({
    react: Boolean(window.React || window.__REACT_DEVTOOLS_GLOBAL_HOOK__),
    next: Boolean(window.__NEXT_DATA__),
    nuxt: Boolean(window.__NUXT__),
  })),
  responses: responses.slice(0, 20),
};
JS
```

Then inspect page structure when needed:

```bash
webcmd --session <session-id> browser snapshot --snapshot-mode tree
```

Use this evidence to choose Pattern A/B/C/D/E. Do not paste the Playwright-style program into the adapter.

## Existing-Page Diagnosis

Use this when the user already has a relevant tab open. List pages, bind the chosen page,
then run dependent recon steps together:

```bash
webcmd --session <session-id> browser tabs
webcmd --session <session-id> browser bind --page page-123
webcmd --session <session-id> browser run --stdin <<'JS'
const responsePromise = page.waitForResponse(
  response => response.url().includes('/api/path-fragment'),
);
await page.goto('https://example.com');
await page.waitForLoadState('domcontentloaded');
const response = await responsePromise;
return {
  url: page.url(),
  endpoint: { url: response.url(), status: response.status() },
};
JS
```

Then inspect the current page when a snapshot is needed:

```bash
webcmd --session <session-id> browser snapshot --snapshot-mode tree
```

Use the snapshot and any response evidence collected in the run to classify the site:

| `network` shows | Site type | Signals |
| --- | --- | --- |
| Many `/api/...` JSON requests containing target data | **A. SPA / JSON XHR** | React/Vue style app, data loaded through fetch/XHR |
| Requests exist but are ads, analytics, or no target data | **B. SSR / inline data** | First screen data is in HTML, deeper pages may use API |
| Empty except static resources | **C. JSONP / `<script src>` driven** | Data may arrive through script tags or callback-wrapped payloads |
| API exists but returns 401/403 or signature errors | **D. Token / CSRF auth** | Pattern A plus auth headers or page-sourced tokens |
| `Content-Type: text/event-stream` or WebSocket handshake | **E. Streaming** | Live feed, chat, or tick data |

If data is loaded asynchronously, arm `page.waitForResponse(...)` before the
navigation or UI trigger in the same run. Do not use a separate browser wait.

When classification needs a dependent UI trigger plus a request/response
waiter, use one sandboxed `browser run` program and arm the waiter before the
trigger. Record the endpoint and UI evidence; do not copy the Playwright-style
program into an adapter.

---

## Pattern A - SPA / JSON XHR

**Examples:** GitHub, Linear, Notion, many modern SaaS apps.

**Signals:**

- The initial URL loads shell HTML, then target data appears in network.
- `document.querySelector('main').childElementCount` starts low and is later populated by JavaScript.
- `window.React`, `window.Vue`, or `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` exists.

**Next step:** `api-discovery.md` section 1, network deep read.

**Important:** Pattern A does not automatically mean `PAGE_FETCH`.

- First inspect the response evidence collected by `browser run`; analytics, beacons, or personalization responses do not count as API signals.
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
