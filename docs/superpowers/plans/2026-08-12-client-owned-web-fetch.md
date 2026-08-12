# Client-Owned Web Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split `web fetch` / `web fetch-browser` surface with one always-installed, client-owned `web fetch` command whose only stages are native HTTP, Impit Chrome, and Impit Firefox, then teach agents to create a Session and use the existing browser commands explicitly when rendering is required.

**Architecture:** `web/fetch` is registered once in the core registry and parsed once through the normal Commander adapter. The entrypoint intercepts that client-owned command before local discovery or hosted dispatch, while hosted presentation merges the same core metadata into help, list, and completion. The fetch client owns one safe proxy and one deadline across three non-browser transports; Cloud sees the command as `client-owned`/`local-only` and never imports or executes it.

**Tech Stack:** TypeScript, Node.js 20.6+, Commander 14, Undici, Impit 0.14.3, Vitest, the existing Webcmd registry/manifest/hosted-contract generators, and the existing Session plus `browser run` surface.

## Global Constraints

- Implement the approved contract in `docs/superpowers/specs/2026-08-12-client-owned-web-fetch-design.md`.
- Revise PR #295 rather than merging its current auto-escalating implementation. Preserve its useful core-registration, package-export, classifier, and Markdown-rendering work only where it matches this plan.
- Drop PR #295's unrelated `.gitattributes` PNG change from this PR; it can be proposed separately if still needed.
- Rebase the implementation branch onto the branch containing the approved Profile Sessions work in `docs/superpowers/plans/2026-08-11-profile-sessions-concurrency.md` before Task 6. The browser fallback examples intentionally use `session create`, root `--session`, and `session close`; do not document commands that the target release does not ship.
- Work in `/Users/beubax/Desktop/AgentR/OpenCLI` for Tasks 1–6 and 8, and `/Users/beubax/Desktop/AgentR/webcmd-cloud` for Task 7.
- Preserve unrelated user changes. The existing modifications to the Profile Sessions plan/spec and `docs/2026-08-11-profile-sessions-.textClipping` are user-owned; never stage them with this work.
- Add no dependency and no browser helper. Reuse Commander, the registry, Undici, Impit, `session create`, `browser run`, `browser snapshot`, and `session close`.
- `web fetch` never imports or calls `executeCommand`, daemon clients, Cloak, Browser Use, browser allocation code, or browser Session creation.
- Keep exactly these fetch stages, in order: native HTTP, Impit Chrome, Impit Firefox. No automatic retry outside this ladder and no browser stage.
- Keep one deadline and one safe-proxy policy across all stages. Argument, private-address, body-size, and exhausted-deadline failures are terminal.
- Remove `web fetch-browser`, `--browser`, and fetch-specific `--wait` completely. Do not add aliases or deprecations; the auto-escalating release has not shipped.
- `web/fetch` is client-owned in metadata, visible in local and hosted help/list/completion, and excluded from Cloud execution.
- Historical dated plans/specifications may retain old names as history. Active documentation, current skills, generated artifacts, error hints, and the current `search_spec.md` must not contain `fetch-browser`, `web read`, or implicit browser escalation.
- Retain `src/browser/article-extract.ts`, `src/download/article-download.ts`, and their package exports. Caller audit proves that browser snapshots, `src/fetch/extract.ts`, and their focused tests still use them.
- Publish and deploy only after the OpenCLI tarball checks, hosted contract checks, Cloud pin checks, and active-document scan all pass together.

---

## Planned File Map

### OpenCLI core and fetch runtime

- `src/fetch/command.ts`: sole `web/fetch` registration, argument validation, result-to-Markdown renderer, and lazy fetch-client import.
- `src/fetch/client.ts`: native/Chrome/Firefox ladder, shared deadline, transport selection, body bounds, and structured non-browser failures.
- `src/fetch/classify.ts`: status-gated challenge evidence and JavaScript-shell detection.
- `src/fetch/safe-proxy.ts`: private-destination policy signal that the fetch ladder can fail immediately.
- `src/main.ts`: client-owned routing before hosted mode or user-adapter discovery.
- `src/cli.ts`: core command registration through the normal Commander program.
- `src/registry.ts`, `src/commanderAdapter.ts`, `src/output.ts`: command ownership metadata and the existing renderer's small command-supplied Markdown hook.

### Manifest, hosted presentation, and packaging

- `src/manifest-types.ts`, `src/build-manifest.ts`: serialize the core command with `clientOwned: true` and `packageExport: './fetch/command'` without a fake `clis/` path.
- `src/hosted/availability.ts`, `src/hosted/contract.ts`: encode `{ mode: 'local-only', reason: 'client-owned' }`.
- `src/hosted/manifest.ts`, `src/hosted/runner.ts`, `src/hosted/types.ts`, `src/completion-shared.ts`: merge the client-owned core command into hosted presentation without server dispatch.
- `cli-manifest.json`, `hosted-contract.json`: generated artifacts containing exactly one `web/fetch` entry and no `web/fetch-browser`.
- `scripts/check-package-bin.mjs`, `src/package-exports.test.ts`: packed-install discovery/import/execution smoke coverage.

### Removal, skills, and docs

