---
name: webcmd-autofix
description: Automatically fix broken Webcmd adapters when commands fail. Load this skill when a webcmd command fails; it guides you through collecting a trace artifact, patching the adapter, retrying, and filing an upstream GitHub issue after a verified fix. Works with any AI agent.
allowed-tools: Bash(webcmd:*), Bash(gh:*), Read, Edit, Write
---

# Webcmd AutoFix - Automatic Adapter Self-Repair

When a `webcmd` command fails because a website changed its DOM, API, or response schema, diagnose, fix the adapter, and retry. Do not only report the error when the failure is repairable.

## Safety Boundaries

Hard stops before any code change:

- **`AUTH_REQUIRED`** (exit code 77): stop. Tell the user to log into the site in Chrome or the webcmd-managed browser profile.
- **`BROWSER_CONNECT`** (exit code 69): stop. Tell the user to run `webcmd doctor`.
- **CAPTCHA / rate limiting / IP block:** stop. This is not an adapter issue.

Scope constraint:

- Modify only the file at `adapterSourcePath` in the trace `summary.md` front matter. That path is authoritative and may be `clis/<site>/...` in the repo or `plugins/<site>/...` in a plugin repo or `~/.webcmd/clis/<site>/...` for user-local installs.
- Never modify `src/`, `extension/`, `tests/`, `package.json`, or `tsconfig.json` during autofix.

Retry budget: maximum **3 repair rounds** per failure. A round is diagnose -> patch -> retry. If 3 rounds do not resolve it, stop and report what was tried.

## Prerequisite

```bash
webcmd doctor
```

This verifies extension and daemon connectivity for browser-dependent repairs.

## When To Use

Use this skill when `webcmd <site> <command>` fails with repairable errors:

- **SELECTOR:** element not found or DOM changed.
- **EMPTY_RESULT:** no data returned and evidence suggests a schema/API drift.
- **API_ERROR / NETWORK:** endpoint moved, params changed, or network contract broke.
- **PAGE_CHANGED:** page structure no longer matches the adapter.
- **COMMAND_EXEC:** runtime error in adapter logic.
- **TIMEOUT:** page loads differently or waits for the wrong signal.

## Before Repair: Empty Does Not Always Mean Broken

`EMPTY_RESULT`, and sometimes a structurally valid selector that returns no rows, may be a real platform answer rather than an adapter bug. Rule this out before a repair round:

- Retry with an alternative query or entry point. If `webcmd reddit search "X"` returns 0 but `webcmd reddit search "X guide"` returns 20, the adapter is likely fine and the first query was too narrow.
- Spot-check in a normal browser tab. If the data is visible there but the adapter is empty, the issue may be auth state, soft blocking, or rate limiting; use `webcmd doctor` or re-login rather than editing source.
- Look for soft 404s. Some platforms return HTTP 200 with an empty payload when an item is hidden, deleted, or temporarily unavailable. A retry after a short wait can distinguish transient hiding from real deletion.
- Treat a successful empty search as an answer. If the adapter reached the endpoint, got HTTP 200, and the platform returned `results: []`, report "no matches" instead of patching.

Proceed only when the empty or missing-selector result is reproducible across retries and alternative entry points.

## Before Repair: An Error Modal Is Not Always the Site's Verdict

Persistent-session adapters (`siteSession: 'persistent'`) share one tab per site, so error text in the body may be inherited or context-scoped rather than real. Before patching code:

- Check the trace screenshot and `location.href`: a modal over a blank page or the wrong URL means the tab carried stale DOM from a previous command, not that the site rejected this request.
- Check session-scoped context: sites often scope results to a selected city, date, or account. A "closed" / "unavailable" verdict can simply mean the browser's selected context does not match the request (for example, a seat layout opened while the site's location cookie points at another city).
- Reproduce in a clean tab (`webcmd browser open <url>`) before trusting the verdict. If it only fails in the adapter's persistent tab, fix state handling (`freshPage: true`, dismiss-and-renavigate, context preconditions) instead of selectors.

## Step 1: Collect Trace Context

Run the failing command with retained trace:

```bash
webcmd <site> <command> [args...] --trace retain-on-failure 2>trace-error.yaml
```

On failure, stderr contains the normal error envelope plus a `trace` block:

```yaml
ok: false
error:
  code: SELECTOR
  message: "Could not find element: .old-selector"
trace:
  schemaVersion: 1
  webcmdVersion: "..."
  traceId: "..."
  dir: "/path/to/.webcmd/profiles/default/traces/..."
  summaryPath: "/path/to/.webcmd/profiles/default/traces/.../summary.md"
  receiptPath: "/path/to/.webcmd/profiles/default/traces/.../receipt.json"
```

Read `summaryPath` first. It is the LLM-oriented entry point and includes:

```yaml
---
schemaVersion: 1
webcmdVersion: "..."
traceId: "..."
status: failure
site: "example"
command: "example/search"
adapterSourcePath: "/path/to/clis/example/search.js"
errorCode: "SELECTOR"
errorMessage: "Could not find element: .old-selector"
---
```

Trace artifacts include:

```text
summary.md
receipt.json
trace.jsonl
network.jsonl
console.jsonl
state/
screenshots/
```

