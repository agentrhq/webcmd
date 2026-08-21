# API Discovery

Use this after `site-recon.md` chooses Pattern A/B/C/D/E. The output of this file is a candidate endpoint plus evidence for the strategy note.

Keep `--trace on --keep-tab true --window foreground` enabled while exploring browser-backed sites.

## Section 0 - Preflight Red Lines

Read these before endpoint verification. If you miss either one, you can spend the rest of discovery testing the wrong thing.

### 0.1 Anti-bot and WAF gates decide whether Node fetch is valid

Use `browser run` to inspect cookies and the response body manually.

| Cookie or body signal | Vendor | Bare Node fetch or curl result | Strategy |
| --- | --- | --- | --- |
| `acw_sc__v2`, `acw_tc`, `ssxmod_itna`; body contains `arg1 = '32-HEX'` or `/ntc_captcha/` | Aliyun WAF | Slider HTML instead of real data | Verify the endpoint in browser context first; HTML-style cookie adapters can still end with Node-side fetch plus `page.getCookies()` |
| `__cf_bm`, `cf_clearance`, `__cfduid`; body contains `Cloudflare Ray ID` or `Checking your browser` | Cloudflare | TLS or browser fingerprint is rejected | Use a browser/session-aware probe first, then choose the adapter fetch route from `adapter-template.md` |
| `_abck`, `bm_sz`, `bm_sv` | Akamai | Often blocked even with cookies | Use a browser/session-aware probe first |
| Body contains `geetest` or `gt_captcha` | Geetest | Slider or puzzle challenge; no programmatic solution in this skill | Out of scope; stop or use a user-visible UI strategy |

Rule: if any of these anti-bot or WAF signals appear, do not use bare Node fetch as endpoint verification. First prove the endpoint from the browser context or from a page on the target origin. After that, choose the final adapter strategy normally: JSON browser APIs may use `page.fetchJson()`, while HTML-style cookie adapters should keep using Node-side `fetch` with cookies read through `page.getCookies()`.

### 0.2 Cross-subdomain fetch is CORS-blocked by default

For example, a page on `jobs.51job.com` fetching an API on `cupid.51job.com` will usually hit a CORS preflight unless the API returns `Access-Control-Allow-Origin`.

Probe it explicitly:

```bash
webcmd --session <session-id> browser run --stdin <<'JS'
await page.goto('https://<current-subdomain>/');
return await page.evaluate(async () => {
  try {
    return await fetch('https://<target-subdomain>/api/...', { credentials: 'include' }).then(r => r.status);
  } catch (error) {
    return `cors:${error instanceof Error ? error.message : String(error)}`;
  }
});
JS
```

- A numeric status means CORS allows the request.
- `cors:...` or `TypeError: Failed to fetch` means the browser blocked it.

When it is blocked, `credentials: include` is not a CORS fix across subdomains. It only asks the browser to send cookies; it does not grant cross-origin permission. Use this fallback order:

1. Prefer a same-origin endpoint on the current subdomain.
2. Navigate to the target subdomain inside `browser run`, then fetch relative paths from that origin.
3. If the data is truly cross-origin and there is no same-origin alternative, use Section 5 intercept and capture the response from the page's own request.

## Section 1 - Network Deep Read

Use for Pattern A and for deeper data in Pattern B.

```bash
webcmd --session <session-id> browser run --stdin <<'JS'
const candidates = [];
page.on('response', async response => {
  const url = response.url();
  const contentType = response.headers()['content-type'] || '';
  if (!url.includes('<path-or-domain-fragment>') && !/json|graphql/i.test(contentType)) return;
  let sample = '';
  try { sample = (await response.text()).slice(0, 2000); } catch {}
  candidates.push({
    url,
    method: response.request().method(),
    status: response.status(),
    contentType,
    sample,
  });
});

await page.goto('<url>');
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1500);
return candidates.slice(0, 20);
JS
```

Inspect each candidate:

- URL and method.
- Status code and content type.
- Query/body params.
- Request headers that appear auth-related.
- Response shape and whether it includes target data.
- Whether data is user-visible, not analytics, ads, experiments, or personalization noise.

Reject candidates that only contain telemetry, unrelated recommendations, beacons, or layout metadata.

Replay directly when possible:

```bash
webcmd --session <session-id> browser run --stdin <<'JS'
return await page.evaluate(async () =>
  fetch('<url>', { credentials: 'include' }).then(r => r.text())
);
JS
```