- Delete `clis/web/README.md`, `clis/web/fetch.js`, `clis/web/fetch-browser.js`, and `clis/web/test/fetch-browser.test.js`.
- Delete PR #295's `src/fetch/browser.ts` and `src/fetch/browser.test.ts`; do not move the browser exporter into core.
- Delete `tests/e2e/article-download-pipeline.test.ts`; its `web read` invocation has been vacuous, while shared extraction/download behavior remains covered by `src/browser/article-extract.e2e.test.ts` and `src/download/article-download.test.ts`.
- Update `skills/smart-search/SKILL.md`, `skills/webcmd-browser/SKILL.md`, `docs/cli-reference.mdx`, `docs/superpowers/specs/search_spec.md`, `src/skills.test.ts`, and generated lint baselines.

### Webcmd Cloud

- `docs/superpowers/plans/2026-07-08-webcmd-cloud-global-plan.md`: record `web fetch` as the explicit client-owned exception to server execution and Browser Use as the browser-command backend.
- `tests/default-adapters.test.ts`, `tests/contract-compatibility.test.ts`: prove the pinned package contract excludes `web/fetch` from hosted commands and has no `web/fetch-browser`.
- `package.json`, `package-lock.json`, `Dockerfile`, `.github/workflows/ci.yml`: exact released Webcmd version/SHA pin through the existing bump script; no Cloud loader or embedded-executor feature is added.

---

### Task 1: Replace the Hand-Written Fast Path with the Core Command

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/fetch/command.ts`
- Modify: `src/fetch/command.test.ts`
- Modify: `src/cli.ts`
- Modify: `src/main.ts`
- Modify: `src/registry.ts`
- Modify: `src/commanderAdapter.ts`
- Modify: `src/output.ts`
- Test: `src/commanderAdapter.test.ts`
- Test: `src/hosted/main-lifecycle.test.ts`

**Interfaces:**

- `webFetchCommand` is the only registered `web/fetch` command.
- `webFetchCommand.clientOwned === true`, `browser === false`, and `defaultFormat === 'md'`.
- `formatWebFetchMarkdown(result)` remains the readable default while JSON/YAML/plain/table/csv continue through the shared renderer.
- `src/main.ts` uses the existing root structural parser only to identify `web fetch`; Commander remains the sole parser for its arguments and common options.
- The command module lazily imports `./client.js`, so unrelated CLI startup does not eagerly load Impit or Undici.

- [ ] **Step 1: Add failing canonical-parser tests**

Replace tests of `runClientOwnedWebFetch` with tests that drive `createProgram('', '').parseAsync(...)` or `registerCommandToProgram` and mock `./fetch/client.js` at the module boundary. Cover all of these assertions:

```ts
expect(webFetchCommand).toMatchObject({
  site: 'web',
  name: 'fetch',
  browser: false,
  clientOwned: true,
  defaultFormat: 'md',
});

await program.parseAsync([
  'web', 'fetch',
  '--url=https://example.com',
  '--timeout=9',
  '--max-chars=1200',
  '--allow-private=false',
  '--format=json',
], { from: 'user' });

expect(mockWebFetch).toHaveBeenCalledWith({
  url: 'https://example.com',
  timeoutSeconds: 9,
  maxChars: 1200,
  allowPrivate: false,
});
```

Also assert:

- `web fetch --help` succeeds without `--url`;
- `web fetch --help -f json` uses structured help;
- `--unknown` is rejected by Commander;
- `--timeout nope`, negative timeout, negative max chars, and non-HTTP URLs return `ARGUMENT`;
- `--browser` and `--wait` are unknown;
- `-f md` uses `formatWebFetchMarkdown` and `-f json` returns the structured result;
- both spellings `--format json` and `--format=json` are identical.

Run:

```bash
npx vitest run --project unit src/fetch/command.test.ts src/commanderAdapter.test.ts
```

Expected: FAIL because the current fast path owns a second argv parser and the command has no ownership/custom-Markdown metadata.

- [ ] **Step 2: Make the registry command the sole command grammar**

In `src/fetch/command.ts`, delete `clientOptions(argv)` and `runClientOwnedWebFetch`. Keep one command definition with exactly these args:

```ts
args: [
  { name: 'url', type: 'string', required: true, help: 'HTTP or HTTPS URL to fetch' },
  { name: 'timeout', type: 'int', default: 30, help: 'Total fetch budget in seconds' },
  { name: 'max-chars', type: 'int', default: 50_000, help: 'Maximum extracted characters; 0 disables truncation' },
  { name: 'allow-private', type: 'boolean', default: false, help: 'Allow private and loopback destinations' },
],
```

Use `validateArgs` to require a syntactically valid `http:` or `https:` URL and non-negative integer bounds. Convert the already-coerced kwargs to `WebFetchOptions` in `func`; do not parse strings again. Keep only a type import from `./client.js` at module initialization and use `await import('./client.js')` inside `func`.

Add `clientOwned?: boolean` and `renderMarkdown?: (data: unknown) => string | undefined` to the existing `BaseCliCommand`, copy them through `cli()`, and pass `renderMarkdown` to the existing output renderer from `commanderAdapter.ts`. Add only the corresponding optional `markdown` callback to `RenderOptions`; do not build a second renderer.

- [ ] **Step 3: Register and route the core command before either mode boundary**

Add the side-effect import below near the other core CLI imports:

```ts
import './fetch/command.js';
```

In `src/main.ts`, remove the direct `runClientOwnedWebFetch(argv)` call. Use `parseHostedRootCommandSurface(argv)` in a guarded structural check; if it returns a dispatch whose normalized argv starts with `web`, `fetch`, load `createProgram` and parse the original argv with empty built-in/user adapter directories:

```ts
await createProgram('', '').parseAsync(argv, { from: 'user' });
```

If the structural probe rejects malformed root syntax, fall through to the normal mode path so its existing error handling remains authoritative. Do not copy root-option or fetch-option parsing into `main.ts`.

Add a hosted process test using the existing local HTTP fixture and a hosted config. Invoke:

```text
web fetch --url http://127.0.0.1:<fixture-port>/article --allow-private true -f json
```

Assert success, parsed content, zero requests to the fake Cloud API, and no local adapter-discovery sentinel. Repeat the command in local mode and assert the same result shape.

- [ ] **Step 4: Run the focused tests and commit**

```bash
npx vitest run --project unit src/fetch/command.test.ts src/commanderAdapter.test.ts src/hosted/main-lifecycle.test.ts
npm run typecheck
git add src/fetch/command.ts src/fetch/command.test.ts src/cli.ts src/main.ts src/registry.ts src/commanderAdapter.ts src/output.ts src/commanderAdapter.test.ts src/hosted/main-lifecycle.test.ts
git diff --cached --check
git commit -m "refactor(fetch): route client-owned fetch through core parser"
```

Expected: PASS. `src/fetch/command.ts` contains no argv loop and `src/main.ts` contains no fetch option names.

---

### Task 2: Enforce the Three-Stage Non-Browser Ladder

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/fetch/client.ts`
- Modify: `src/fetch/client.test.ts`
- Modify: `src/fetch/classify.ts`
- Modify: `src/fetch/classify.test.ts`
- Modify: `src/fetch/safe-proxy.ts`
- Modify: `src/fetch/safe-proxy.test.ts`
- Modify: `src/fetch/extract.ts`

