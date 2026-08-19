---
name: webcmd-browser
description: Use when no deterministic Webcmd adapter command covers a live browser task requiring Playwright interaction, authenticated handoff, visible UI verification, or ad-hoc page inspection.
allowed-tools: Bash(webcmd:*), Read
---

# webcmd-browser

The first reader of this CLI is an agent, not a human. Use browser output as structured evidence, not as prose to skim. This skill is for **driving a live browser** to finish a task or understand a surface. If the workflow should become reusable, switch to `webcmd-adapter-author`.

---

## Adapter fallback gate

Before starting a raw browser session, filter `webcmd list -f json` at the source using request-derived terms across `site`, `name`, `description`, and `columns`; follow `webcmd-usage` for the exact command shape. Any truncation warning means adapter discovery is incomplete: narrow the filter and inspect again. Absence from truncated output never proves that no adapter exists.

Use raw `webcmd browser` only after a complete, non-truncated registry check shows no suitable adapter and a plugin search for the missing site or capability returns no match. If plugin search returns a match, offer installation of the returned `installSource`; if it errors, report the error instead of opening the browser.

---

## Prerequisites

```bash
webcmd doctor
```

Until `doctor` is green, browser commands may fail. Registry and plugin discovery do not require `doctor`.

---

## Session lifecycle

- Create an opaque browser session before raw browser work: `webcmd --profile <profile> session create`.
- Raw browser commands require that ID at the root: `webcmd --session <session-id> browser ...`; the old positional session form is retired.
- Profiles are cookie jars and auth scope; sessions are browser workspaces/windows within a profile. Parallel agents use separate sessions.
- `webcmd session list` shows sessions and their handoff/runtime state; close finished work with `webcmd session close <session-id>`. Close is blocked while that Session has a live handoff.
- Browser state in the bound page persists between calls, but each `run` gets a fresh JavaScript scope.
- `webcmd --session <session-id> browser tabs` lists existing pages without creating a new one.
- `webcmd --session <session-id> browser bind --page <page-id>` explicitly attaches the session to an existing page.
- If the user manually signs in or changes the visible tab, re-bind or inspect with a fresh snapshot before continuing.

For a `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER` fallback, use one Session for the browser portion, preserve its complete opaque ID, and close it in cleanup. Local browser commands use Cloak; hosted browser commands use Webcmd Cloud and Browser Use. `web fetch` remains local in both modes and never opens a browser.

```bash
webcmd --profile work session create
# Copy the returned full ID:
# session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45

webcmd --profile work \
  --session session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45 \
  browser run --stdin --no-snapshot-diff <<'JS'
await page.goto('https://example.com');
return { url: page.url(), title: await page.title() };
JS

webcmd --profile work \
  --session session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45 \
  browser snapshot --snapshot-mode read

webcmd --profile work session close \
  session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45
```

---

## Command surface

The raw surface is `tabs`, `bind --page`, `snapshot`, and `run`; close through `webcmd session close`.

Common calls:

1. `webcmd --session <session-id> browser tabs` lists existing pages and is read-only.
2. `webcmd --session <session-id> browser bind --page page-123` is an explicit bind that selects one page.
3. `webcmd --session <session-id> browser snapshot --snapshot-mode act` inspects actionable controls. Use `--snapshot-mode tree` for fuller page structure or `--snapshot-mode read` for readable article/content text.
4. `webcmd --session <session-id> browser run --stdin` runs one JavaScript program with fresh JavaScript scope and persistent browser state in the bound page.
5. `webcmd session close <session-id>` closes the session when finished.

| command | use |
| --- | --- |
| `tabs` | List existing pages. Read-only. |
| `bind --page <id>` | Bind this session to an existing page. |
| `snapshot --snapshot-mode act` | Inspect actionable controls. |
| `snapshot --snapshot-mode tree` | Inspect fuller page structure. |
| `snapshot --snapshot-mode read` | Extract readable article/content text. |
| `run --stdin` / `run --file <path>` | Execute one Playwright-style program with `page`, `context`, `browser`, and `console`. |

Keep related browser actions in one `run` and return compact JSON-compatible data. Successful runs return `snapshotDiff` automatically unless `--no-snapshot-diff` is passed. Do not call the legacy semantic-snapshot page helper; it is not part of Webcmd's Playwright runtime.

Choose diff behavior from the evidence the program returns:

- Pass `--no-snapshot-diff` for research, information retrieval, and deterministic inspection when the returned result already contains the exact bounded evidence needed. This includes navigating to articles or result pages, searching, following read-only pagination, extracting links or table rows, and capturing a response. Navigation alone does not require a diff.
- Keep the automatic diff for exploratory interactions when the resulting UI state is unknown, and for writes such as form submissions, uploads, saves, deletes, or settings changes unless the returned result independently verifies the new state.
- If using `--no-snapshot-diff` after navigation, return identifying context such as the final URL or title together with the targeted evidence. Do not replace a diff with an unbounded body or DOM dump.
- If Webcmd omits a diff because it exceeds the output ceiling, continue when the returned result and page metadata already verify the outcome. Otherwise take a targeted snapshot or extraction; do not request an unscoped full-page dump automatically.

