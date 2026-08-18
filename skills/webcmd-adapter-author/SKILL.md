---
name: webcmd-adapter-author
description: Use when writing a Webcmd adapter for a new site or adding a new command to an existing site. Guides end-to-end from first recon through field decoding, adapter coding, and verify. Replaces webcmd-oneshot / webcmd-explorer. For ad-hoc browser driving without an adapter, use webcmd-browser instead; for top-level orientation, use webcmd-usage.
allowed-tools: Bash(webcmd:*), Read, Edit, Write, Grep
---

# Webcmd Adapter Authoring

You are an agent writing an adapter for a site. The goal of this skill is a 30-minute loop from zero context to a passing `webcmd browser verify`.

Use the existing tools throughout: Playwright `browser run` for reconnaissance,
plus `webcmd doctor`, `webcmd browser init`,
and `webcmd browser verify`. Browser-run programs are discovery evidence, not
adapter source.

Browser-profile auth commands must reuse `registerSiteAuthCommands`. Keep only site-specific `verify` and `openLogin` logic in the adapter. The login row must return `action_required` and `verify_command`; after the user reports done, agents run that returned command verbatim (it includes `--session` when applicable), and verification must succeed before retrying the original workflow. Credentials, MFA, and CAPTCHA always use human handoff: CAPTCHA stops automation until the user reports done and verification succeeds, and adapter code must not collect or type passwords or secrets.

Commands whose primary operation searches or discovers matching items from a corpus must set `tags: ['search']`. Add short `keywords` only for non-obvious intent synonyms; do not infer tags from command names alone when authoring new adapters.

When debugging browser-backed adapters, start with `--trace on --keep-tab true --window foreground`. `--trace on` writes a trace artifact every round, and `summary.md` is the entry point for reviewing both failures and successes. `--keep-tab true --window foreground` keeps the tab lease alive and puts the browser window in front so you can inspect the final page state.

---

## Precheck: Know Your Lane

Use `coverage-matrix.md` for a quick self-test before implementation. Ask three questions:

1. Can the data be seen in the browser? If no, solve authentication first.
2. Is the data HTTP, JSON, or HTML? If no, this skill is out of scope.
3. Does the command require real-time push? If yes, look for an HTTP endpoint with the same data; if none exists, stop.

Continue only when all three answers are yes.

---

## Top-Level Decision Tree

**Choose the strategy before writing the adapter.** Every time you reach Step 3 or Step 4, and before writing code, produce a strategy note. Without that note, do not start an adapter file.

The core question is not whether an API is more elegant than DOM work. The core question is whether the data source has an external contract. Public or official interfaces are usually the most stable. UI/DOM semantics often have a user-visible contract too. Undocumented in-site XHR, GraphQL, or signature endpoints drift the most. Do not move a stable UI/DOM implementation to an uncontracted internal endpoint just to be "API-first."

Strategy note template:

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
```

| Strategy | Contract level | Use when | Evidence required |
| --- | --- | --- | --- |
| `PUBLIC_API` | stable | Node-side `fetch` can get target data without login | 200 + JSON/HTML contains target data, not analytics or ads |
| `COOKIE_API` | stable | Node-side `fetch` plus `page.getCookies()` / header helper can get the data | cookie/CSRF source is clear and replay is non-empty |
| `UI_SELECTOR` | visible-ui | publish/upload/click/form flows, or page semantics are more stable than internal APIs | selector has a semantic anchor; failure path is a typed error |
| `DOM_STATE` | visible-ui | data is in hydration state, bootstrap JSON, or SSR HTML | state key, script JSON, or HTML structure is clear |
| `PAGE_FETCH` | internal-unstable | only page-context `fetch` can reuse same-origin/session/runtime state | a browser run returns a non-empty page-context fetch result; explain why the internal endpoint is unavoidable |
| `INTERCEPT` | internal-unstable | request signing is complex but the page can naturally issue the request | target response is captured after triggering UI; explain why UI/DOM is insufficient |

Selection rule: prefer `PUBLIC_API` / `COOKIE_API`. If UI/DOM semantics are stable, do not force an upgrade to `PAGE_FETCH` / `INTERCEPT`. Pay the maintenance cost of uncontracted internal endpoints only when public/official APIs are unavailable and UI/DOM cannot express the target data or operation.

Observed maintenance pattern: `PAGE_FETCH` / `INTERCEPT` fixes are roughly 7-8x as frequent as `PUBLIC_API` fixes, while `UI_SELECTOR` is in the same rough band as `COOKIE_API`. See [`references/strategy-selection.md`](./references/strategy-selection.md) for the ladder, `api_candidates` evidence guidance, and counterexamples such as the booking #1680 case.

Boundary: reuse only data and capabilities the page has already obtained legitimately. Do not teach signature cracking, CAPTCHA bypass, risk-control bypass, or access-control bypass. If a signature cannot be reused safely, such as a runtime-generated page signature that cannot be abstracted, fall back to `UI_SELECTOR`, `DOM_STATE`, or `INTERCEPT`.

```text
Start
  |
  v