**Interfaces:**

- Successful results expose `tier: 'plain' | 'impit'` and `profile?: 'chrome' | 'firefox'`.
- `SafeProxy.policyError()` returns the first private-address policy error observed by the per-invocation proxy, if any.
- Retry eligibility is local to `webFetch`: non-policy transport/TLS failures may advance; `CliError`, deadline exhaustion, body limits, and proxy policy failures do not.
- `FETCH_REQUIRES_BROWSER` and `FETCH_BLOCKED` hints name the explicit Session workflow, never another fetch command.

- [ ] **Step 1: Add the failing ladder and terminal-error matrix**

Expand `src/fetch/client.test.ts` with one table-driven stage recorder and assert:

1. healthy plain response calls no Impit client;
2. plain challenge -> Chrome success;
3. plain challenge -> Chrome challenge -> Firefox success;
4. three challenges -> `FETCH_BLOCKED`;
5. plain transport failure -> Chrome transport failure -> Firefox success;
6. a JavaScript shell at any completed stage -> immediate `FETCH_REQUIRES_BROWSER` and no later stage;
7. `FETCH_BODY_TOO_LARGE`, a proxy policy error, and an exhausted deadline stop immediately;
8. Chrome and Firefox receive decreasing positive timeout values from one deadline;
9. `proxy.close()` runs once on success and every failure;
10. neither browser execution nor hosted configuration is imported or consulted.

Use fake responses and fake clients; no public network call belongs in this unit test. Assert the exact creation order:

```ts
expect(createdProfiles).toEqual(['chrome', 'firefox']);
expect(result).toMatchObject({ tier: 'impit', profile: 'firefox' });
```

Run:

```bash
npx vitest run --project unit src/fetch/client.test.ts
```

Expected: FAIL because native transport errors currently escape immediately and browser hints still name `fetch-browser`.

- [ ] **Step 2: Add private-policy signaling to the existing safe proxy**

Extend `SafeProxy` with `policyError(): Error | undefined`. Record the first error raised by `resolve(...)` in both the HTTP proxy and CONNECT handlers, while preserving the existing 403/connection-close behavior for the transport peer. Do not add an event emitter or a second policy validator.

Add a focused proxy test that sends a request for `127.0.0.1` through a proxy created with `allowPrivate: false`, then asserts `policyError()?.message` contains `Unsafe fetch destination`. Add the corresponding allow-private test asserting the policy slot remains empty.

- [ ] **Step 3: Implement the minimum three-stage loop**

In `webFetch`, keep the existing safe proxy and deadline. Represent the fixed ladder as plain code or a three-item tuple; do not add a transport class/interface. For each stage:

- call `remaining()` immediately before client creation/request;
- after a response or caught transport error, check `proxy.policyError()` first and throw a structured `FETCH_UNSAFE_ADDRESS` error;
- map exhausted/abort timeout to the existing `TimeoutError`;
- rethrow all existing `CliError` instances;
- advance on other fetch/Impit transport failures while a stage remains;
- read the bounded body;
- return `FETCH_REQUIRES_BROWSER` immediately for a JavaScript shell;
- advance on a recognized challenge;
- extract and return the first usable response.