Do not ask the user to rerun with legacy diagnostic environment variables. Trace artifacts are the repair evidence path.

## Step 2: Analyze The Failure

Read the trace summary and adapter source. Classify root cause:

| Error code | Likely cause | Repair strategy |
| --- | --- | --- |
| SELECTOR | DOM restructured or class/id changed | Explore current DOM and find a stable selector |
| EMPTY_RESULT | API response schema changed, data moved, or real empty result | Check network and visible page before patching |
| API_ERROR | Endpoint URL changed or new params required | Discover current API through network evidence |
| AUTH_REQUIRED | Login flow changed or cookies expired | Stop; ask user to log in |
| TIMEOUT | Page loads differently or lazy-load signal changed | Update wait conditions |
| PAGE_CHANGED | Major redesign | May need full adapter rewrite through `webcmd-adapter-author` |

Answer these questions:

1. What is the adapter trying to do? Read `adapterSourcePath`.
2. What did the page look like when it failed? Read `summary.md`, then `state/` if needed.
3. What network requests happened? Read failed network in `summary.md`, then `network.jsonl` if needed.
4. What gap exists between adapter expectations and current page reality?

## Step 3: Explore The Current Website

Use `webcmd browser` to inspect the live site. Do not use the broken adapter for exploration.

For DOM changes:

```bash
webcmd browser open https://example.com/target-page
webcmd browser state
```

For API changes:

```bash
webcmd browser open https://example.com/target-page
webcmd browser state
webcmd browser click <N>
webcmd browser network
webcmd browser network --filter author,text,likes
webcmd browser network --detail <key>
```

Use the `key` field from network output with `--detail`.

## Step 4: Patch The Adapter

Patch only `adapterSourcePath`.

Common fixes:

```js
// Selector update
document.querySelector('.new-class')
```

```js
// Endpoint update
fetch('/api/v2/search')
```

```js
// Response schema update
const items = data.data.items;
```

```js
// Wait condition update
await page.wait({ selector: '[data-loaded="true"]' });
```

Rules:

1. Make minimal changes; do not refactor unrelated code.
2. Keep output structure compatible: `columns` and row keys must remain aligned.
3. Prefer stable API evidence over brittle DOM scraping when discovered.
4. Use only `@agentrhq/webcmd/*` imports; do not add third-party packages.
5. Test after patching.
6. Never relax `verify/<cmd>.json` fixtures to silence a failure. A failing `patterns`, `notEmpty`, `mustNotContain`, or `mustBeTruthy` rule usually means adapter output is wrong. Edit a fixture only when the site itself legitimately changed shape, such as a URL format migration, and note the change in `~/.webcmd/sites/<site>/notes.md`.

## Step 5: Verify The Fix

Run:

```bash
webcmd <site> <command> [args...]
```

If it still fails, collect a fresh trace and start another round. Stop after 3 rounds.

## Step 6: File An Upstream Issue

If the retry passes, prepare an upstream issue so the local fix can flow back to `agentrhq/webcmd`.

Do not file for:

- `AUTH_REQUIRED`, `BROWSER_CONNECT`, `ARGUMENT`, or `CONFIG`
- CAPTCHA or rate limiting
- failures you could not fix

Only file after a verified local fix.

Draft:

```markdown
## Summary
Webcmd autofix repaired this adapter locally, and the retry passed.

## Adapter
- Site: `<site>`
- Command: `<command>`
- Webcmd version: `<version from webcmd --version>`

## Original failure
- Error code: `<error_code>`

~~~
<error_message>
~~~

## Local fix summary

~~~
<1-2 sentence description of what changed and why>
~~~

_Issue filed by Webcmd autofix after a verified local repair._
```

Ask the user before filing. Show the draft title and body. If they approve and `gh auth status` succeeds:

```bash
gh issue create --repo agentrhq/webcmd \
  --title "[autofix] <site>/<command>: <error_code>" \
  --body "<the body above>"
```

If `gh` is unavailable or unauthenticated, tell the user and skip issue creation.

## When To Stop

Hard stops:

- `AUTH_REQUIRED` / `BROWSER_CONNECT`: environment issue, not adapter bug.
- Site requires CAPTCHA.
- Rate limited or IP blocked.

Soft stops:

- 3 repair rounds exhausted.
- Feature completely removed.
- Major redesign requiring `webcmd-adapter-author`.

In all stop cases, clearly report the situation instead of making speculative patches.

## Example Repair Session

```text
1. User runs: webcmd reddit hot
   -> Fails: SELECTOR "Could not find element: .old-post-selector"

2. Agent runs: webcmd reddit hot --trace retain-on-failure 2>trace-error.yaml
   -> Gets trace summary with final state and failed action evidence

3. Agent reads summary/state:
   -> Page loaded, but post cards now use "[data-testid=post-container]"

4. Agent explores:
   -> webcmd browser open https://www.reddit.com && webcmd browser state

5. Agent patches adapterSourcePath:
   -> Replace old selector with stable scoped selector

6. Agent verifies:
   -> webcmd reddit hot
   -> Success: returns hot posts

7. Agent prepares upstream issue draft and asks the user

8. User approves:
   -> gh issue create --repo agentrhq/webcmd --title "[autofix] reddit/hot: SELECTOR" --body "..."
```