Research with sufficient returned evidence:

```bash
webcmd --session session_abc browser run --stdin --no-snapshot-diff <<'JS'
await page.goto('https://example.com/archive');
const text = await page.locator('main').innerText();
return {
  url: page.url(),
  title: await page.title(),
  matches: text.split('\n').filter(line => line.includes('Quarterfinal')).slice(0, 50),
};
JS
```

Keep the default diff when discovering an unfamiliar state change:

```bash
webcmd --session session_abc browser run --stdin <<'JS'
await page.goto('https://example.com');
await page.getByRole('link', { name: 'More information' }).click();
return { title: await page.title(), url: page.url() };
JS
```

**`browser run` executes in QuickJS — not in Node, and not in the page.** `document` and `window` are not in scope (use `page.evaluate`), and `Buffer`, `require`, and `fs` do not exist. Read [`references/browser-run-playwright.md`](references/browser-run-playwright.md) before writing your first program; it lists what is available, what is blocked, and what to use instead.

---

## Mental model

1. **Adapter first, browser second.** Browser driving is fallback or reconnaissance, not the default execution path.
2. **One run is the unit of action.** Put dependent waits, clicks, fills, and response listeners in the same Playwright program so ordering is deterministic.
3. **Snapshots are observations, not durable handles.** After navigation, form submit, SPA route change, login, or human handoff, take a fresh snapshot before trusting old observations.
4. **Use semantic locators first.** Prefer Playwright `getByRole`, `getByLabel`, `getByText`, and scoped locators before brittle CSS.
5. **Return compact evidence.** Return URL, title, selected text, response URL/status/body sample, or specific field values. Do not dump the whole DOM unless the task truly needs it.
6. **Network evidence beats screen scraping when available.** Attach response listeners before the UI trigger in the same `run`.
7. **Structured warnings matter.** If a timeout warns that side effects may have occurred, inspect state before retrying a write.

---

## Chaining rules

Prefer one `run` over shell-chaining multiple browser calls. It keeps Playwright handles, waits, and response listeners in one ordered program.

Good:

```bash
webcmd --session session_abc browser run --stdin <<'JS'
await page.goto('https://example.com/cart');
const pending = page.waitForResponse(r => r.url().includes('/api/checkout'));
await page.getByRole('button', { name: /checkout/i }).click();
const response = await pending;
return { url: page.url(), status: response.status() };
JS
```

If you split work across calls, use fresh snapshots between page transitions. Do not assume an observation from a prior route is still valid.

---

## Sitemaps

If Webcmd reports sitemap context, load `webcmd-browser-sitemap` before continuing a multi-step site flow. The sitemap is prior context for pages, actions, workflows, APIs, and pitfalls; it is not truth. If the browser disagrees with the sitemap, trust the browser and mark the sitemap stale later.

---

## Recipes

### Authentication and human handoff

If a failure returns `handoff.status === action_required`, stop browser writes. Give the user `handoff.action` and any `Webcmd browser:` or `handoff.viewUrl` link, then wait. After the user reports done, run `handoff.verifyCommand` when present; verification must succeed before retrying.

The handoff is scoped to the Session that started it. Run the returned
`verify_command` or `handoff.verifyCommand` verbatim; it includes `--session`
when applicable. Do not close that Session during the live handoff.

1. On a clear login redirect or auth wall, stop browser writes.
2. If the site exposes a login command, run `webcmd <site> login`.
3. `already_logged_in` is verified; continue.
4. `in_progress` means no current user action, so do not ask the user, wait for confirmation, or poll.
5. `action_required` is a hard stop. Give the user its instructions and any returned `action_url` or `view_url`. If Webcmd returned no URL, use the current visible browser.
6. Never ask for or type passwords, OTPs, recovery codes, cookies, credentials, or session secrets. Never echo or store them.
7. Run the returned `verify_command` or `handoff.verifyCommand` only after the user reports done; verification must succeed before retrying.
8. Without a verifier, take a fresh snapshot and verify the intended identity check or post-action state before any retry, especially for write commands. The user's report alone is not verification.

For CAPTCHA or raw user takeover, stop automation, give the user any viewer URL Webcmd returned, and apply the same verification policy. Keep CAPTCHA outside automated retries.

### Pick from form controls

For native controls, inspect structure first, then use Playwright's normal form APIs inside `run`. Do not guess date formats, option labels, or file constraints from memory; read them from the DOM.

`browser run` uses QuickJS, not Node.js: `Buffer` is unavailable. For an in-memory upload, pass a `Uint8Array`; encode text with the supported `TextEncoder`:

```js
await page.locator('input[type="file"]').setInputFiles({
  name: 'evidence.txt',
  mimeType: 'text/plain',
  buffer: new TextEncoder().encode('file'),
});
```

Inspect the exact accessible name before using `getByLabel`; do not invent punctuation such as a required `*`. After filling a datepicker or masked input, verify `inputValue()` and use the widget UI if the value was cleared or rejected.