After the Firefox stage, return `FETCH_BLOCKED` when the completed ladder remained challenged. If only transport failures occurred, rethrow the last transport failure without a browser hint.

Use this concise next action for both browser-worthy structured errors:

```text
Create a browser Session with `webcmd --profile work session create`, then navigate with `webcmd --profile work --session <session-id> browser run --stdin`.
```

Update the unsupported-content hint in `src/fetch/extract.ts` to the same explicit workflow only if the error actually means rendered content can help. Do not recommend a browser for DNS, timeout, refused connection, body limit, or private-address policy errors.

- [ ] **Step 4: Status-gate challenge classification**

Add these regressions to `src/fetch/classify.test.ts`:

```ts
expect(isChallengeResponse(200, { 'x-datadome': 'protected' }, '<main>real article</main>')).toBe(false);
expect(isChallengeResponse(200, { 'set-cookie': '__cf_bm=abc' }, '<main>real article</main>')).toBe(false);
expect(isChallengeResponse(200, { 'content-security-policy': 'script-src https://cdnjs.cloudflare.com' }, '<main>ok</main>')).toBe(false);
expect(isChallengeResponse(200, { 'cf-mitigated': 'challenge' }, '')).toBe(true);
expect(isChallengeResponse(403, { server: 'cloudflare' }, 'Just a moment')).toBe(true);
expect(isChallengeResponse(403, {}, 'forbidden')).toBe(false);
```

Implement the smallest classifier that passes:

- `cf-mitigated: challenge` and explicit challenge bodies are decisive;
- Cloudflare/DataDome/PerimeterX/Akamai/CAPTCHA provider evidence is only corroborating on 403, 429, or 503;
- arbitrary CSP, cookies, or a healthy 200 provider header are not challenges.

- [ ] **Step 5: Run the fetch tests and commit**

```bash
npx vitest run --project unit src/fetch/client.test.ts src/fetch/classify.test.ts src/fetch/safe-proxy.test.ts src/fetch/extract.test.ts
npm run typecheck
git add src/fetch/client.ts src/fetch/client.test.ts src/fetch/classify.ts src/fetch/classify.test.ts src/fetch/safe-proxy.ts src/fetch/safe-proxy.test.ts src/fetch/extract.ts
git diff --cached --check
git commit -m "fix(fetch): stop after three non-browser transports"
```

Expected: PASS. A source scan of `src/fetch` finds no `executeCommand`, daemon client, Cloak, Browser Use, `--browser`, or fetch-specific `--wait`.

---

### Task 3: Publish One Core Manifest Entry and Hosted Ownership Contract

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/manifest-types.ts`
- Modify: `src/build-manifest.ts`
- Modify: `src/build-manifest.test.ts`
- Modify: `src/hosted/availability.ts`
- Modify: `src/hosted/availability.test.ts`
- Modify: `src/hosted/contract.ts`
- Modify: `src/hosted/contract.test.ts`
- Modify: `src/package-exports.test.ts`
- Regenerate: `cli-manifest.json`
- Regenerate: `hosted-contract.json`

**Interfaces:**

- `ManifestEntry.clientOwned?: boolean` and `ManifestEntry.packageExport?: string`.
- `HostedContractCommandInput.clientOwned?: boolean`.
- `deriveHostedAvailability({ clientOwned: true })` returns `{ mode: 'local-only', reason: 'client-owned' }` before strategy/domain classification.
- The core build map contains exactly `['web', './fetch/command']` and emits no `modulePath`/`sourceFile` for the core entry.

- [ ] **Step 1: Add failing core-manifest and availability tests**

Assert `coreCommandEntries()` returns one command and that its serialized shape contains:

```ts
expect(entries).toEqual([
  expect.objectContaining({
    site: 'web',
    name: 'fetch',
    clientOwned: true,
    packageExport: './fetch/command',
  }),
]);
expect(entries[0]).not.toHaveProperty('modulePath');
expect(entries[0]).not.toHaveProperty('sourceFile');
```

Assert the hosted contract entry has `sessionPolicy: 'local-only'` and availability reason `client-owned`. Assert ordinary PUBLIC commands remain hosted.

Run:

```bash
npx vitest run --project unit src/build-manifest.test.ts src/hosted/availability.test.ts src/hosted/contract.test.ts src/package-exports.test.ts
```

Expected: FAIL because the current manifest generator scans only `clis/` and has no core ownership fields.

- [ ] **Step 2: Serialize the existing core registration**

Make `toManifestEntry` accept an optional adapter path. Add the fixed core export map and import only `src/fetch/command.ts` when building core entries. Merge core entries with any legacy scan results by canonical command key so one command cannot be emitted twice.

Copy `clientOwned` through `cli()`, `toManifestEntry`, `HostedContractCommandInput`, and `deriveHostedAvailability`. Add the documented `packageExport` field to `ManifestEntry`. Do not teach Cloud to load this export: it exists for package discovery/import verification, while `clientOwned` explicitly forbids Cloud execution.

- [ ] **Step 3: Verify the package export and regenerate artifacts**

Keep the existing `package.json` export:

```json
"./fetch/command": "./dist/src/fetch/command.js"
```

Update `src/package-exports.test.ts` so every manifest entry has either a contained adapter path or a resolvable package export, and assert the `web/fetch` export maps to `src/fetch/command.ts` in source plus `dist/src/fetch/command.js` after build.

Generate the intentional one-for-one replacement:

```bash
npm run build-manifest -- --allow-removals=1
```

Assert with a small Node/Vitest check that both JSON artifacts contain one `web/fetch`, no `web/fetch-browser`, and the ownership/availability fields above.

- [ ] **Step 4: Run contract checks and commit**

```bash
npx vitest run --project unit src/build-manifest.test.ts src/hosted/availability.test.ts src/hosted/contract.test.ts src/package-exports.test.ts
npm run check:hosted-contract
npm run typecheck
git add src/manifest-types.ts src/build-manifest.ts src/build-manifest.test.ts src/hosted/availability.ts src/hosted/availability.test.ts src/hosted/contract.ts src/hosted/contract.test.ts src/package-exports.test.ts cli-manifest.json hosted-contract.json
git diff --cached --check
git commit -m "feat(fetch): publish client-owned core manifest entry"
```

Expected: PASS. The artifacts have one `web/fetch` and no loadable Cloud module path.

---

### Task 4: Keep the Client-Owned Command Visible in Hosted Presentation

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/hosted/types.ts`
- Modify: `src/hosted/manifest.ts`
- Modify: `src/hosted/manifest.test.ts`
- Modify: `src/hosted/runner.ts`
- Modify: `src/hosted/runner.test.ts`
- Modify: `src/completion-shared.ts`
- Modify: `src/hosted/root-command-surface.test.ts`

