# API Discovery

Use this after `site-recon.md` chooses Pattern A/B/C/D/E. The output of this file is a candidate endpoint plus evidence for the strategy note.

Keep `--trace on --keep-tab true --window foreground` enabled while exploring browser-backed sites.

## Section 0 - Preflight Red Lines

Read these before endpoint verification. If you miss either one, you can spend the rest of discovery testing the wrong thing.

### 0.1 Anti-bot and WAF gates decide whether Node fetch is valid

`webcmd browser analyze <url>` reports the `anti_bot` field. You can also inspect cookies and the response body manually.

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
webcmd browser eval "fetch('https://<target-subdomain>/api/...', { credentials: 'include' }).then(r => r.status).catch(e => 'cors:' + e.message)"
```

- A numeric status means CORS allows the request.
- `cors:...` or `TypeError: Failed to fetch` means the browser blocked it.

When it is blocked, `credentials: include` is not a CORS fix across subdomains. It only asks the browser to send cookies; it does not grant cross-origin permission. Use this fallback order:

1. Prefer a same-origin endpoint on the current subdomain.
2. Open a page on the target subdomain with `webcmd browser open https://<target-subdomain>/`, then fetch relative paths from that origin.
3. If the data is truly cross-origin and there is no same-origin alternative, use Section 5 intercept and capture the response from the page's own request.

## Section 1 - Network Deep Read

Use for Pattern A and for deeper data in Pattern B.

```bash
webcmd browser open <url> --trace on --keep-tab true --window foreground
webcmd browser wait xhr '<path-or-domain-fragment>'
webcmd browser network --format json
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
webcmd browser eval "await fetch('<url>', { credentials: 'include' }).then(r => r.text())"
```

If Node-side replay works without page runtime state, prefer `PUBLIC_API` or `COOKIE_API`. If the endpoint only works in page context, document why before selecting `PAGE_FETCH`.

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
webcmd browser eval "Object.keys(window).filter(k => /STATE|DATA|NUXT|APP/i.test(k))"
webcmd browser eval "document.querySelectorAll('script[type=\"application/json\"], script:not([src])').length"
webcmd browser eval "document.body.innerText.slice(0, 2000)"
```

Use `DOM_STATE` when the target data is stable in state or HTML. If only a deeper interaction loads the target data, return to section 1.

## Section 3 - Bundle / Script Src Search

Use for Pattern C.

Collect script sources:

```bash
webcmd browser eval "[...document.querySelectorAll('script[src]')].map(s => s.src)"
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
webcmd browser eval "document.querySelector('meta[name=\"csrf-token\"]')?.content"
webcmd browser eval "Object.keys(localStorage)"
webcmd browser eval "Object.keys(sessionStorage)"
webcmd browser eval "document.cookie"
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
webcmd browser trace start
webcmd browser click '<selector>'
webcmd browser wait xhr '<target-fragment>'
webcmd browser network --format json
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
