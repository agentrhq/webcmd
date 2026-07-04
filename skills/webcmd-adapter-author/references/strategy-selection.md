# Strategy Selection

Choose the strategy before writing adapter code. The right strategy is the lowest-maintenance source that has enough evidence.

## Contract Ladder

| Rank | Strategy | Contract | Maintenance risk |
| --- | --- | --- | --- |
| 1 | `PUBLIC_API` | stable external contract | lowest |
| 2 | `COOKIE_API` | stable endpoint plus page-sourced auth | low |
| 3 | `UI_SELECTOR` | visible UI contract | low to medium |
| 4 | `DOM_STATE` | visible page state / SSR contract | medium |
| 5 | `PAGE_FETCH` | internal page-runtime endpoint | high |
| 6 | `INTERCEPT` | internal request naturally issued by page | high |

Use the first strategy in the ladder that can satisfy the command honestly.

## Strategy Definitions

### `PUBLIC_API`

Use when Node-side `fetch` can retrieve the target data without login or page state.

Required evidence:

- URL, method, params.
- 200 response.
- JSON or HTML contains target data.
- Response is not analytics, ads, recommendations, or layout-only data.

### `COOKIE_API`

Use when Node-side `fetch` works after sourcing cookies or headers from the page.

Required evidence:

- Cookie/header/CSRF source is documented.
- Replay returns non-empty target data.
- Auth values are obtained from the user's existing browser session.

### `UI_SELECTOR`

Use when the user-visible UI is the stable contract: click, publish, upload, form, navigation, or page semantics.

Required evidence:

- Stable semantic selector or accessibility anchor.
- Typed error path for missing UI, auth, timeout, and empty result.
- Visible-page assertion after the action when possible.

### `DOM_STATE`

Use when target data is in SSR HTML, hydration state, or bootstrap JSON.

Required evidence:

- State key, script JSON, or HTML structure is clear.
- At least one extracted value matches the visible page.
- Parser failure produces a typed error, not an empty success.

### `PAGE_FETCH`

Use when only page-context `fetch` can reuse same-origin/session/runtime state.

Required evidence:

- `webcmd browser eval fetch(...)` returns non-empty target data.
- Simpler strategies are ruled out in the strategy note.
- Internal endpoint drift risk is accepted and documented.

### `INTERCEPT`

Use when request signing or runtime state is too complex, but the page can naturally issue the target request.

Required evidence:

- Stable user action triggers the request.
- Captured response contains target data.
- UI/DOM cannot provide the target data or operation.

## `api_candidates` Evidence

`webcmd browser analyze` may output `api_candidates[]`.

Treat a candidate as usable only when:

- `verdict` is `likely_data`.
- Response sample includes target fields.
- URL and params are related to the user-visible result.
- Replay succeeds or the failure clearly points to auth/token handling.

Ignore candidates when:

- `verdict` is `noise`.
- The response is analytics, beacon, ads, personalization, or experiment config.
- It contains only layout metadata.
- It cannot be tied to visible page data.

## Counterexample: API-Looking Noise

A booking-site case had many JSON XHR requests. They looked like Pattern A, but the useful visible data was not in those requests; the requests were analytics side-channels. The correct outcome was `DOM_STATE` / `UI_SELECTOR`, not `PAGE_FETCH`.

Lesson: "has JSON XHR" is not the same as "has a usable API." Verify target data and external contract before choosing strategy.

## Required Strategy Note

Write this before adapter code:

```md
Strategy: PUBLIC_API | COOKIE_API | UI_SELECTOR | DOM_STATE | PAGE_FETCH | INTERCEPT
Contract: stable | visible-ui | internal-unstable
Evidence:
- observed request/state:
- auth source:
- replay result:
Why not simpler:
- PUBLIC_API:
- COOKIE_API:
- UI_SELECTOR/DOM_STATE:
Risk:
- drift risk:
- verification fixture:
```

If the selected strategy is `PAGE_FETCH` or `INTERCEPT`, the "Why not simpler" section is mandatory. If the selected strategy is `UI_SELECTOR` or `DOM_STATE`, do not over-defend why it is not an API; focus on semantic anchors and typed errors.