**Interfaces:**

- `HostedCommand.clientOwned?: boolean` distinguishes client presentation from Cloud execution.
- `withClientOwnedCommands(manifest)` returns a copy containing the core `web/fetch` metadata exactly once.
- Every manifest received from Cloud is contract-validated before the client-owned presentation entry is merged.
- Direct execution still exits through the pre-mode core path from Task 1; the merged entry is never sent to `HostedClient.execute`.

- [ ] **Step 1: Add failing hosted visibility and no-dispatch tests**

Using the existing fake hosted client/manifest fixtures, prove:

- root help contains `web`;
- `web --help` contains `fetch`;
- `web fetch --help` exposes the same four command args as local mode;
- hosted `list -f json` contains one `web/fetch` and does not label it Cloud-executable;
- hosted `--get-completions --cursor 2 web` returns `fetch`;
- merging a Cloud manifest that maliciously/already contains `web/fetch` still yields one client-owned entry;
- executing `web fetch` records zero `getManifest`/`execute` HTTP calls because Task 1 handles it first.

Run:

```bash
npx vitest run --project unit src/hosted/manifest.test.ts src/hosted/runner.test.ts src/hosted/root-command-surface.test.ts
```

Expected: FAIL because hosted presentation currently uses only the tenant Cloud manifest.

- [ ] **Step 2: Merge one local core entry into presentation**

In `src/hosted/manifest.ts`, import `webFetchCommand` and map its serializable fields to `HostedCommand`. Implement `withClientOwnedCommands` by filtering any same canonical command from the server list, then appending the local authoritative entry. Do not load `cli-manifest.json` from disk and do not add a generic plugin merge path.

In `src/hosted/runner.ts`, replace repeated `client.getManifest()` presentation use with one small helper that:

1. gets the tenant manifest;
2. validates contract identity;
3. returns `withClientOwnedCommands(manifest)`.

Use it for hosted list, site/command help, and completions. Keep server execution guarded: if a `clientOwned` command somehow reaches hosted dispatch instead of Task 1, execute it through the local core program or fail an internal invariant before any Cloud execute call; never send it to the server.

Add `web` to `HOSTED_ROOT_HELP.commands` with description `Fetch URLs locally without launching a browser`.

- [ ] **Step 3: Run hosted surface tests and commit**

```bash
npx vitest run --project unit src/hosted/manifest.test.ts src/hosted/runner.test.ts src/hosted/root-command-surface.test.ts src/hosted/main-lifecycle.test.ts
npm run typecheck
git add src/hosted/types.ts src/hosted/manifest.ts src/hosted/manifest.test.ts src/hosted/runner.ts src/hosted/runner.test.ts src/completion-shared.ts src/hosted/root-command-surface.test.ts src/hosted/main-lifecycle.test.ts
git diff --cached --check
git commit -m "fix(hosted): present client-owned web fetch locally"
```

Expected: PASS. Hosted discovery sees the command; hosted execution makes no Cloud request.

---