```bash
webcmd --session session_abc browser run --stdin <<'JS'
await page.goto('https://example.com/form');
const country = page.locator('select[name="country"]');
return {
  current: await country.inputValue(),
  options: await country.locator('option').evaluateAll(options =>
    options.slice(0, 50).map(option => ({
      label: option.textContent?.trim(),
      value: option.getAttribute('value'),
      selected: option.selected,
    })),
  ),
};
JS
```

For custom React/Radix/shadcn/Material UI dropdowns, use semantic locators and verify the selected visible label after the action. Do not treat them as native `<select>` elements.

### Capture a request triggered by UI

```bash
webcmd --session session_abc browser run --stdin --no-snapshot-diff <<'JS'
await page.goto('https://example.com/search');
const pending = page.waitForResponse(r => r.url().includes('/api/search'));
await page.getByRole('textbox', { name: /search/i }).fill('browser automation');
await page.keyboard.press('Enter');
const response = await pending;
return {
  endpoint: response.url(),
  status: response.status(),
  sample: (await response.text()).slice(0, 2000),
};
JS
```

Use response evidence to choose an adapter strategy later. Do not paste the Playwright program into an adapter.

### Read long-form content

Use `snapshot --snapshot-mode read` first. If the page is an app shell or needs custom scoping, use a targeted `run` with `--no-snapshot-diff` to extract the specific article/main region and return bounded Markdown or text, including the final URL or title.

### Cross-origin iframes

Use `run` and inspect `page.frames()`; target the frame by URL/name and keep iframe actions in the same program. If Chrome cannot expose the frame, bind or navigate directly to the iframe URL when safe.

---

## Pitfalls

- **Do not submit forms via `page.evaluate(() => document.forms[0].submit())`.** Modern sites intercept real click/submit events and silently drop direct DOM submission. Use Playwright locators and verify the post-action state.
- **Do not reuse observations across a page transition.** Navigations, form submits, SPA route changes, login, and human handoff invalidate earlier observations. Take a fresh snapshot.
- **Do not run a trigger before arming the waiter.** If a request matters, create `page.waitForResponse(...)` before the click/fill/keypress that triggers it.
- **Do not trust autocomplete or masked inputs blindly.** Fill/type can appear to work while the app rejects the value. Verify visible text, `inputValue()`, or post-action state.
- **Do not solve CAPTCHA or auth challenges programmatically.** Use human handoff and verification.
- **Do not turn browser-run code into adapter code.** Preserve evidence and behavior; adapters use `IPage`, fetch/intercept helpers, or existing adapter patterns.
- **Screenshots are for humans, not for agents.** Use snapshots or targeted extraction unless the page is genuinely visual: CAPTCHA, charts, icon-only controls, or layout ambiguity.
- **Large DOM/text dumps are usually a bug.** Scope extraction, cap returned fields, and prefer response samples or visible values.
- **Timeouts are ambiguous.** A timeout after a write may have partially succeeded. Inspect before retrying a non-idempotent action.
- **A timeout warns that side effects may have occurred for a reason.** Treat it as unknown state until a fresh observation proves otherwise.
- **Sitemap memory is not ground truth.** If current browser state contradicts sitemap memory, trust the live page.

---

## Troubleshooting

| symptom | fix |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first. Browser commands depend on it; adapter discovery does not. |
| No suitable adapter appears | Confirm registry output was complete and non-truncated before browser fallback. |
| Bound page is wrong or stale | Run `tabs`, choose the current page id, then `bind --page <id>` again. |
| `run` times out before returning | Increase `--timeout` only after checking whether the wait condition is wrong. |
| Write may have happened before timeout | Take a fresh snapshot before retrying. Avoid duplicate submissions. |
| `SESSION_REQUIRED` | Create a Session, then retry with root `--session <session-id>`. |
| `SESSION_BUSY` | Wait for the listed holder; if it is dead, `webcmd session close <session-id> --force` is the last resort. |
| `SESSION_PAUSED_FOR_HUMAN_HANDOFF` | Finish the handoff and run the returned verifier before retrying. |
| Login wall appears | Use the Authentication and human handoff recipe. |
| User reports login complete | Run the returned verifier first. Without one, inspect fresh state and verify identity/post-action state. |
| Page shows expected data but returned extraction is empty | Use `snapshot --snapshot-mode tree` to locate scope, or capture the network response in `run`. |
| Snapshot diff was omitted at the output ceiling | Continue if `result` and `page` are sufficient; otherwise inspect only the relevant scope with a targeted snapshot or extraction. |
| Output is too large | Return fewer fields, slice body/text samples, or switch from DOM dump to targeted selectors/network evidence. |

---

## See also

- `webcmd-adapter-author` — turn a proven workflow into a reusable command.
- `webcmd-browser-sitemap` — consume sitemap context while driving a browser task.
- `webcmd-sitemap-author` — update sitemap knowledge when durable context changes.
- `webcmd-autofix` — repair an existing adapter from retained trace evidence.