webcmd doctor passes?
  | no -> fix the bridge using doctor output
  v yes
Read site memory:
  - webcmd site memory show <site>
  - webcmd site memory list <site>
  - references/site-memory/<site>.md, if present
  |
  | hit endpoint + fields -> jump to endpoint verification
  |                         (do not jump straight to adapter code; memory may be stale)
  | no hit -> continue
  v
Site recon (site-recon.md) -> Pattern A/B/C/D/E
  |
  v
API discovery (api-discovery.md)
  section 1 network -> section 2 state -> section 3 bundle ->
  section 4 token -> section 5 intercept
  |
  v
Candidate endpoint found
  |
  v
Direct fetch verification, even for memory hits
  - 401/403 -> return to section 4 token investigation
  - empty/HTML -> return to site-recon and choose another Pattern
  - site changed -> mark old endpoint stale and return to api-discovery
  |
  v
Field decoding
  - self-explanatory -> use directly
  - known code -> field-conventions.md
  - unknown -> field-decode-playbook.md
  Compare one known field against the visible web page to catch misalignment.
  |
  v
Design columns (output-design.md)
  - names
  - types
  - order
  |
  v
webcmd browser init
  - scaffold <site>/<name>
  - locally, use webcmd adapter path <site>/<name> and edit that local copy
  - in hosted mode, use webcmd adapter source get|put <site>/<name> to edit tenant-owned source
  |
  v
webcmd browser verify
  | fail -> use the autofix skill with --trace retain-on-failure
  v pass
Compare field values against the visible page
  | mismatch -> return to field decoding
  v match
Write site memory with CLI commands
  - site endpoint set|stale
  - site field-map add and site note add
  - site fixture put and site sample add