If Node-side replay works without page runtime state, prefer `PUBLIC_API` or `COOKIE_API`. If the endpoint only works in page context, document why before selecting `PAGE_FETCH`.

For a request that exists only after a UI action, use `browser run` so the
listener is attached before the trigger:

```js
const pending = page.waitForResponse(
  response => response.url().includes('/api/target'),
);
await page.getByRole('button', { name: 'Load' }).click();
const response = await pending;
return {
  url: response.url(),
  method: response.request().method(),
  status: response.status(),
  body: await response.json(),
};
```

This is recon evidence only. Choose the adapter strategy from the verified
endpoint and UI evidence; do not copy the browser-run program into the adapter.

## Section 2 - State Extraction

Use for Pattern B.

Look for:

- `window.__INITIAL_STATE__`
- `window.__NEXT_DATA__`
- `window.__NUXT__`
- JSON in `<script type="application/json">`
- SSR HTML structures containing visible values

Commands:

```bash
webcmd --session <session-id> browser run --stdin <<'JS'
return await page.evaluate(() => ({
  globals: Object.keys(window).filter(k => /STATE|DATA|NUXT|APP/i.test(k)),
  jsonScriptCount: document.querySelectorAll('script[type="application/json"], script:not([src])').length,
  textSample: document.body.innerText.slice(0, 2000),
}));
JS
```

Use `DOM_STATE` when the target data is stable in state or HTML. If only a deeper interaction loads the target data, return to section 1.

## Section 3 - Bundle / Script Src Search

Use for Pattern C.

Collect script sources:

```bash
webcmd --session <session-id> browser run --stdin <<'JS'
return await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.src));
JS
```

Look for domains or paths containing:

- `api`
- `data`
- `search`
- `graphql`
- `query`
- `feed`
- `suggest`
- `push`

For JSONP or callback-wrapped payloads, verify that stripping the wrapper yields parseable JSON:

```js
const raw = await fetch(url).then((r) => r.text());
const json = JSON.parse(raw.replace(/^[\w$.]+\((.*)\);?$/, '$1'));
```

If a script points to bundle code rather than data, search for base URLs, route names, and query keys. Prefer endpoints with stable names and visible data over minified private internals.

## Section 4 - Token / Header Source

Use for Pattern D.

Find token sources in this order:

1. Network request headers.
2. Cookies available through `page.getCookies()`.
3. Meta tags or inline scripts.
4. Global state.
5. Same-origin bootstrap endpoint.

Useful probes:

```bash
webcmd --session <session-id> browser run --stdin <<'JS'
return await page.evaluate(() => ({
  csrf: document.querySelector('meta[name="csrf-token"]')?.content ?? null,
  localStorageKeys: Object.keys(localStorage),
  sessionStorageKeys: Object.keys(sessionStorage),
  cookieNames: document.cookie.split(';').map(part => part.trim().split('=')[0]).filter(Boolean),
}));
JS
```

Rules:

- It is fine to reuse cookies and CSRF values the page already has.
- Do not teach bypassing CAPTCHA, risk controls, or access controls.
- Do not reverse engineer private signatures when the only path is static secrets or brittle bundle logic.
- If token extraction is fragile but the user-visible page can perform the action, choose `UI_SELECTOR` or `INTERCEPT`.

## Section 5 - Store Action / Intercept Fallback

Use only after public API, cookie API, DOM state, and UI selector options are insufficient.

For page actions:

```bash
webcmd --session <session-id> browser run --stdin <<'JS'
const pending = page.waitForResponse(response => response.url().includes('<target-fragment>'));
await page.locator('<selector>').click();
const response = await pending;
return {
  url: response.url(),
  method: response.request().method(),
  status: response.status(),
  body: await response.text(),
};
JS
```

Choose `INTERCEPT` when:

- The page naturally sends the target request.
- The response contains the target data.
- You can trigger the request with a stable UI action.
- You can explain why replay and DOM extraction are not enough.

Choose `UI_SELECTOR` when the operation itself is the user-visible contract, such as clicking, publishing, uploading, or filling a form.

## Endpoint Verification Checklist

Before writing adapter code:

- [ ] Candidate response is 200.
- [ ] Candidate response contains target data.
- [ ] Candidate is not analytics, ads, or telemetry.
- [ ] Auth source is documented.
- [ ] Replay method is documented.
- [ ] Strategy note is written.
- [ ] At least one field value is compared against the visible page.

If any item fails, return to `site-recon.md` or the earlier section of this file.
