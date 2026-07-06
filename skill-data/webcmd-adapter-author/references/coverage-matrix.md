# Coverage Matrix

Use this file before writing an adapter. It decides whether the task is inside the Webcmd adapter-authoring lane.

## Supported

| Scenario | Good fit | Notes |
| --- | --- | --- |
| Public JSON or HTML endpoint | Yes | Prefer `PUBLIC_API` when Node-side `fetch` can replay it without auth. |
| Cookie-backed JSON or HTML endpoint | Yes | Use `COOKIE_API` when cookies, CSRF, or headers can be sourced from the page safely. |
| Visible UI actions | Yes | Use `UI_SELECTOR` for clicks, forms, uploads, and other user-visible workflows. |
| SSR or hydration state | Yes | Use `DOM_STATE` when target data appears in HTML, script JSON, or bootstrap state. |
| Page-context fetch | Conditional | Use `PAGE_FETCH` only when same-origin/session/runtime state makes Node-side replay impossible. |
| Natural page request interception | Conditional | Use `INTERCEPT` when the page can naturally issue a signed request and UI/DOM is not enough. |
| JSDOM fixture regression | Yes | Use when DOM extraction has already produced a silent bug or mocked evaluate is too weak. |

## Unsupported

| Scenario | Reason | Alternative |
| --- | --- | --- |
| First-time login token acquisition | Requires the user to enter real credentials | Ask the user to log in manually in the browser session, then reuse cookies. |
| CAPTCHA or heavy anti-bot bypass | This would bypass access controls or risk systems | Stop or choose another source with the same data. |
| Client crypto or private signing secrets | Requires reverse engineering and ongoing bundle tracking | Prefer another endpoint; if unavoidable, let the page issue the request and use `INTERCEPT`. |
| Pure WebSocket stream | State management is too high for this skill | Look for an HTTP polling endpoint with the same data. |
| Private binary protocol | Not HTTP/JSON/HTML | Out of scope. |
| Canvas-only visual chart | Data is only in the render layer | Find the backing API; if none exists, stop. |
| Strict rate limit | Adapter authoring cannot solve platform quota policy | Add adapter-level concurrency limits/backoff, but do not brute force. |

## Quick Self-Test

Ask these questions before implementation:

1. **Can the data be seen in the browser?** If not because of a login wall or paywall, solve authentication first.
2. **Is the data source HTTP, JSON, or HTML?** If the answer is binary or encrypted-only, stop.
3. **Does the command require per-second push?** If yes, find an HTTP endpoint with the same data; if none exists, stop.

Continue only when all three checks pass.

## Evidence Levels

| Level | Meaning | Required proof |
| --- | --- | --- |
| Green | Hard verified | `webcmd browser verify` passed and visible-page values were checked. |
| Yellow | Plausible but not fully exercised | Pattern is documented, but this exact site has not been verified end-to-end. |
| Red | Out of scope | The skill explicitly does not teach this path. |

Prefer green evidence. If you proceed on yellow evidence, write the uncertainty in `~/.webcmd/sites/<site>/notes.md` after the run so the next agent starts with better context.