### Task 5: Delete Browser Fetch and Its Dead Command Pipeline

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Delete: `clis/web/README.md`
- Delete: `clis/web/fetch.js`
- Delete: `clis/web/fetch-browser.js`
- Delete: `clis/web/test/fetch-browser.test.js`
- Delete: `src/fetch/browser.ts` (present on PR #295)
- Delete: `src/fetch/browser.test.ts` (present on PR #295)
- Delete: `tests/e2e/article-download-pipeline.test.ts`
- Modify: `scripts/silent-column-drop-baseline.json`
- Modify: `scripts/typed-error-lint-baseline.json`
- Test: `src/package-exports.test.ts`

**Interfaces:**

- There is no `web/fetch-browser` registration, alias, manifest entry, package export, test, or runtime module.
- Shared article extraction/Markdown/download utilities remain available to fetch extraction and browser snapshots.

- [ ] **Step 1: Add an absence-and-caller-audit test**

Add focused assertions to `src/package-exports.test.ts` that the generated manifest and registered core commands do not contain `web/fetch-browser`, and that `./fetch/command` is the only fetch command package export.

Run the caller audit before deletion:

```bash
rg -n "extractArticle\(|articleHtmlToMarkdown\(|downloadArticle\(" src tests clis
```

Expected: `src/browser/runtime/local-cloak/actions.ts`, `src/fetch/extract.ts`, `src/browser/article-extract*.test.ts`, and `src/download/article-download.test.ts` prove the shared utilities are live.

- [ ] **Step 2: Delete only the obsolete command path**

Delete the listed command/adapter/browser-export files. Remove their exact entries from both lint baseline JSON files. Do not delete:

- `src/browser/article-extract.ts`;
- `src/download/article-download.ts`;
- `src/browser/runtime/local-cloak/actions.ts` readable snapshots;
- their package exports or focused tests.

Delete the real-site `article-download-pipeline` test because it invokes the removed command and silently skips CLI failures. The retained fixture/unit suites cover the shared pipeline deterministically.

- [ ] **Step 3: Run focused shared-utility tests and commit**

```bash
npx vitest run --project unit src/package-exports.test.ts src/browser/article-extract.test.ts src/browser/article-extract.e2e.test.ts src/download/article-download.test.ts src/fetch/extract.test.ts
npm run check:silent-column-drop
npm run check:typed-error-lint
git add -A clis/web src/fetch/browser.ts src/fetch/browser.test.ts tests/e2e/article-download-pipeline.test.ts scripts/silent-column-drop-baseline.json scripts/typed-error-lint-baseline.json src/package-exports.test.ts
git diff --cached --check
git commit -m "refactor(fetch): remove browser-backed fetch command"
```

Expected: PASS. Shared extraction remains green and only the command-specific browser path is gone.

---

### Task 6: Teach the Explicit Session and Browser Workflow

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Dependency:** The Profile Sessions implementation must already provide `session create`, root `--session`, `browser run`, `browser snapshot`, and `session close` in local and hosted modes.

**Files:**

- Modify: `skills/smart-search/SKILL.md`
- Modify: `skills/webcmd-browser/SKILL.md`
- Modify: `docs/cli-reference.mdx`
- Modify: `docs/superpowers/specs/search_spec.md`
- Modify: `src/skills.test.ts`
- Modify only when scan flags active stale text: `README.md`, `docs/**/*.mdx`, `skills/**/*.md`

**Interfaces:**

- Agents try `web fetch` once and branch only on `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER`.
- Browser fallback always creates a Session, carries its complete opaque ID, uses root `--session`, observes with snapshot, and closes the Session.
- Smart-search budgets count browser Sessions/URLs, not browser-fetch commands.

- [ ] **Step 1: Add failing active-guidance tests**

Update `src/skills.test.ts` to assert both bundled skills contain:

```text
webcmd --profile work session create
webcmd --profile work --session session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45 browser run --stdin
webcmd --profile work --session session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45 browser snapshot --snapshot-mode read
webcmd --profile work session close session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45
```

Also assert active skills contain no `fetch-browser`, `web read`, `--browser`, or claim that `web fetch` launches a browser.

Run:

```bash
npx vitest run --project unit src/skills.test.ts
```

Expected: FAIL on the current smart-search/browser-fetch instructions.

- [ ] **Step 2: Replace smart-search browser fetches with Session workflows**

Keep the existing site-named adapter fast path and search budgets. Replace each `web fetch-browser` instruction with:

1. create one Session for the browser portion of the request;
2. navigate the exact failed URL using `browser run`;
3. read it with `browser snapshot --snapshot-mode read` or a targeted `browser run`;
4. reuse that Session for allowed browser fallbacks;
5. close it in cleanup.

Include this complete example in `smart-search` and the browser skill:

```bash
webcmd --profile work session create
# Copy the returned full ID:
# session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45

webcmd --profile work \
  --session session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45 \
  browser run --stdin <<'JS'
await page.goto('https://example.com');
return { url: page.url(), title: await page.title() };
JS

webcmd --profile work \
  --session session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45 \
  browser snapshot --snapshot-mode read

webcmd --profile work session close \
  session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45
```

State mode ownership beside the example: local browser commands use Cloak; hosted browser commands use Webcmd Cloud and Browser Use. `web fetch` itself remains local in both modes.

- [ ] **Step 3: Update active docs and the current search spec**

Rewrite the Search and Fetch section of `docs/cli-reference.mdx`, the `web` row, and the Local/Hosted routing table in `docs/superpowers/specs/search_spec.md`. Remove the old rename/deprecation language because `web read` and `fetch-browser` do not exist in the release.

Run the active-surface scan, excluding historical dated plans/specs and the approved design's removal discussion:

```bash
rg -n "fetch-browser|web read|--browser|implicit.*browser|auto.*escalat" README.md docs skills src \
  -g '!docs/superpowers/plans/**' \
  -g '!docs/superpowers/specs/2026-08-12-client-owned-web-fetch-design.md' \
  -g '!**/*.test.*'
```

Expected after edits: no stale active instruction. Review every match rather than blindly replacing prose.

- [ ] **Step 4: Run docs/skill checks and commit**

```bash
npx vitest run --project unit src/skills.test.ts src/docs-sync-review.test.ts src/docs-sync-review-cli.test.ts
npm run docs-sync-review -- --base HEAD~1
git add skills/smart-search/SKILL.md skills/webcmd-browser/SKILL.md docs/cli-reference.mdx docs/superpowers/specs/search_spec.md src/skills.test.ts README.md docs skills
git diff --cached --check
git commit -m "docs(fetch): require explicit browser sessions after fetch"
```

Before committing, unstage all historical files that did not need an active correction and confirm the cached diff does not include the user-owned Profile Sessions documents.

---

### Task 7: Prove Webcmd Cloud Excludes the Client-Owned Command

**Repository:** `/Users/beubax/Desktop/AgentR/webcmd-cloud`

**Files:**

- Modify: `docs/superpowers/plans/2026-07-08-webcmd-cloud-global-plan.md`
- Modify: `tests/default-adapters.test.ts`
- Modify: `tests/contract-compatibility.test.ts`
- Modify after the OpenCLI package is published: `package.json`
- Modify after the OpenCLI package is published: `package-lock.json`
- Modify after the OpenCLI package is published: `Dockerfile`
- Modify after the OpenCLI package is published: `.github/workflows/ci.yml`

**Interfaces:**

- Cloud's server manifest contains no `web/fetch` and no `web/fetch-browser`.
- The pinned OpenCLI hosted contract contains `web/fetch` only as `{ mode: 'local-only', reason: 'client-owned' }`.
- Cloud does not resolve `packageExport`, import `@agentrhq/webcmd/fetch/command`, set `WEBCMD_EMBEDDED_EXECUTOR`, or add article-worker stdout/materialization special cases.

- [ ] **Step 1: Add failing pinned-contract exclusion tests**

After publishing the OpenCLI release candidate, update the default-adapter assertions to prove:

```ts
const fetchContract = source.hostedContract.commands.find(
  command => command.command === 'web/fetch',
);
expect(fetchContract?.availability).toEqual({
  mode: 'local-only',
  reason: 'client-owned',
});
expect(source.hostedContract.commands.some(
  command => command.command === 'web/fetch-browser',
)).toBe(false);
expect(loadDefaultHostedCommands(source).some(
  command => command.command === 'web/fetch',
)).toBe(false);
```

Build a tenant manifest and assert neither fetch command is advertised. Call the hosted executor with `web/fetch` and assert it cannot resolve a default hosted implementation and imports no package export.

Run:

```bash
npx vitest run tests/default-adapters.test.ts tests/contract-compatibility.test.ts tests/hosted-manifest-executability.test.ts tests/executor-non-browser.test.ts
```

Expected before the dependency pin: FAIL because Cloud still inspects `@agentrhq/webcmd@0.6.0`.

- [ ] **Step 2: Update the Cloud north star without adding runtime code**

Amend the non-negotiable/source-of-truth/parity/repository-boundary sections to state:

- hosted adapters and explicit browser commands execute server-side;
- `web fetch` is the sole client-owned exception and always runs in the installed CLI;
- the released manifest may contain client-owned discovery metadata that Cloud must not advertise or execute;
- explicit hosted browser commands continue through Browser Use;
- there is no embedded core-command executor for fetch.

Replace stale Kernel wording in the touched browser rules with Browser Use where the currently deployed architecture already uses it. Do not rewrite unrelated historical implementation records.

- [ ] **Step 3: Pin the published Webcmd release through the existing script**

From the Cloud repository, run with the exact published version and exact OpenCLI release commit:

```bash
release_version=$(node -p "require('../OpenCLI/package.json').version")
npm run bump:webcmd -- "$release_version" --opencli-dir ../OpenCLI
```

The script reads the exact OpenCLI HEAD, enforces matching exact semver, and updates `package.json`, `package-lock.json`, Dockerfile, and CI provenance together. Do not hand-edit the four pins.

- [ ] **Step 4: Run Cloud tests and commit**

```bash
npx vitest run tests/default-adapters.test.ts tests/contract-compatibility.test.ts tests/hosted-manifest-executability.test.ts tests/executor-non-browser.test.ts
npm run typecheck
npm run build
git add docs/superpowers/plans/2026-07-08-webcmd-cloud-global-plan.md tests/default-adapters.test.ts tests/contract-compatibility.test.ts package.json package-lock.json Dockerfile .github/workflows/ci.yml
git diff --cached --check
git commit -m "chore(fetch): exclude client-owned fetch from cloud runtime"
```

Expected: PASS with no changes to `src/default-adapters/source.ts`, `src/executor/load-command.ts`, or server execution code. Close or supersede webcmd-cloud PR #33 because this feature does not need its package-export loader.

---

### Task 8: Packed Installation, Full Regression, and Release Gate

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `scripts/check-package-bin.mjs`
- Modify: `src/package-exports.test.ts`
- Modify only if CI selection requires it: `vitest.config.ts`

**Interfaces:**

- A fresh installed tarball can import and present `web/fetch` without `clis/`.
- The package smoke test proves behavior rather than only checking file presence/version.

- [ ] **Step 1: Extend the packed-install smoke before rebuilding**

After the existing global tarball install, run the installed binary and assert:

- `web fetch --help` exits 0 and lists `--url`, `--timeout`, `--max-chars`, `--allow-private`;
- `web --help` lists `fetch` and not `fetch-browser`;
- `list -f json` contains exactly one `web/fetch`;
- `--get-completions --cursor 2 web` contains `fetch` and not `fetch-browser`;
- the installed package's exported `dist/src/fetch/command.js` imports successfully through its package export target;
- the packed paths contain no `clis/web/`, `src/fetch/browser`, or fetch-browser artifact.

Use the installed prefix's real package path for the import smoke; do not depend on the developer checkout resolving a global package.
Run every installed-binary smoke with an isolated `HOME`, `USERPROFILE`, and
`WEBCMD_CONFIG_DIR` under the script's temporary directory so the check cannot
read developer adapters/plugins or a real hosted configuration.

Run against the pre-change script once. Expected: FAIL because the current smoke runs only `--version`.

- [ ] **Step 2: Build and run the complete OpenCLI verification matrix**

```bash
npm run build
npm run typecheck
npm run check:package-bin
npm run check:hosted-contract
npm run check:silent-column-drop
npm run check:typed-error-lint
npm run check:plugin-parity
npm test
npm run test:bun
```

Then run the browser routing regressions that prove this change did not alter explicit browser ownership:

```bash
npx vitest run --project unit src/browser/command-catalog.test.ts src/hosted/browser-args.test.ts src/hosted/runner.test.ts
```

Expected: local explicit browser commands retain Cloak routing; hosted explicit browser commands retain Cloud/Browser Use routing; `web fetch` remains non-browser in both.

- [ ] **Step 3: Run final source/artifact invariants**

```bash
node --input-type=module -e "import fs from 'node:fs'; const m=JSON.parse(fs.readFileSync('cli-manifest.json','utf8')); if(m.filter(x=>x.site==='web'&&x.name==='fetch').length!==1||m.some(x=>x.name==='fetch-browser')) process.exit(1)"
rg -n "executeCommand|daemon-client|cloak|Browser Use|fetch-browser|--browser|name: 'wait'" src/fetch
rg -n "fetch-browser|web read|--browser|implicit.*browser|auto.*escalat" README.md docs skills src \
  -g '!docs/superpowers/plans/**' \
  -g '!docs/superpowers/specs/2026-08-12-client-owned-web-fetch-design.md' \
  -g '!**/*.test.*'
```

Expected: the manifest assertion exits 0. The `src/fetch` scan may show shared article-extraction imports but no execution/runtime/browser-command path. The active guidance scan has no stale instruction.

- [ ] **Step 4: Commit the package gate**

```bash
git add scripts/check-package-bin.mjs src/package-exports.test.ts vitest.config.ts
git diff --cached --check
git commit -m "test(fetch): verify packed core command surface"
```

- [ ] **Step 5: Review PR #295 against its issue claims**

Before marking ready, record this evidence in the PR description/comment:

- #246: malformed/missing arguments use the normal structured CLI envelope; no raw Node stack;
- #247: the installed tarball imports the core command from `dist/src` and needs no `clis/`;
- #252/#263: local and hosted help/list/completion expose one client-owned `web/fetch`;
- #264 and classifier half of #283: healthy 200 provider headers no longer trigger false challenges; #265 already owns the safe-proxy close/EPIPE half;
- removed behavior: no auto browser escalation, no `web/fetch-browser`, no embedded Cloud executor;
- Cloud: pinned contract excludes fetch from server manifest/execution while explicit browser commands remain Browser Use-backed.

Do not claim the browser article-export command is preserved; its removal is intentional and approved.

- [ ] **Step 6: Release in dependency order**

1. Merge the revised OpenCLI PR after all OpenCLI checks pass.
2. Publish the exact `@agentrhq/webcmd` version.
3. Execute Task 7's exact Cloud pin and tests.
4. Merge and deploy the Cloud compatibility/docs commit.
5. Run one live hosted smoke: `web fetch` makes no Cloud request, while a created Session plus `browser run` reaches Browser Use.
6. Close superseded PRs #263, #271, and webcmd-cloud #33 with links to the merged replacement and verification evidence.

Do not publish/deploy an intermediate commit where the client advertises Session syntax that the corresponding local/Cloud runtime does not support.

---

## Final Self-Review Checklist

- [ ] Every approved design decision is covered by an implementation task or explicit global constraint.
- [ ] No task adds `browser open`, browser auto-escalation, an embedded core executor, a second argv parser, or a new dependency.
- [ ] Every non-trivial behavior starts with a failing runnable test and names its expected failure.
- [ ] Every command/path/type name matches the current repositories or the approved Profile Sessions plan.
- [ ] `grep -nE 'TO''DO|T''BD|implement ''later' docs/superpowers/plans/2026-08-12-client-owned-web-fetch.md` returns no planning gaps.
- [ ] The staged plan/implementation commits exclude all unrelated user-owned Profile Sessions files.