```

---

## Runbook

Check these off step by step:

[ ] 1. `webcmd doctor` returns "Everything looks good"

[ ] 2. Read site memory:
       [ ] Run `webcmd site memory show <site>` for endpoint and field-map contents, and `webcmd site memory list <site>` for staleness.
       [ ] Does `references/site-memory/<site>.md` exist? If yes, read its "Known endpoints" section.
       [ ] On a hit: **jump to Step 5 endpoint verification + Step 7 field check**, not directly to Step 9 adapter code.
       [ ] If memory is older than 30 days according to `verified_at`, treat it as stale and use the cold-start path through Steps 3 and 4.

[ ] 3. Recon (`site-recon.md`):
       [ ] **Preferred:** create a session, then use `webcmd --session <session-id> browser run --stdin` for navigation, readiness, network hints, and page evidence in one Playwright-style program.
       [ ] Use `webcmd --session <session-id> browser snapshot --snapshot-mode tree` when structural page evidence is needed.
       [ ] Use the run result as reconnaissance evidence; do not copy Playwright code into an adapter.
       [ ] Choose Pattern A / B / C / D / E.

[ ] 4. API discovery (`api-discovery.md`) by Pattern:
       [ ] Pattern A -> section 1 network deep read.
       [ ] Pattern B -> section 2 state extraction + section 1 for deeper data.
       [ ] Pattern C -> section 3 bundle / script src search.
       [ ] Pattern D -> section 4 token source + section 5 fallback.
       [ ] Pattern E -> find an HTTP polling endpoint; use section 5 only if none exists.

[ ] 5. Directly verify the candidate endpoint:
       [ ] Response is 200.
       [ ] Response contains target data, not HTML, ads, or analytics.

[ ] 6. Write the strategy note before code:
       [ ] Choose one of `PUBLIC_API / COOKIE_API / PAGE_FETCH / INTERCEPT / DOM_STATE / UI_SELECTOR`.
       [ ] Fill Contract: `stable / visible-ui / internal-unstable`.
       [ ] Fill Evidence: observed request/state, auth source, replay result.
       [ ] If choosing `PAGE_FETCH` / `INTERCEPT`, explain why `PUBLIC_API`, `COOKIE_API`, `UI_SELECTOR`, and `DOM_STATE` are not suitable.
       [ ] If choosing `UI_SELECTOR` / `DOM_STATE`, do not over-defend why it is not an API; state the semantic anchor and typed-error path.

[ ] 7. Field decoding:
       [ ] Self-explanatory key -> use it directly.
       [ ] Known code -> look it up in `field-conventions.md`.
       [ ] Unknown code -> use `field-decode-playbook.md` (sort-key comparison, structural diff, constant checks).

[ ] 8. Design columns (`output-design.md`):
       [ ] Use camelCase names aligned with neighboring adapters.
       [ ] Make types, units, and percentage format clear.
       [ ] Order: identifier columns -> business numbers -> metadata.

[ ] 9. Write the adapter (`adapter-template.md`):
       [ ] `webcmd browser init <site>/<name>`, then set `strategy: Strategy.<strategy>` in the generated file
       [ ] Locally, run `webcmd adapter path <site>/<name>` and edit that file. In hosted mode, use `webcmd adapter source get <site>/<name>` and `webcmd adapter source put <site>/<name> <path>`.
       [ ] Find the closest same-site or same-type adapter and carry over only the proven mapping.
       [ ] Use only the adapter-compatible path proven in Step 6A; never paste Playwright locators, `waitForResponse`, or browser-run globals into `func`.

[ ] 10. Verification fixtures:
        [ ] After the first passing run, read and save the fixture with `webcmd site fixture get <site>/<name>` and `webcmd site fixture put <site>/<name> <path>`.
        [ ] Tighten the seed by adding `patterns` (URL/date/ID formats), `notEmpty` (core fields), and stricter `rowCount`.
        [ ] Run `webcmd browser verify <site>/<name>` again and confirm it matches the fixture.

[ ] 11. Compare field values against the visible page. Do not stop at "Adapter works!"

[ ] 12. Write site memory after **verify passes and visible-page comparison matches**. See `references/site-memory.md` for schema:
        [ ] Record verified endpoints with `webcmd site endpoint set <site> <name> --url <url> --method <method>`; mark changes with `webcmd site endpoint stale <site> <name>`.
        [ ] Append mappings with `webcmd site field-map add <site> <key> --meaning <meaning> --source <source>` and conclusions with `webcmd site note add <site> --text <markdown>`.
        [ ] Keep the required verify fixture current with `webcmd site fixture get|put <site>/<name>`; it must cover args, rowCount, columns, types, patterns, and notEmpty.
        [ ] Save a sanitized endpoint response with `webcmd site sample add <site>/<name> <path>`.
        [ ] If debugging dumped temporary files in the repo or adapter directory, such as `.dbg-*.html`, `raw-*.json`, or similar, **delete them before commit**. Keep temporary evidence in `/tmp/` and save sanitized samples with `webcmd site sample add`.

[ ] 13. **First command for this site? Stop and ask before building more.**
        [ ] If this was the site's first command, do not silently keep scaffolding more commands. Ask the user what use cases they have in mind for this site — who the persona is, what they're trying to accomplish end to end.
        [ ] From the use cases, propose the full set of commands you'd recommend adding, not just the obvious next one. Cover the whole journey the use cases imply (discovery, single-item detail, comparison, account/write actions, etc.), not only what's cheapest to build.
        [ ] If that set is small (roughly ≤6-8 commands), list it flat and ask the user to confirm or trim it.
        [ ] If it's large, bucket the commands into named groups (e.g. "Discovery", "Single-item evaluation", "Account actions requiring login") and ask the user which bucket(s) to build first — do not dump an unbucketed wall of commands.
        [ ] Flag any bucket that needs a capability not yet solved (login/OTP, write access, payment) as its own decision point — e.g. "these need login — how do you want to handle auth?" — separate from the command list itself.
        [ ] Do not scaffold additional commands until the user has confirmed which ones to build.

---

## Fallback Paths

| Stuck at | Symptom | Go to |
| --- | --- | --- |
| Step 4 API discovery | `network` is empty and `__INITIAL_STATE__` is empty | section 3 bundle search for baseURL |
| | bundle search cannot find baseURL | section 5 intercept |
| Step 5 endpoint verification | 401 / 403 | section 4 token investigation |
| | 200 but response is HTML | return to Step 3 and reassess Pattern |
| | 200 but `data: []` is empty | wrong params or endpoint version changed; return to section 1 and inspect real network headers |
| Step 7 field decoding | sort-key comparison is inconclusive | field-decode-playbook.md section 3 structural diff |
| | still inconclusive | output raw values first, get the adapter running, then iterate |
| Step 10 verify fails | missing filter / wrong field mapping | autofix skill; rerun with `--trace retain-on-failure` |
| | a column is always `null` | field path is wrong; return to Step 7 |
| Step 10 verify fixture mismatch | `[pattern]` row[i] failure | compare visible page value first. If value is right, loosen fixture pattern; if value is wrong, fix mapping |
| | `[column] missing column "X"` | actual response lacks this column due to site change or args; rerun `--update-fixture` or fix adapter |
| | `[type]` actual null / undefined | extraction failed; return to Step 7. Use a `string|null` union only when the value is truly nullable |
| Step 11 values mismatch | value differs by 10,000x | unit mismatch |
| | percentage is 100x too small | response already uses `0.025`; do not multiply by 100 |

---

## Reference Files

| File | When to open |
| --- | --- |
| `references/coverage-matrix.md` | Before implementation: scope self-test |
| `references/site-recon.md` | Step 3: classify site type |
| `references/api-discovery.md` | Step 4: find endpoint |
| `references/strategy-selection.md` | Before Step 6 strategy note: contract model, observed fix frequency, `api_candidates` evidence, counterexamples |
| `references/field-conventions.md` | Step 7: known field-code lookup |
| `references/field-decode-playbook.md` | Step 7: field not in dictionary |
| `references/output-design.md` | Step 8: naming, types, order |
| `references/adapter-template.md` | Step 9: file structure and live example `convertible.js` |
| `references/site-memory.md` | Overview: in-repo seeds plus CLI-managed site memory |
| `references/site-memory/<site>.md` | Step 2: public site knowledge when a seed file exists |
| `references/success-rate-pitfalls.md` | Step 7 / 11: eleven silent failure modes where verify can pass with wrong data, including aria-label locale dependence |
| `references/jsdom-fixture-pattern.md` | When adapter uses DOM extraction inside `page.evaluate` and mocked-evaluate unit tests miss silent bugs; freeze HTML into `plugins/<plugin-name>/__fixtures__/` and run JSDOM with the mandatory `awk 'NF>0'` tightening plus reverse-validation discipline |
| `references/typed-errors.md` | Read before writing `func`: five typed error classes (`ArgumentError`, `EmptyResultError`, `CommandExecutionError`, `AuthRequiredError`, `TimeoutError`) plus fixes for silent anti-patterns (`silent-clamp`, `sentinel-row`, `generic CliError`) |

---

## Key Conventions

- Adapters import only `@agentrhq/webcmd/registry` and `@agentrhq/webcmd/errors`; do not add third-party dependencies.
- Browser-run’s Playwright-style `page` and adapter `func(page,args)` are different contracts. Preserve evidence and behavior, not syntax. Implement adapters with the existing `IPage`, pipeline, Node-fetch, or interceptor APIs.
- The `columns` array and `func` return object keys must match exactly, including order.
- **Intermediate parsing object keys must not overlap any `columns` entry.** Otherwise silent-column-drop audits can misread the adapter. Use dedicated internal names and destructure with aliases when pushing rows.
- **The `browser:` field determines the `func` signature:** `browser:false -> (args)`, `browser:true -> (page, args)`. If this is reversed, `args` may actually be a debug flag and all external parameters can silently fall back to defaults.
- Throw the correct typed error for known failures according to [`references/typed-errors.md`](./references/typed-errors.md). **Do not** silently `return []`, **do not** silently `return [{sentinel}]`, and **do not** silently clamp external parameters with `Math.max/min`.
- **Persistent site sessions keep stale DOM between commands.** `siteSession: 'persistent'` shares one tab per site; leftover modals/drawers from the previous command leak into the next one. State-sensitive write commands (checkout flows) should add `freshPage: true` (new tab, same lease — cookies/login/location survive). Verify session-scoped context (login, selected city/date) *before* side effects, and embed such context in URLs/IDs your command emits for sibling commands. See `references/adapter-template.md` and "Persistent Site Sessions and State Hygiene" in `docs/authoring.mdx`.
- For private iteration, use `webcmd adapter override <site>/<command>`, then locally run `webcmd adapter path <site>/<command>` and edit that file. In hosted mode, `webcmd adapter source get|put <site>/<command>` reads and writes tenant-owned source. Building, testing, and verifying the adapter under private iteration fully satisfies a request to "build a working adapter" on its own. **Do not run `webcmd plugin create` or promote the CLI until the user explicitly confirms they want it pushed into the repo (or a PR raised).** Once confirmed, create the plugin, copy the real command files into it, and delete scaffold sample commands. Do not hand-edit the root `webcmd-plugin.json` or generated README catalog; run `webcmd validate <site>` and smoke commands after installation. See `references/adapter-template.md` for details.
- After `webcmd plugin update`, check the reported overrides needing reconciliation and merge `yours` with `upstream`, using `base` as the common ancestor for a three-way merge. Only overrides are reported; a user-authored adapter has no upstream.
- Write site memory every round: no memory -> use skill -> produce memory -> next time becomes a five-minute task.
- **After a site's first command passes verify, stop and ask the user for their use cases before recommending next set of commands.** See Runbook Step 13.
- **Keep raw debugging dumps in `/tmp/`; save sanitized endpoint samples through `webcmd site sample add <site>/<command> <path>`. Never leave `.dbg-*.html`, `raw-*.json`, `sample.*`, or similar temporary files in the repo root, `plugins/<plugin-name>/`, or the current working directory.**
- **JSDOM unit-test fixtures (`plugins/<plugin-name>/__fixtures__/<command>.html`) are the exception.** They are intentional review artifacts committed to the repo, not temporary dumps. Because of that, the quality bar is higher: complete the five steps in `references/jsdom-fixture-pattern.md`, including the mandatory `awk 'NF>0'` blank-line tightening, and reverse-validate once to prove the regression guard can fail.

---

## If You Are Stuck

- Diagnostic path: `webcmd doctor` -> `webcmd site memory show <site> --kind notes` -> rerun with `--trace retain-on-failure`.
- Endpoint path: return to `site-recon` and reclassify Pattern. Do not stay attached to the first API guess.
- Field path: compare one visible page value, then use sort-key comparison, structural diff, and constants.
- Verification path: if `webcmd browser verify` fails, switch to the autofix skill instead of improvising.
