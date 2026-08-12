# Profile Sessions and Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an opaque Webcmd Session ID the deterministic browser-workspace and command-admission boundary, while keeping learned adapter commands ergonomic through a system-managed adapter default.

**Architecture:** Raw browser work starts with `session create`, carries the returned immutable ID, and is admitted one top-level execution at a time. Browser-backed adapters may instead resolve the Profile's system-managed adapter-default Session; non-browser adapters allocate none. Locally, a Session owns an exclusive Cloak window group inside one Profile context; Webcmd Cloud keys Browser Use allocations and admission leases by `(userId, workspaceId, profileId, sessionId)`.

**Tech Stack:** TypeScript, Node.js 20.6+, Commander 14, Playwright Core 1.61.1, Cloak Browser package 0.4.5 with Chromium v145.0.7632.109.2, Vitest, PostgreSQL, Browser Use, GCP release gates.

## Global Constraints

- Implement the approved contract in `docs/superpowers/specs/2026-08-11-profile-sessions-concurrency-design.md`; do not reintroduce Spaces.
- Work in `/Users/beubax/Desktop/AgentR/OpenCLI` for CLI/local tasks and `/Users/beubax/Desktop/AgentR/webcmd-cloud` for hosted tasks.
- Preserve unrelated user changes. Before every commit, stage only that task's files and inspect `git diff --cached`.
- Keep `cloakbrowser` exactly pinned to `0.4.5`, Playwright Core exactly pinned to `1.61.1`, and the supported Chromium artifact at v145.0.7632.109.2. Do not add capability/licence fallback branches.
- Add no dependency. Reuse Commander, Playwright/CDP, the local `SessionLeaseRegistry`, the hosted persistent write lease, existing Profile services, existing live-view storage, and existing rendering.
- `--session <session-id>` is a root option. Raw browser commands require an existing opaque ID; omission returns `SESSION_REQUIRED` with exit 2. No PID default, ambient `session use`, caller-chosen name, takeover, complete, or positional compatibility alias is allowed.
- `session create` always returns a new Webcmd-generated ID. `session list` is read-only. `session close` idempotently stops runtime state but preserves the record. Passing an ID is attachment; there is no `session bind` command.
- Non-browser adapters allocate no Session. Browser-backed adapters may omit `--session` and lazily resolve the Profile's one system-managed `adapter-default` Session; an explicit existing ID overrides it.
- Unknown, malformed, or cross-Profile IDs are never created. Malformed selectors are usage errors; unknown/cross-Profile IDs return `SESSION_NOT_FOUND`.
- Session records persist; local pages/windows and hosted allocations do not survive runtime restart or eviction.
- Different Sessions and Profiles run concurrently. A different overlapping execution in the same Session fails immediately with `SESSION_BUSY`; it never waits in a public queue.
- Generate execution IDs only at the trusted top-level CLI/server boundary. Permit re-entry by the same ID; never treat PID, agent identity, or caller-supplied hosted IDs as ownership.
- Local windows never mix Sessions. A Session may own a group of windows because CDP cannot target an existing `windowId`. Manual cross-window tab moves return `SESSION_WINDOW_CONFLICT` without moving or closing the tab.
- All page APIs require both Session and page identity. `browser run` receives a Session-scoped context facade and cannot enumerate, register, or close sibling/keeper pages.
- A human handoff pauses only its owning Session. Its verify command must contain the same Profile and immutable Session ID; sibling Sessions continue.
- Local Profile warm time is the fixed, unreferenced `60_000` ms. Graceful context close is bounded at `3_000` ms before exact Profile recovery. macOS uses a retained hidden target; Linux/Windows park a minimized Profile-owned page because a hidden target alone does not keep Chromium alive at zero windows.
- Hosted mode uses one Browser Use allocation and one live-view URL per active Session. Capacity exhaustion returns `SESSION_CAPACITY_EXCEEDED` with actionable safe counts. Do not implement Webcmd-owned cookie/storage synchronization.
- Roll out the hosted schema and runtime as one drained revision: route the old browser-worker revision to zero, wait at least the existing 45-second lease TTL, then enable Session-keyed browser traffic. Do not run legacy Profile-keyed and new Session-keyed workers concurrently.
- Active docs, help, completion, generated hints, and bundled skills must teach create/carry/list/close, adapter-default routing, and canonical root syntax in the same release. Historical specs remain historical.

---

## Planned File Map

### Webcmd CLI and local runtime

- `src/root-command-surface.ts`: canonical root `--session` parsing for local and hosted dispatch.
- `src/cli-argv-preprocess.ts`: reject retired positional raw-browser syntax with a targeted exit-2 migration error; retain unrelated argv preprocessing.
- `src/cli.ts`, `src/commanderAdapter.ts`: consume the optional root selector and expose `session create`, `session list`, and `session close`.
- `src/hosted/browser-args.ts`, `src/hosted/runner.ts`, `src/hosted/client.ts`, `src/hosted/types.ts`: send the selector for adapter and raw-browser requests and render hosted Session lists.
- `src/browser/sessions.ts`: local persisted opaque Session records, adapter-default resolution, handoff metadata, close state, and public list rows.
- `src/browser/protocol.ts`, `src/browser/runtime/provider.ts`, `src/daemon/server.ts`: resolve a selector before admission, carry immutable Session IDs, expose Session status, and return structured errors.
- `src/execution.ts`, `src/browser/page.ts`, `src/browser/daemon-client.ts`, `src/session-lease.ts`, `src/errors.ts`, `src/main.ts`: top-level run identity, signal/cancel cleanup, Session admission, adapter tab routing, and handoff controls.
- `src/browser/runtime/local-cloak/session-manager.ts`, `src/browser/runtime/local-cloak/actions.ts`, `src/browser/runtime/local-cloak/provider.ts`, `src/browser/run/playwright-transport.ts`, `src/browser/run/runner.ts`: Session window groups, owned tabs, sandbox scoping, platform keepers, Profile idle lifecycle, and Session-scoped actions.
- `src/browser/runtime/local-cloak/process-matcher.ts`: the one exact Cloak Profile process matcher reused by recovery and teardown.
- `tests/e2e/cloak-session-concurrency.test.ts`: live gate for the pinned Cloak/Chromium pair.

### Webcmd Cloud

- `src/domain/types.ts`, `src/sessions/service.ts`: hosted opaque Session create/list/lookup/close and adapter-default resolution.
- `src/storage/schema.sql`, `src/storage/repository.ts`, `src/storage/postgres-repository.ts`: durable Session rows and Session-keyed admission leases; retain the physical `browser_allocations.session_key` column but store immutable Session IDs in it.
- `src/http/router.ts`, `src/executor/non-browser.ts`: expose Session lifecycle routes, accept optional adapter `session`, require raw IDs, mint trusted execution IDs, and route adapters.
- `src/browser/allocation-manager.ts`, `src/browser/dependencies.ts`, `src/browser/runtime.ts`: one durable Browser Use allocation per Session without the current `PROFILE_SESSION_KEY` collapse.
- `src/executor/browser-session-policy.ts`, `src/executor/session-write-lease.ts`, `src/browser/hosted-browser.ts`, `src/browser/session-lock.ts`: Session-keyed adapter tabs, immediate admission, and raw-browser reuse of the same allocation.
- `src/auth/hosted-auth.ts`, `src/account/browser-live-view.ts`, `src/account/live-view.ts`: Session-scoped handoff and exact allocation/view revocation.
- `src/live-gates/browser-use-spike.ts`, `src/live-gates/browser-gates.ts`, `src/live-gates/runner.ts`: concurrent same-Profile persistence and sibling-handoff release gates.

### Active documentation and generated surfaces

- `README.md`, `docs/authentication-and-profiles.mdx`, `docs/browser-and-sitemap-memory.mdx`, `docs/cli-reference.mdx`, `docs/local-or-cloud.mdx`, `docs/x-session-cli.mdx`, and `docs/agents/*.md`: user and harness guidance.
- `skills/webcmd-usage/SKILL.md`, `skills/webcmd-browser/SKILL.md`, `skills/webcmd-autofix/SKILL.md`, `skills/webcmd-adapter-author/SKILL.md`, `skills/webcmd-sitemap-author/SKILL.md`, `skills/webcmd-browser-sitemap/SKILL.md`, plus directly referenced active skill examples: agent instructions.
- `src/completion-shared.ts`, generated hosted contract/manifest artifacts, and their sync tests: canonical discoverability and compatibility.

---

### Task 1: Canonical Root Selector and Raw-Browser Requirement

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/root-command-surface.ts`
- Modify: `src/cli-argv-preprocess.ts`
- Modify: `src/main.ts`
- Modify: `src/cli.ts`
- Modify: `src/commanderAdapter.ts`
- Modify: `src/hosted/browser-args.ts`
- Modify: `src/hosted/runner.ts`
- Modify: `src/hosted/client.ts`
- Modify: `src/hosted/types.ts`
- Test: `src/hosted/root-command-surface.test.ts`
- Test: `src/cli-argv-preprocess.test.ts`
- Test: `src/cli.test.ts`
- Test: `src/hosted/browser-args.test.ts`
- Test: `src/hosted/runner.test.ts`
- Test: `src/hosted/client.test.ts`

**Interfaces:**

- Produces `ROOT_SESSION_FLAGS`, root option `session?: string`, and hosted adapter request field `session?: string`.
- Raw browser dispatch rejects omission before any daemon/cloud call; adapter dispatch leaves omission unresolved for Task 2/Task 7 routing.
- Produces `rejectPositionalBrowserSessionArgv(argv): string[]`, which never rewrites a Session selector, retains the existing trailing-`--window` normalization, or throws `BrowserSessionArgvError`.
- Later tasks consume the selector as an unresolved optional opaque ID; this task does not create Session records.

- [ ] **Step 1: Replace positional-success tests with canonical and migration-error tests**

Add these central assertions and update every existing positional fixture in the listed test files:

```ts
expect(parseHostedRootCommandSurface([
  '--profile', 'work', '--session', 'session_a', 'github', 'issues',
])).toEqual({
  kind: 'dispatch',
  argv: ['github', 'issues'],
  profile: 'work',
  session: 'session_a',
  literal: false,
});

expect(() => rejectPositionalBrowserSessionArgv(['browser', 'session_a', 'run', '--stdin']))
  .toThrowError(/webcmd --session session_a browser run --stdin/);

expect(rejectPositionalBrowserSessionArgv(['--session', 'session_a', 'browser', 'run', '--stdin']))
  .toEqual(['--session', 'session_a', 'browser', 'run', '--stdin']);

expect(() => validateRawBrowserSession(undefined)).toThrowError(
  expect.objectContaining({ code: 'SESSION_REQUIRED', exitCode: 2 }),
);
expect(() => validateRawBrowserSession('work')).toThrowError(
  expect.objectContaining({ code: 'INVALID_SESSION_SELECTOR', exitCode: 2 }),
);
```

For hosted transport, assert both surfaces carry the same selector:

```ts
expect(executeRequest.body).toMatchObject({
  command: 'github/issues',
  session: 'session_a',
});
expect(browserRequest.pathname).toBe('/v1/browser/session_a/commands');
```

- [ ] **Step 2: Run the focused tests and confirm the old grammar still wins**

Run:

```bash
npx vitest run --project unit src/hosted/root-command-surface.test.ts src/cli-argv-preprocess.test.ts src/cli.test.ts src/hosted/browser-args.test.ts src/hosted/runner.test.ts src/hosted/client.test.ts
```

Expected: FAIL because root parsing omits `session`, positional browser argv is rewritten successfully, and hosted adapter requests omit the selector.

- [ ] **Step 3: Add the root option and remove the hidden browser option**

Use the shared root surface as the sole source of truth:

```ts
export const ROOT_SESSION_FLAGS = '--session <session-id>';
export const ROOT_SESSION_DESCRIPTION = 'Existing opaque Session ID from `webcmd session create`';

export function configureRootCommandSurface(program: Command): Command {
  return program
    .version(PKG_VERSION)
    .option(ROOT_PROFILE_FLAGS, ROOT_PROFILE_DESCRIPTION)
    .option(ROOT_SESSION_FLAGS, ROOT_SESSION_DESCRIPTION)
    .enablePositionalOptions();
}
```

Extend `HostedRootCommandSurface` dispatch results with `session?: string`; make `findRootCommandBoundary` consume `--session value` and `--session=value` exactly as it already consumes `--profile`. Remove the hidden browser `--session` option, positional usage override, and positional examples from both `src/cli.ts` and `src/hosted/browser-args.ts`.

- [ ] **Step 4: Replace rewriting with a targeted detector**

Keep `BROWSER_SUBCOMMAND_NAMES`, because it distinguishes `browser run` from the retired `browser session_a run`. Replace only `rewriteBrowserArgv`:

```ts
export function rejectPositionalBrowserSessionArgv(argv: readonly string[]): string[] {
  const result = [...argv];
  const commandIndex = findRootCommandIndex(result, new Set(['--profile', '--session', '--workspace']));
  if (result[commandIndex] !== 'browser') return result;
  const candidate = result[commandIndex + 1];
  if (!candidate || candidate.startsWith('-') || BROWSER_SUBCOMMAND_NAMES.has(candidate)) {
    hoistBrowserWindowOption(result, commandIndex + 1);
    return result;
  }
  const replacement = [
    ...result.slice(0, commandIndex),
    '--session', candidate,
    'browser',
    ...result.slice(commandIndex + 2),
  ];
  throw new BrowserSessionArgvError(
    `Browser sessions are root selectors. Use: webcmd ${replacement.join(' ')}`,
  );
}
```

Retain `hoistBrowserWindowOption` only if canonical tests still require trailing `--window`; otherwise delete it with the positional rewrite. Update `main.ts` and hosted dispatch to call the detector once before Commander parsing. A thrown `BrowserSessionArgvError` must print the replacement and exit `2`.

- [ ] **Step 5: Thread the selector through adapter and browser hosted requests**

In `commanderAdapter.ts`, pass the root global without interpreting it:

```ts
...(typeof globals.session === 'string' && globals.session.trim()
  ? { session: globals.session.trim() }
  : {}),
```

Add `session?: string` to `HostedClient.execute` and `runPreparedExecution`, their JSON validators/types, and `dispatchHosted`. Adapter omission remains omitted. Before local or hosted raw-browser dispatch, call `validateRawBrowserSession`; its `SESSION_REQUIRED` help prints complete `session create` and `session list` commands carrying the selected Profile. Continue using the validated ID in the existing encoded path segment. Do not accept a browser-namespace selector or friendly string.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx vitest run --project unit src/hosted/root-command-surface.test.ts src/cli-argv-preprocess.test.ts src/cli.test.ts src/hosted/browser-args.test.ts src/hosted/runner.test.ts src/hosted/client.test.ts
npm run typecheck
```

Expected: PASS; positional syntax exits 2 with the canonical replacement, raw omission/malformed selectors exit 2 before transport, and adapters may omit the root selector.

Commit:

```bash
git add src/root-command-surface.ts src/cli-argv-preprocess.ts src/main.ts src/cli.ts src/commanderAdapter.ts src/hosted/browser-args.ts src/hosted/runner.ts src/hosted/client.ts src/hosted/types.ts src/hosted/root-command-surface.test.ts src/cli-argv-preprocess.test.ts src/cli.test.ts src/hosted/browser-args.test.ts src/hosted/runner.test.ts src/hosted/client.test.ts
git diff --cached --check
git commit -m "feat: make session a root cli selector"
```

---

### Task 2: Create, Persist, List, and Close Local Sessions

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Create: `src/browser/sessions.ts`
- Create: `src/browser/sessions.test.ts`
- Modify: `src/browser/protocol.ts`
- Modify: `src/browser/runtime/provider.ts`
- Modify: `src/browser/runtime/local-cloak/provider.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/browser/daemon-client.ts`
- Modify: `src/cli.ts`
- Test: `src/daemon/server.test.ts`
- Test: `src/cli.test.ts`

**Interfaces:**

- Produces `BrowserSessionRecord`, `BrowserSessionListRow`, and `LocalBrowserSessionStore`.
- Produces `create(profileId)`, `find(profileId, sessionId)`, `require(profileId, sessionId)`, `resolveAdapterDefault(profileId)`, `list(profileId)`, `markHandoff`, `clearHandoff`, and `touch`.
- Provider produces `resolveSession(command)` before browser dispatch and includes `sessions` in a Profile-filtered status response.

- [ ] **Step 1: Write persistence and resolution tests**

Use a temporary base directory and deterministic dependencies:

```ts
const store = new LocalBrowserSessionStore({
  baseDir,
  now: () => new Date('2026-08-11T00:00:00.000Z'),
  idFactory: () => 'session_11111111-1111-4111-8111-111111111111',
});

const created = store.create('profile_work');
expect(created).toMatchObject({
  id: 'session_11111111-1111-4111-8111-111111111111',
  profileId: 'profile_work',
  kind: 'explicit',
});
expect(store.create('profile_work').id).not.toBe(created.id);
expect(new LocalBrowserSessionStore({ baseDir }).find('profile_work', created.id)?.id)
  .toBe(created.id);
expect(() => store.require('profile_other', created.id)).toThrowError(
  expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
);
const adapterDefault = store.resolveAdapterDefault('profile_work');
expect(adapterDefault.kind).toBe('adapter-default');
expect(store.resolveAdapterDefault('profile_work').id).toBe(adapterDefault.id);
```

At the daemon layer, activate the created Session in a fake manager, close it, and assert `{ closed: true, alreadyIdle: false }`; close it again and assert `{ closed: false, alreadyIdle: true }`. Also assert `list` does not create the adapter default, a caller cannot supply an ID or name to `create`, malformed JSON fails closed with a useful configuration error, the state file is mode `0600`, and a temp file is renamed over the destination.

- [ ] **Step 2: Run tests to verify the store and status fields do not exist**

Run:

```bash
npx vitest run --project unit src/browser/sessions.test.ts src/daemon/server.test.ts src/cli.test.ts
```

Expected: FAIL because `LocalBrowserSessionStore`, Session status, and `session list` are absent.

- [ ] **Step 3: Implement the minimal local store**

Use this exact record shape:

```ts
export interface BrowserSessionRecord {
  id: string;
  profileId: string;
  kind: 'explicit' | 'adapter-default';
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  handoff?: { site: string; expiresAt: string };
}

export interface BrowserSessionListRow extends BrowserSessionRecord {
  runtimeState: 'idle' | 'active';
}
```

Persist `{ version: 1, sessions: BrowserSessionRecord[] }` at `path.join(baseDir ?? getWebcmdConfigDir(), 'browser-sessions.json')`. Generate IDs with `session_${randomUUID()}`. Explicit creation always inserts. Lookup and adapter-default resolution are:

```ts
requireSessionIdShape(sessionId);
const found = sessions.find(row => row.id === sessionId && row.profileId === profileId);
if (!found) throw new SessionNotFoundError(sessionId, profileId);
return touch(found);

const existing = sessions.find(row => row.profileId === profileId && row.kind === 'adapter-default');
return existing ?? insert({ id: idFactory(), profileId, kind: 'adapter-default' });
```

Enforce at most one `adapter-default` record per Profile in memory and during load validation. Runtime active/idle state is derived from the Session manager, not persisted in this file.

Write JSON to `.<basename>.<pid>.<uuid>.tmp` with mode `0600`, then `renameSync`. The daemon is the sole writer, so do not add filesystem locking.

- [ ] **Step 4: Resolve before daemon admission and expose list state**

Extend the provider contract:

```ts
requireSession(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
resolveAdapterDefault(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
listSessions(input: { profileId?: string }): Promise<BrowserSessionListRow[]>;
```

At `/command`, resolve once according to surface, then dispatch an enriched copy:

```ts
const session = body.surface === 'adapter' && !body.session
  ? await provider.resolveAdapterDefault(body)
  : await provider.requireSession(body);
const command = { ...body, sessionId: session.id, sessionKind: session.kind };
```

Do not resolve `lease-release` or Session lifecycle/status controls. Add explicit daemon controls for `session-create`, `session-list`, and `session-close`. Local `runtimeState` is `active` only when the manager owns an open task tab/window for that ID. `session-close` first checks admission/handoff, closes only the Session window group, clears manager metadata, and then marks the durable record idle.

- [ ] **Step 5: Add the three Session lifecycle commands**

Register `session create`, `session list`, and `session close <session-id>` in `cli.ts`. Read the root Profile selector through existing Profile resolution. `create` accepts no name/ID argument. Render the minimal default columns:

```ts
['id', 'kind', 'runtimeState', 'handoff']
```

When the daemon is absent, `create` may start the daemon through the normal mutation path; `list` reads persisted state and reports rows as `idle`; `close` of an idle persisted record succeeds as a no-op. None launches Cloak. Listing must explicitly report zero results and must not create the adapter default. Use the existing renderer and structured error conventions instead of a new formatter.

- [ ] **Step 6: Verify restart persistence and commit**

Run:

```bash
npx vitest run --project unit src/browser/sessions.test.ts src/daemon/server.test.ts src/cli.test.ts
npm run typecheck
```

Expected: PASS; each create returns a unique immutable ID, adapter-default resolution is singleton and lazy, cross-Profile IDs fail, close is idempotent, and list works with or without a running daemon.

Commit:

```bash
git add src/browser/sessions.ts src/browser/sessions.test.ts src/browser/protocol.ts src/browser/runtime/provider.ts src/browser/runtime/local-cloak/provider.ts src/daemon/server.ts src/browser/daemon-client.ts src/cli.ts src/daemon/server.test.ts src/cli.test.ts
git diff --cached --check
git commit -m "feat: persist local browser sessions"
```

---

### Task 3: Make Local Admission and Adapter Routing Session-Scoped

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/session-lease.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/browser/protocol.ts`
- Modify: `src/browser/daemon-client.ts`
- Modify: `src/browser/page.ts`
- Modify: `src/execution.ts`
- Modify: `src/main.ts`
- Modify: `src/errors.ts`
- Test: `src/session-lease.test.ts`
- Test: `src/daemon/server.test.ts`
- Test: `src/browser/daemon-client.test.ts`
- Test: `src/execution.test.ts`

**Interfaces:**

- Consumes immutable `sessionId` from Task 2.
- Produces `getSessionLeaseKey(profileId, sessionId)` and admission for every browser-backed top-level run.
- Produces separate adapter tab identity `(profileId, sessionId, site)` while preserving `siteSession: persistent|ephemeral`.
- Produces tracked cancellation and dead-PID recovery so widening admission does not turn the 45-second TTL into the normal recovery experience.

- [ ] **Step 1: Write admission and routing tests**

Cover the same-ID re-entry, different-ID rejection, same PID rejection, sequential success, and cross-Session parallelism:

```ts
const key = getSessionLeaseKey('profile_work', 'session_a');
expect(registry.acquire({ key, runId: 'run_7_one', command: 'browser/run', pid: 7 }, () => true).acquired)
  .toBe(true);
expect(registry.acquire({ key, runId: 'run_7_one', command: 'browser/tabs', pid: 7 }, () => true).acquired)
  .toBe(true);
expect(registry.acquire({ key, runId: 'run_7_two', command: 'github/issues', pid: 7 }, () => true))
  .toMatchObject({ acquired: false });
expect(registry.acquire({
  key: getSessionLeaseKey('profile_work', 'session_b'),
  runId: 'run_7_two', command: 'github/issues', pid: 7,
}, () => true).acquired).toBe(true);
registry.releaseByRunId('run_7_one');
expect(registry.acquire({ key, runId: 'run_7_three', command: 'browser/run' }, () => false).acquired)
  .toBe(true);
```

Add daemon-level tests where a holder PID becomes dead while work remains. Assert the daemon aborts that run, waits for its operation `finally`, releases, and only then admits the successor; no overlap occurs. Add signal/disconnect tests asserting one best-effort cancel, cleanup on repeated signals, and a busy hint that never recommends killing an already-dead PID.

In `execution.test.ts`, assert persistent tabs for the same site produce different daemon Session IDs when root Sessions differ, while ephemeral tabs are released only inside their owning Session.
Also hold a persistent GitHub adapter in `session_a` and assert an overlapping LinkedIn adapter
in `session_a` receives `SESSION_BUSY`; run LinkedIn in `session_b` and assert it proceeds. This
pins the intentional Session-wide—not `(Session, site)`—admission decision.

- [ ] **Step 2: Run the focused tests and observe Profile/surface-scoped behavior**

Run:

```bash
npx vitest run --project unit src/session-lease.test.ts src/daemon/server.test.ts src/browser/daemon-client.test.ts src/execution.test.ts
```

Expected: FAIL because the lease predicate only covers persistent adapter writes and keys include `surface` plus the adapter-generated site session.

- [ ] **Step 3: Broaden the existing registry instead of adding a queue**

Change the key and predicate:

```ts
export function getSessionLeaseKey(profileId: string, sessionId: string): string {
  return `${profileId}\u241f${sessionId}`;
}

export function isSessionLeaseCommand(command: SessionLeaseCommand): command is SessionLeaseCommand & {
  sessionId: string;
  runId: string;
} {
  return command.action !== 'lease-release'
    && command.action !== 'run-cancel'
    && typeof command.sessionId === 'string'
    && command.sessionId.length > 0
    && typeof command.runId === 'string'
    && command.runId.length > 0;
}
```

Delete `access` from `SessionLeaseCommand`, `DaemonRunContext`, and the daemon predicate; it is currently hardcoded to `write` and gates nothing useful. Acquire after Session resolution and before `provider.dispatch`. On conflict return HTTP 409 with `{ code: 'SESSION_BUSY', session: { id, kind }, holder: { command, pid?, acquiredAt, heartbeatAt } }`; never include `runId`.

- [ ] **Step 4: Mint and propagate one run ID for every browser-backed CLI invocation**

Move `generateRunId()` to the top-level browser-backed branch in `executeCommand`, not the persistent-write branch. Run the complete adapter command inside `runWithDaemonRunContext`, and release by run ID in the existing `finally`. Raw browser actions must use the same wrapper in their Commander action so nested daemon operations re-enter. This is mandatory: changing `isSessionLeaseCommand` alone cannot admit commands that never carry a `runId`.

Hosted callers are unrelated here; do not accept a CLI flag or environment variable as `runId`.

Add a daemon `run-cancel` control backed by an `AbortController` per active run. `main.ts` installs one-shot `SIGINT`/`SIGTERM` cleanup that asks the daemon to cancel the active run and preserves the conventional signal exit. The daemon also cancels on request disconnect. Admission recovery for a dead holder PID calls `cancelAndSettle(runId, 2_000)`; it retries acquisition only after tracked work settles. If it does not settle, return retryable `SESSION_BUSY` and retain the 45-second TTL as the final unknown-outcome path.

- [ ] **Step 5: Separate selected Session from adapter tab lifecycle**

Delete `resolveAdapterBrowserSession(cmd, siteSession)` and today's `site:<site>:<uuid>` Session minting. Pass the optional root ID to `BrowserPage`; the daemon resolves explicit versus adapter-default before constructing the tab key:

```ts
const tabKey = command.surface === 'adapter' && command.siteSession === 'persistent'
  ? `${command.sessionId}\0site:${command.adapterSite}`
  : `${command.sessionId}\0ephemeral:${command.runId}`;
```

Add `adapterSite?: string` to the daemon protocol and set it from `cmd.site` in `execution.ts`. `siteSession` still decides whether release closes the adapter tab. It must never choose the Session admission key.

- [ ] **Step 6: Add consistent typed errors and verify**

Add `SessionRequiredError` (exit 2), `InvalidSessionSelectorError` (exit 2), `SessionNotFoundError` (exit 66), enhance `SessionBusyError` with safe Session ID/kind metadata (exit 75), add `SessionPausedForHumanHandoffError` (exit 77), and `SessionWindowConflictError` (exit 75). Map the same uppercase daemon codes in `daemon-client.ts`. Busy help checks recorded PID liveness before including any kill guidance.

Run:

```bash
npx vitest run --project unit src/session-lease.test.ts src/daemon/server.test.ts src/browser/daemon-client.test.ts src/execution.test.ts
npm run typecheck
```

Expected: PASS; overlapping runs in one Session fail immediately, the same run re-enters, different Sessions progress concurrently, raw commands actually carry run IDs, and killed/timed-out clients do not brick or overlap the Session.

Commit:

```bash
git add src/session-lease.ts src/daemon/server.ts src/browser/protocol.ts src/browser/daemon-client.ts src/browser/page.ts src/execution.ts src/main.ts src/errors.ts src/session-lease.test.ts src/daemon/server.test.ts src/browser/daemon-client.test.ts src/execution.test.ts
git diff --cached --check
git commit -m "feat: admit local browser work by session"
```

---

### Task 4: Enforce Local Page Isolation and Owned Cloak Window Groups

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/browser/runtime/local-cloak/session-manager.ts`
- Modify: `src/browser/runtime/local-cloak/actions.ts`
- Modify: `src/browser/runtime/local-cloak/provider.ts`
- Modify: `src/browser/runtime/local-cloak/darwin-background-launch.ts`
- Modify: `src/browser/run/playwright-transport.ts`
- Modify: `src/browser/run/runner.ts`
- Test: `src/browser/runtime/local-cloak/session-manager.test.ts`
- Test: `src/browser/runtime/local-cloak/browser-run.test.ts`
- Test: `src/browser/runtime/local-cloak/provider.test.ts`
- Test: `src/browser/run/playwright-transport.test.ts`
- Test: `src/browser/run/runner.test.ts`

**Interfaces:**

- Consumes immutable `sessionId` and adapter tab key from Tasks 2-3.
- Produces `SessionRuntime` ownership of `windowIds`, `pages`, and `selectedPageId` under one `ProfileRuntime` context.
- Produces `SESSION_WINDOW_CONFLICT` before any operation on a tab whose actual `windowId` belongs to another Session.
- Produces a Session-scoped Playwright context facade; raw `BrowserContext.pages()` and context-wide page adoption are no longer reachable from `browser run`.

- [ ] **Step 1: Add CDP-backed window ownership tests**

Extend the existing fake context with a browser CDP session that records `Target.createTarget`, `Browser.getWindowForTarget`, and `Target.closeTarget`. Assert:

```ts
const first = await manager.getPage({
  profileId: 'work', sessionId: 'session_a', surface: 'browser',
});
const second = await manager.getPage({
  profileId: 'work', sessionId: 'session_b', surface: 'browser',
});

expect(cdp.sent.filter(call => call.method === 'Target.createTarget')).toEqual([
  expect.objectContaining({ params: expect.objectContaining({ newWindow: true }) }),
  expect.objectContaining({ params: expect.objectContaining({ newWindow: true }) }),
]);
expect(windowIdFor(first.pageId)).not.toBe(windowIdFor(second.pageId));
expect((await manager.listPages({ profileId: 'work', sessionId: 'session_a' }))
  .map(tab => tab.sessionId)).toEqual(['session_a']);
```

Create another tab for `session_a`. Assert its actual window is either an existing `session_a` window or a newly registered `session_a` window, never `session_b`'s. Emit a popup with `opener() === first.page` and assert it inherits `session_a`, including when Chromium gives it a child popup window.

Simulate a manual move by returning `session_b`'s window ID for a `session_a` target. Assert `list`, `select`, `bind`, and `close` reject with `SESSION_WINDOW_CONFLICT`, the page remains open, and neither ownership map changes.

Add the two current escape-path regressions:

```ts
expect(manager.findPageById({ profileId: 'work', sessionId: 'session_a', pageId: pageB }))
  .toBeNull();
await expect(runInSessionA('return (await context.pages()).map(p => p.url())'))
  .resolves.toEqual(['https://a.example/']);
await expect(runInSessionA('await (await context.pages())[1].close()'))
  .rejects.toMatchObject({ code: 'BROWSER_RUN_API_UNSUPPORTED' });
expect(pageB.isClosed()).toBe(false);
```

Replace the provider test that intentionally accepts misleading Session/Profile metadata for
`--page` with a denial test. Create a page in Session B during Session A's `browser run` and
assert the runner never registers it as A.

- [ ] **Step 2: Run the local runtime tests and confirm Profile-global page state fails them**

Run:

```bash
npx vitest run --project unit src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/browser-run.test.ts src/browser/runtime/local-cloak/provider.test.ts
```

Expected: FAIL because `ProfileRuntime` has one global `pages` map/selection, page lookup ignores Session, `context.newPage()` does not establish distinct windows, and `browser run` receives every context page plus a context-wide listener.

- [ ] **Step 3: Replace Profile-global page ownership with Session runtimes**

Use these internal shapes in `session-manager.ts`:

```ts
interface SessionRuntime {
  id: string;
  windowIds: Set<number>;
  pages: Map<string, PageEntry>;
  selectedPageId?: string;
}

interface ProfileRuntime {
  context: BrowserContext;
  cdp: CDPSession;
  sessions: Map<string, SessionRuntime>;
  windowOwners: Map<number, string>;
  targetPages: Map<string, PageEntry>;
  lastSeenAt: number;
}
```

Keep the existing per-Profile `pageCreationQueues`. On the first visible page for a Session, send:

```ts
const { targetId } = await runtime.cdp.send('Target.createTarget', {
  url: 'about:blank',
  newWindow: true,
  background: input.windowMode === 'background',
});
```

Wait for the matching Playwright page, read `Browser.getWindowForTarget({ targetId })`, and register the window only if unowned or already owned by that Session. Add `--disable-popup-blocking` to the Darwin background launch argument list (the custom launcher does not inherit Playwright's switch). Later tabs call `window.open('about:blank', '_blank')` from an owned page while the Profile creation lock is held. Inspect the actual new `windowId`: register it in an existing owned window or add a new unowned window to that Session's group. There is no `windowId` parameter, reparent attempt, detect-and-retry loop, or assumption that the second tab lands in the first window.

- [ ] **Step 4: Register popups and verify ownership before every public action**

Install one manager-owned `context.on('page')` listener for the Profile runtime. Resolve `await page.opener()`, copy a known opener's immutable Session ID, then verify/register the popup target and `windowId`. If a page has no known opener, leave it unowned until a Session-scoped browser-tab bind verifies that its window is unowned or owned by the selected Session. Never install a command-owned context-wide listener.

All methods must take `sessionId`: `listPages`, `findPageById`, `profileIdForPage`, `selectPage`, `bindPage`, `closePage`, `newPage`, and `release`. `pageId` remains an address, never authorization. Store `selectedPageId` only on `SessionRuntime`. Before returning/mutating a page, call one shared guard:

```ts
private async assertOwnedWindow(runtime: ProfileRuntime, sessionId: string, entry: PageEntry): Promise<void> {
  const actual = await this.windowIdForTarget(runtime, entry.targetId);
  const owner = runtime.windowOwners.get(actual);
  if (owner !== undefined && owner !== sessionId) {
    throw new SessionWindowConflictError(entry.pageId, sessionId, owner);
  }
  if (!runtime.sessions.get(sessionId)?.windowIds.has(actual)) {
    throw new SessionWindowConflictError(entry.pageId, sessionId, owner);
  }
}
```

Never close or reassign on this error.

- [ ] **Step 5: Replace the raw BrowserContext with a Session facade**

Change `runBrowserProgram` and `PlaywrightTransport` inputs to consume an explicit scope:

```ts
export interface BrowserRunSessionScope {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  pages(): readonly Page[];
  createPage(): Promise<Page>;
  onPage(listener: (page: Page) => void): () => void;
}
```

Build the Playwright dispatcher with a `scopedContext` implementation proxy. Its `pages()` and
page events use the scope, `newPage()` delegates to manager-owned creation, and `close`, raw
context/browser CDP creation, or any method that can enumerate all targets is denied with
`BROWSER_RUN_API_UNSUPPORTED`. Runner startup registers `scope.pages()` only and unsubscribes
the scoped listener during normal, timeout, and error cleanup. The hidden/parking keeper has no
Session and therefore can never enter the scope.

- [ ] **Step 6: Preserve fresh-page and adapter semantics inside the window group**

For `freshPage`, open and register the replacement in the Session window group first, update that Session's selected and canonical adapter tab entries, then close the old target. `release` closes only ephemeral entries for that Session. Closing the last tab invokes Task 5's keeper transition rather than returning a potentially dying context.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npx vitest run --project unit src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/browser-run.test.ts src/browser/runtime/local-cloak/provider.test.ts src/browser/run/playwright-transport.test.ts src/browser/run/runner.test.ts
npm run typecheck
```

Expected: PASS; two Sessions receive exclusive window groups, tabs/popups stay in their owner, selection/page IDs are scoped, `browser run` cannot see sibling pages, and a manual move is non-destructive.

Commit:

```bash
git add src/browser/runtime/local-cloak/session-manager.ts src/browser/runtime/local-cloak/actions.ts src/browser/runtime/local-cloak/provider.ts src/browser/runtime/local-cloak/darwin-background-launch.ts src/browser/run/playwright-transport.ts src/browser/run/runner.ts src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/browser-run.test.ts src/browser/runtime/local-cloak/provider.test.ts src/browser/run/playwright-transport.test.ts src/browser/run/runner.test.ts
git diff --cached --check
git commit -m "feat: isolate local sessions by cloak window"
```

---

### Task 5: Add Cross-Platform Profile Keepers, Race-Free Lifecycle, and Exact Teardown

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Create: `src/browser/runtime/local-cloak/process-matcher.ts`
- Create: `src/browser/runtime/local-cloak/process-matcher.test.ts`
- Modify: `src/browser/runtime/local-cloak/session-manager.ts`
- Modify: `src/browser/runtime/local-cloak/provider.ts`
- Modify: `src/browser/runtime/local-cloak/darwin-background-launch.ts`
- Test: `src/browser/runtime/local-cloak/session-manager.test.ts`
- Test: `src/browser/runtime/local-cloak/provider.test.ts`
- Test: `src/browser/runtime/local-cloak/darwin-background-launch.test.ts`

**Interfaces:**

- Produces a retained macOS hidden `anchorTargetId` or Linux/Windows Profile-owned parking page, plus one browser CDP session per live Profile runtime.
- Produces a fixed `PROFILE_IDLE_TIMEOUT_MS = 60_000`, `PROFILE_CLOSE_TIMEOUT_MS = 3_000`, and one per-Profile lifecycle lock shared by launch, cancellation, anchor repair, idle close, and recovery.
- Produces `findExactCloakProfileProcesses(userDataDir)` reused by locked-Profile recovery and background teardown.
- Produces shutdown fencing that awaits in-flight Profile launches and prevents late runtime publication.

- [ ] **Step 1: Add platform-keeper, lifecycle-race, and shutdown tests**

Assert the runtime is not published before anchor creation:

```ts
const pending = manager.getPage({ profileId: 'work', sessionId: 'session_a' });
await vi.waitFor(() => expect(cdp.sent).toContainEqual({
  method: 'Target.createTarget',
  params: { url: 'about:blank', hidden: true, background: true },
}));
expect(manager.activeProfileIds()).toEqual([]);
resolveAnchorTarget();
await pending;
expect(manager.activeProfileIds()).toEqual(['work']);
```

With fake time, close the final Session window, advance `59_999` ms, and assert the context remains. Advance one millisecond and assert it is removed from `activeProfileIds()` before `context.close()` begins. Assert the timer's `unref` was called.

For `platform: 'darwin'`, assert the hidden target is retained and never adopted even though the fake Playwright context reports it in `context.pages()`. Assert the browser CDP session is not detached until runtime close. For `linux` and `win32`, assert the final task page is navigated to `about:blank`, removed from Session maps, minimized/parked as Profile-owned, and excluded from list/run APIs. Simulate the user closing that window and assert the next command performs one clean relaunch.

Start a new command at `59_999` ms and assert it cancels eviction and reuses the context. Start a command after close begins and assert it waits, then all simultaneous callers receive one replacement runtime from one launch. Resolve `context.close()` after more than 3 seconds and assert exact recovery runs once before relaunch.

Start `getPage`, hold `launchPersistentContext`, call `shutdown`, then resolve launch. Assert shutdown awaits and closes the late context, `profiles` and `profileLaunches` are empty, and no runtime is published. Assert a post-shutdown call fails deterministically rather than launching.

- [ ] **Step 2: Add exact process-match tests for issue #242**

Use command lines covering equals/separate and quoted values:

```ts
expect(matchCloakProfileCommand(cloak, '/profiles/work')).toBe(true);
expect(matchCloakProfileCommand(cloakSeparate, '/profiles/work')).toBe(true);
expect(matchCloakProfileCommand(cloakQuoted, '/profiles/work')).toBe(true);
expect(matchCloakProfileCommand(cloakWork2, '/profiles/work')).toBe(false);
expect(matchCloakProfileCommand(chromeWork, '/profiles/work')).toBe(false);
expect(matchCloakProfileCommand(`node tool.js --user-data-dir=/profiles/work`, '/profiles/work'))
  .toBe(false);
```

- [ ] **Step 3: Run focused tests and observe final-page context invalidation/races**

Run:

```bash
npx vitest run --project unit src/browser/runtime/local-cloak/process-matcher.test.ts src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/darwin-background-launch.test.ts
```

Expected: FAIL because no keeper/timer exists, close and launch are separate paths, shutdown ignores `profileLaunches`, and the matcher accepts only a substring form.

- [ ] **Step 4: Create and maintain the platform keeper**

Immediately after Cloak launch and before `profiles.set`, obtain `context.browser()`, create `browser.newBrowserCDPSession()`, and send:

```ts
const { targetId: anchorTargetId } = await cdp.send('Target.createTarget', {
  url: 'about:blank',
  hidden: true,
  background: true,
});
```

On macOS, if the pinned runtime returns `null` from `context.browser()` or rejects the hidden target, fail launch and let the live gate block the release. Retain the browser CDP session; do not execute the existing helper's `finally { cdp.detach() }`. Store the anchor outside Session/page maps and filter its target ID before adoption, manager page events, public lists, and runner scopes. If destroyed while healthy, recreate it under the Profile lifecycle lock.

On Linux/Windows, still create/filter the hidden target for uniform ownership bookkeeping, but do not depend on it for liveness. When the final task page would close, navigate that page to `about:blank`, clear captures/listeners, remove it from its Session, record it as `parkingPage`, and minimize its window with `Browser.setWindowBounds` when supported. After a new Session window is successfully registered, close the old parking page. If a user closes it first and Chromium exits, invalidate that exact generation and relaunch on demand.

- [ ] **Step 5: Serialize idle close and relaunch**

Use one `withProfileLifecycleLock(profileId, task)` queue. Add `activeCommands: number` to `ProfileRuntime` and a `runWithProfileActivity(profileId, task)` wrapper: increment/cancel idle before provider dispatch, then decrement/reschedule in `finally`. Accept `hasActiveHandoff(profileId)` as a manager option backed by Task 2's Session store. Schedule eviction only when every Session has zero visible pages, `activeCommands === 0`, and that callback is false. The callback rechecks those conditions, deletes the exact runtime from `profiles`, then awaits:

```ts
await Promise.race([
  runtime.context.close(),
  new Promise<never>((_, reject) => setTimeout(
    () => reject(new Error('Cloak Profile close timed out')),
    PROFILE_CLOSE_TIMEOUT_MS,
  )),
]);
```

On timeout call exact Profile recovery and await it before the lock releases. Guard context `close` events by runtime object identity/generation so an old event cannot delete a replacement. A runtime in `closing` state is removed before close begins and is never returned.

Add `shuttingDown` and a launch-generation fence. `shutdown()` sets the fence first, awaits `Promise.allSettled([...profileLaunches.values()])`, closes every runtime including launches that completed after the snapshot, detaches retained CDP sessions during close, and clears maps only after no launch can reinsert. `launchProfileRuntime` checks the fence immediately before `profiles.set`; if closing began, it closes the candidate and throws `DAEMON_SHUTTING_DOWN`.

- [ ] **Step 6: Extract and reuse the exact matcher**

Move process discovery out of `session-manager.ts`. Recognize a Cloak executable path first, then match only complete `--user-data-dir=/path` or `--user-data-dir /path` arguments, including single/double-quoted values. Both locked-profile recovery and Darwin background teardown call this helper. Session close never calls it.

- [ ] **Step 7: Verify issue #276 cycles and commit**

Run:

```bash
npx vitest run --project unit src/browser/runtime/local-cloak/process-matcher.test.ts src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/provider.test.ts src/browser/runtime/local-cloak/darwin-background-launch.test.ts
npm run typecheck
```

Expected: PASS for repeated release/close/fresh-page/idle cycles, macOS zero-window hidden reuse, Linux/Windows parking-window reuse, accidental keeper close, shutdown during launch, the close/arrival race, and `work` versus `work-2`.

Commit:

```bash
git add src/browser/runtime/local-cloak/process-matcher.ts src/browser/runtime/local-cloak/process-matcher.test.ts src/browser/runtime/local-cloak/session-manager.ts src/browser/runtime/local-cloak/provider.ts src/browser/runtime/local-cloak/darwin-background-launch.ts src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/provider.test.ts src/browser/runtime/local-cloak/darwin-background-launch.test.ts
git diff --cached --check
git commit -m "fix: keep cloak profiles alive between sessions"
```

---

### Task 6: Make Local Authentication Handoff Session-Scoped

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/browser/sessions.ts`
- Modify: `src/browser/protocol.ts`
- Modify: `src/browser/daemon-client.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/execution.ts`
- Modify: `src/plugin-runtime.ts`
- Modify: `src/browser/runtime/local-cloak/session-manager.ts`
- Test: `src/browser/sessions.test.ts`
- Test: `src/daemon/server.test.ts`
- Test: `src/execution.test.ts`
- Test: `src/plugin-runtime.test.ts`

**Interfaces:**

- Consumes local Session records, admission, and Session window foregrounding.
- Produces daemon controls `session-handoff-start` and `session-handoff-clear` owned by the same `runId`.
- Produces an immutable verify command and `SESSION_PAUSED_FOR_HUMAN_HANDOFF` for non-verification work in that Session only.

- [ ] **Step 1: Add two-Session handoff tests**

Execute login under `session_a`, return `action_required`, and assert:

```ts
expect(row.verify_command).toBe(
  "webcmd --profile 'work' --session session_a github whoami",
);
await expect(run({ session: 'session_a', command: 'github/issues' }))
  .rejects.toMatchObject({ code: 'SESSION_PAUSED_FOR_HUMAN_HANDOFF' });
await expect(run({ session: 'session_b', command: 'linkedin/search' })).resolves.toBeDefined();
await expect(run({ session: 'session_a', command: 'github/whoami' })).resolves.toBeDefined();
```

Assert successful `whoami` clears the pause; failed verification retains it; expiry clears it; foregrounding targets only `session_a`'s owned window; the Profile idle timer does not start while a live handoff remains.

- [ ] **Step 2: Run tests and verify current helper returns an unscoped command**

Run:

```bash
npx vitest run --project unit src/browser/sessions.test.ts src/daemon/server.test.ts src/execution.test.ts src/plugin-runtime.test.ts
```

Expected: FAIL because `verify_command` is `webcmd github whoami` and no Session pause exists.

- [ ] **Step 3: Mark handoff after adapter outcome and rewrite the command**

Keep `registerSiteAuthCommands` as the shared login/whoami protocol. In `execution.ts`, after a browser-backed `login` returns its first row, detect `status === 'action_required'`, call `session-handoff-start` with `{ sessionId, site, expiresAt }`, foreground that Session window, and replace only that row's verify command.

Use a small POSIX-safe argument formatter:

```ts
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const verifyCommand = `webcmd --profile ${quote(profileId)} --session ${sessionId} ${cmd.site} whoami`;
```

Session IDs need no quoting; Profile values do. Preserve the existing login result columns.

- [ ] **Step 4: Enforce pause before admission and allow only verification**

After Session resolution but before normal lease acquisition, read its unexpired handoff. Permit only a command marked internally as auth verification with the same Session ID and `${site}/whoami`; reject everything else immediately with `SESSION_PAUSED_FOR_HUMAN_HANDOFF`. Do not use a public flag to mark verification.

On successful `whoami` (`logged_in === true`) call `session-handoff-clear`. Store expiry in the persisted record, clear stale values during resolve/list, and let the existing 60-second Profile lifecycle start only after the last handoff/window/command is gone.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx vitest run --project unit src/browser/sessions.test.ts src/daemon/server.test.ts src/execution.test.ts src/plugin-runtime.test.ts src/browser/runtime/local-cloak/session-manager.test.ts
npm run typecheck
```

Expected: PASS; only the selected Session pauses, verification resumes it, and siblings continue.

Commit:

```bash
git add src/browser/sessions.ts src/browser/protocol.ts src/browser/daemon-client.ts src/daemon/server.ts src/execution.ts src/plugin-runtime.ts src/browser/runtime/local-cloak/session-manager.ts src/browser/sessions.test.ts src/daemon/server.test.ts src/execution.test.ts src/plugin-runtime.test.ts src/browser/runtime/local-cloak/session-manager.test.ts
git diff --cached --check
git commit -m "feat: scope local auth handoff to sessions"
```

---

### Task 7: Create, Persist, List, and Close Hosted Sessions

**Repository:** `/Users/beubax/Desktop/AgentR/webcmd-cloud`

**Files:**

- Create: `src/sessions/service.ts`
- Create: `tests/sessions-service.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/storage/schema.sql`
- Modify: `src/storage/repository.ts`
- Modify: `src/storage/postgres-repository.ts`
- Modify: `src/http/router.ts`
- Test: `tests/schema.test.ts`
- Test: `tests/repository.test.ts`
- Test: `tests/postgres-repository.integration.test.ts`
- Create: `tests/http-sessions.test.ts`

**Interfaces:**

- Produces `WebcmdSession`, `HostedSessionService.create`, `require`, `resolveAdapterDefault`, `list`, and `close`.
- Extends `CloudRepository` with `createSession`, `getSession`, `getOrCreateAdapterDefaultSession`, `listSessions`, `touchSession`, `setSessionHandoff`, and `clearSessionHandoff`.
- Produces `POST /v1/sessions`, `GET /v1/sessions`, and `POST /v1/sessions/:id/close` with exact tenant/Profile scoping.

- [ ] **Step 1: Add schema, repository, and resolver tests**

Use this record shape in tests:

```ts
const session = {
  id: 'session_11111111-1111-4111-8111-111111111111',
  userId: tenant.userId,
  workspaceId: tenant.workspaceId,
  profileId: profile.id,
  kind: 'explicit',
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
  lastUsedAt: '2026-08-11T00:00:00.000Z',
};
```

Assert two concurrent explicit creates return different collision-free IDs; concurrent `getOrCreateAdapterDefaultSession` calls return one `adapter-default` row per Profile; unknown/cross-Profile IDs throw `SESSION_NOT_FOUND`; listing does not create a row; close is idempotent and handoff set/clear is owner-scoped.

For HTTP:

```ts
const response = await fetch(`${baseUrl}/v1/sessions?profile=work`, {
  headers: { authorization: `Bearer ${demoKey}` },
});
expect(await response.json()).toEqual({
  ok: true,
  sessions: [expect.objectContaining({
    id: session.id,
    kind: 'explicit',
    runtimeState: 'idle',
    handoff: null,
  })],
});
```

- [ ] **Step 2: Run tests and confirm no hosted Session entity exists**

Run:

```bash
npx vitest run tests/schema.test.ts tests/repository.test.ts tests/sessions-service.test.ts tests/http-sessions.test.ts tests/postgres-repository.integration.test.ts
```

Expected: FAIL because `webcmd_sessions` and its repository/service/API are absent; PostgreSQL integration skips when `TEST_DATABASE_URL` is unset.

- [ ] **Step 3: Add the table and idempotent migration `0010_profile_sessions`**

Add the base table before browser allocations:

```sql
create table if not exists webcmd_sessions (
  id text primary key,
  user_id text not null,
  workspace_id text not null,
  profile_id text not null,
  kind text not null check (kind in ('explicit', 'adapter-default')),
  handoff_site text,
  handoff_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (user_id, workspace_id, profile_id, id),
  constraint webcmd_sessions_profile_fkey
    foreign key (user_id, workspace_id, profile_id)
    references webcmd_profiles(user_id, workspace_id, id) on delete cascade
);

create unique index if not exists webcmd_sessions_one_adapter_default
  on webcmd_sessions(user_id, workspace_id, profile_id)
  where kind = 'adapter-default';
```

Add a guarded `0010_profile_sessions` block for existing databases that creates the same table/index and records the migration. Do not delete or rewrite current `browser_allocations` rows; they expire through the existing reaper and new code addresses only rows whose `session_key` equals a resolved immutable Session ID.

- [ ] **Step 4: Implement atomic repository semantics**

Define:

```ts
export interface CreateSessionInput {
  tenant: TenantContext;
  profileId: string;
  id: string;
  kind: 'explicit' | 'adapter-default';
}
```

Explicit create uses a plain insert and retries only a generated-ID primary-key collision. Adapter-default resolution runs `insert ... on conflict do nothing returning *`; if no row returns, it selects the existing `kind = 'adapter-default'` row by the full tenant/Profile tuple in the same READ COMMITTED transaction. The partial unique index serializes concurrent inserts. The Profile foreign key validates tenancy. The in-memory repository mirrors both semantics and returns clones.

Handoff updates must require the full tenant/Profile/Session tuple and set both `handoff_site` and `handoff_expires_at`; `clearSessionHandoff` must use the same tuple and may optionally guard the expected site.

- [ ] **Step 5: Implement one lifecycle service**

Use the Profile service before Session lookup. `HostedSessionService` accepts an `idFactory` defaulting to `session_${randomUUID()}` and implements these distinct paths:

```ts
async create(tenant: TenantContext, profile: WebcmdProfile): Promise<WebcmdSession> {
  return this.repository.createSession({
    tenant, profileId: profile.id, id: this.idFactory(), kind: 'explicit',
  });
}

async require(tenant: TenantContext, profile: WebcmdProfile, id: string): Promise<WebcmdSession> {
  requireSessionIdShape(id);
  const found = await this.repository.getSession(tenant, profile.id, id);
  if (!found) throw new PublicHttpError(404, 'SESSION_NOT_FOUND',
    `Session ${id} was not found in Profile ${profile.displayName}.`, undefined, 66);
  return found;
}

async resolveAdapterDefault(tenant: TenantContext, profile: WebcmdProfile): Promise<WebcmdSession> {
  return this.repository.getOrCreateAdapterDefaultSession({
    tenant, profileId: profile.id, id: this.idFactory(), kind: 'adapter-default',
  });
}
```

Clear expired handoff metadata when requiring/listing. `close` rejects busy/handoff ownership, closes the exact allocation through Task 8, clears exact live views, and leaves the durable row intact; list derives `idle` from the absence of an allocation.

- [ ] **Step 6: Add the list endpoint and verify**

`POST /v1/sessions` accepts Profile selection only and rejects a caller-supplied Session ID/name. `GET /v1/sessions` resolves the Profile, lists rows, and joins active allocations by `session_key === session.id`. `POST /v1/sessions/:id/close` is idempotent. Return `runtimeState: 'active'|'idle'` and `handoff: null|{site,expiresAt}`; never expose Browser Use IDs, CDP URLs, or viewer tokens.

Run:

```bash
npx vitest run tests/schema.test.ts tests/repository.test.ts tests/sessions-service.test.ts tests/http-sessions.test.ts tests/postgres-repository.integration.test.ts
npm run typecheck
```

Expected: PASS; explicit creation never collides, adapter-default creation is singleton, close is idempotent, and immutable IDs remain tenant/Profile scoped.

Commit:

```bash
git add src/sessions/service.ts tests/sessions-service.test.ts src/domain/types.ts src/storage/schema.sql src/storage/repository.ts src/storage/postgres-repository.ts src/http/router.ts tests/schema.test.ts tests/repository.test.ts tests/postgres-repository.integration.test.ts tests/http-sessions.test.ts
git diff --cached --check
git commit -m "feat: persist hosted browser sessions"
```

---

### Task 8: Re-key Hosted Admission and Browser Use Allocations by Session

**Repository:** `/Users/beubax/Desktop/AgentR/webcmd-cloud`

**Files:**

- Modify: `src/storage/schema.sql`
- Modify: `src/storage/repository.ts`
- Modify: `src/storage/postgres-repository.ts`
- Modify: `src/executor/session-write-lease.ts`
- Modify: `src/browser/allocation-manager.ts`
- Modify: `src/browser/dependencies.ts`
- Modify: `src/browser/runtime.ts`
- Test: `tests/schema.test.ts`
- Test: `tests/session-write-lease.test.ts`
- Test: `tests/postgres-session-write-leases.integration.test.ts`
- Test: `tests/browser-allocations.test.ts`
- Test: `tests/browser-allocation-manager.test.ts`
- Test: `tests/browser-runtime.test.ts`
- Test: `tests/browser-dependencies.test.ts`

**Interfaces:**

- Consumes immutable hosted Session IDs from Task 7.
- Produces `PersistentSessionWriteLeaseKey { tenant, profileId, sessionId }` and `acquireSessionBrowserLease`.
- Produces one allocation row per Session by storing `sessionId` in existing `browser_allocations.session_key`; removes `PROFILE_SESSION_KEY` and the in-memory one-allocation-per-Profile guard.
- Produces exact Session allocation close and structured `SESSION_CAPACITY_EXCEEDED` translation.

- [ ] **Step 1: Add Session-partitioned lease and allocation tests**

Assert same-Session conflict and sibling success:

```ts
const first = await acquireSessionBrowserLease(repository, {
  key: { tenant, profileId: profile.id, sessionId: 'session_a' },
  ownerExecutionId: 'exec_a', command: 'github/issues', onOwnershipLost,
});
await expect(acquireSessionBrowserLease(repository, {
  key: { tenant, profileId: profile.id, sessionId: 'session_a' },
  ownerExecutionId: 'exec_b', command: 'browser/run', onOwnershipLost,
})).rejects.toMatchObject({ code: 'SESSION_BUSY' });
await expect(acquireSessionBrowserLease(repository, {
  key: { tenant, profileId: profile.id, sessionId: 'session_b' },
  ownerExecutionId: 'exec_b', command: 'browser/run', onOwnershipLost,
})).resolves.toBeDefined();
await first.release();
```

For allocations, concurrently acquire persistent `session_a` and `session_b` under one Profile. Assert `openSession` is called twice, both rows persist, their `browserSessionId` and live URLs differ, reacquiring `session_a` reconnects only its row, and closing `session_a` leaves `session_b` active.

Configure a two-allocation fake quota and request a third Session. Assert the public error is:

```ts
expect(error).toMatchObject({
  code: 'SESSION_CAPACITY_EXCEEDED',
  status: 429,
  details: { active: 2, limit: 2, retryAfterSessionClose: true },
});
```

The hint must include `session list` and `session close <session-id>` and may mention upgrade; it must not expose Browser Use response bodies or allocation IDs.

- [ ] **Step 2: Run focused tests and observe Profile collapse**

Run:

```bash
npx vitest run tests/schema.test.ts tests/session-write-lease.test.ts tests/postgres-session-write-leases.integration.test.ts tests/browser-allocations.test.ts tests/browser-allocation-manager.test.ts tests/browser-runtime.test.ts tests/browser-dependencies.test.ts
```

Expected: FAIL because the lease primary key omits Session, `PROFILE_SESSION_KEY` collapses persistent allocations, and the in-memory repository rejects a second allocation in one Profile.

- [ ] **Step 3: Extend the existing lease key and migration**

Change the contract:

```ts
export interface PersistentSessionWriteLeaseKey {
  tenant: TenantContext;
  profileId: string;
  sessionId: string;
}
```

Add `session_id text not null default 'legacy-profile'` to the base `persistent_session_write_leases` definition. Add a separate idempotent migration `0011_session_browser_leases` that adds the column for existing databases and replaces the primary key with `(user_id, workspace_id, profile_id, session_id)`. Include Session ID in the advisory-lock tuple and every acquire/heartbeat/release/get predicate. Retain the default only for schema compatibility during the drained rollout required by Global Constraints; it does not make mixed old/new browser workers safe.

Rename only TypeScript symbols and public copy to `Session`; keep the physical table name to avoid a second migration. Conflict response is HTTP 409, code `SESSION_BUSY`, exit 75, safe Session ID/kind plus holder command/timestamps, never `ownerExecutionId`.

- [ ] **Step 4: Stop holding admission for the allocation lifetime**

`BrowserAllocationManager` must not acquire or retain the write lease. Admission belongs to the top-level executor/controller in Task 9 and is released at command outcome. Delete `lease` from `Entry`, `#releaseLeftoverLease`, and all Profile-lease cleanup branches. Keep the existing in-process per-key lifecycle lock and Cloud Run's current single-instance allocation ownership assumption; do not add a second distributed ownership service.

- [ ] **Step 5: Remove allocation collapse and duplicate-profile cleanup**

Delete `PROFILE_SESSION_KEY`. In `acquire`, use `input.sessionId` as `sessionKey` for every persistent Session allocation. `#reconnectDurable` queries only `getBrowserAllocation(tenant, profileId, sessionId)` and never scans/discards sibling rows. Remove this in-memory guard:

```ts
browserAllocations.some(allocation =>
  allocation.userId === input.userId
  && allocation.workspaceId === input.workspaceId
  && allocation.profileId === input.profileId
  && allocation.sessionKey !== input.sessionKey)
```

Keep uniqueness of `browserSessionId` and tuple uniqueness. Pass `sessionId` through `RemoteBrowserRuntime.openSession` unchanged.

Add `closeSession(tenant, profileId, sessionId)` under the existing per-key lifecycle lock. It stops and deletes only that durable allocation row and revokes only its views. Translate a provider concurrency/quota response into `SESSION_CAPACITY_EXCEEDED`, deriving safe active/limit counts from Webcmd state/config when available. Do not retry invisibly or collapse the error into `BROWSER_UNAVAILABLE`.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx vitest run tests/schema.test.ts tests/session-write-lease.test.ts tests/postgres-session-write-leases.integration.test.ts tests/browser-allocations.test.ts tests/browser-allocation-manager.test.ts tests/browser-runtime.test.ts tests/browser-dependencies.test.ts
npm run typecheck
```

Expected: PASS; one Session conflicts only with itself and two Browser Use allocations coexist under one Profile.

Commit:

```bash
git add src/storage/schema.sql src/storage/repository.ts src/storage/postgres-repository.ts src/executor/session-write-lease.ts src/browser/allocation-manager.ts src/browser/dependencies.ts src/browser/runtime.ts tests/schema.test.ts tests/session-write-lease.test.ts tests/postgres-session-write-leases.integration.test.ts tests/browser-allocations.test.ts tests/browser-allocation-manager.test.ts tests/browser-runtime.test.ts tests/browser-dependencies.test.ts
git diff --cached --check
git commit -m "feat: key hosted browsers by session"
```

---

### Task 9: Route Hosted Adapters and Raw Browser Commands Through One Session

**Repository:** `/Users/beubax/Desktop/AgentR/webcmd-cloud`

**Files:**

- Modify: `src/http/router.ts`
- Modify: `src/http/execution-artifacts.ts`
- Modify: `src/executor/non-browser.ts`
- Modify: `src/executor/browser-session-policy.ts`
- Modify: `src/browser/hosted-browser.ts`
- Modify: `src/browser/session-lock.ts`
- Modify: `src/browser/dependencies.ts`
- Test: `tests/http-execute.test.ts`
- Test: `tests/http-execution-artifacts.test.ts`
- Test: `tests/http-browser.test.ts`
- Test: `tests/executor-browser-adapter.test.ts`
- Test: `tests/browser-session-policy.test.ts`
- Test: `tests/hosted-browser.test.ts`

**Interfaces:**

- Consumes optional `session` from `/v1/execute` and required raw-browser path IDs, then uses the correct explicit/default/no-Session route.
- Acquires the Task 8 admission lease after the trusted execution row exists and before auth, allocation, CDP, pre-navigation, worker, or adapter work.
- Keys persistent adapter tabs by `(profileId, sessionId, site)` and uses the same Session allocation for raw actions.

- [ ] **Step 1: Add trusted-boundary, no-queue, and cross-surface tests**

Send an execute body containing a fake `executionId` and assert the server ignores/rejects it while minting its own execution. Hold `session_a`, then submit raw browser and adapter commands to it and assert immediate 409 `SESSION_BUSY` with zero Browser Use/worker calls. Submit the same commands to `session_b` and assert they run before `session_a` releases.

Also assert:

- a non-browser adapter with no selector creates no Session, lease, or allocation;
- a non-browser adapter with an explicit ID validates it but still creates no allocation;
- a browser-backed adapter with no selector resolves the singleton adapter-default;
- persistent and ephemeral browser-backed adapters both use that resolved Session;
- raw browser omission never reaches this server path because the CLI rejects it, and a malformed/unknown route ID fails without creation.

Use wall-clock barriers instead of arbitrary sleeps:

```ts
await holderStarted.promise;
const sibling = execute({ profile: 'work', session: 'session_b' });
await expect(Promise.race([sibling, timeoutAfter(250)])).resolves.toBeDefined();
expect(browserUse.createBrowser).toHaveBeenCalledTimes(2);
holderRelease.resolve();
```

Assert adapter `siteSession: 'persistent'` reuses a site tab only within the same immutable Session, while an ephemeral adapter tab closes without stopping the Session allocation.

- [ ] **Step 2: Run tests and confirm the raw queue/profile adapter split**

Run:

```bash
npx vitest run tests/http-execute.test.ts tests/http-execution-artifacts.test.ts tests/http-browser.test.ts tests/executor-browser-adapter.test.ts tests/browser-session-policy.test.ts tests/hosted-browser.test.ts
```

Expected: FAIL because adapter requests have no Session, raw commands use `SessionLockManager.runExclusive` to wait, and adapter manager keys entries by Profile.

- [ ] **Step 3: Parse and resolve selectors at each trusted boundary**

Add `session?: string` validation to `readExecuteRequest`; reject non-string values. Load command metadata before Session allocation. Resolve Profile, then:

```ts
const session = command.browser
  ? request.session
    ? await sessions.require(tenant, profile, request.session)
    : await sessions.resolveAdapterDefault(tenant, profile)
  : request.session
    ? await sessions.require(tenant, profile, request.session)
    : undefined;
```

Only browser-backed work acquires admission/allocation. For prepared executions, persist no caller ownership token: reuse the existing queued execution ID only after `startQueuedExecution` succeeds.

For raw browser paths, require the encoded segment to be an opaque ID, resolve it with `require`, and pass `session.id` plus `session.kind` to `HostedBrowserController`. Never lazily create from the route.

- [ ] **Step 4: Acquire immediate admission once per top-level request**

Wrap both executor and raw controller work:

```ts
const admission = await acquireSessionBrowserLease(repository, {
  key: { tenant, profileId: profile.id, sessionId: session.id },
  ownerExecutionId: execution.id,
  command: canonicalCommand,
  onOwnershipLost: error => executionDeadline.abort(error),
});
try {
  return await runBrowserBackedWork();
} finally {
  await admission.release();
}
```

Acquire after execution creation but before auth/allocation and release only after cleanup reaches a known outcome. Keep unknown-outcome TTL/heartbeat behavior. Delete `SessionLockManager.runExclusive` from the public raw path; either remove the file if unused or reduce it to a non-waiting `tryAcquire` used only for defensive same-execution internals.

- [ ] **Step 5: Key higher-level managers by immutable Session**

Add `session: WebcmdSession` to `OpenBrowserSessionInput` and `HostedAdapterBrowserSessionManager.acquire`. Change its metadata-map key to `JSON.stringify([userId, workspaceId, profileId, session.id])`. Keep only `siteTabs: Map<site, pageId>` and recovered-tab metadata there; do not cache a separate `BrowserSession` wrapper. Each top-level command acquires the current managed allocation handle and releases it after use. `browserUseHostedRuntime` calls allocation acquire with `sessionId: input.session.id`, not `executionId`.

Change `HostedBrowserSessionManager` to the same ID key and likewise cache only selected-tab/display metadata, never a browser wrapper. Raw browser and adapter managers may keep their existing action/tab policies, but both reacquire the current handle from `BrowserAllocationManager`, verify its `browserSessionId` generation before reusing remembered tab IDs, and never create a second allocation for one Session. This prevents one manager from retaining a stale wrapper after the other invalidates the allocation.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx vitest run tests/http-execute.test.ts tests/http-execution-artifacts.test.ts tests/http-browser.test.ts tests/executor-browser-adapter.test.ts tests/browser-session-policy.test.ts tests/hosted-browser.test.ts
npm run typecheck
```

Expected: PASS; Session admission is immediate, trusted, cross-surface, parallel across siblings, and allocated only for commands that actually need browser state.

Commit:

```bash
git add src/http/router.ts src/http/execution-artifacts.ts src/executor/non-browser.ts src/executor/browser-session-policy.ts src/browser/hosted-browser.ts src/browser/session-lock.ts src/browser/dependencies.ts tests/http-execute.test.ts tests/http-execution-artifacts.test.ts tests/http-browser.test.ts tests/executor-browser-adapter.test.ts tests/browser-session-policy.test.ts tests/hosted-browser.test.ts
git diff --cached --check
git commit -m "feat: route hosted commands through sessions"
```

---

### Task 10: Scope Hosted Handoff and Live Views to One Session

**Repository:** `/Users/beubax/Desktop/AgentR/webcmd-cloud`

**Files:**

- Modify: `src/auth/hosted-auth.ts`
- Modify: `src/executor/browser-session-policy.ts`
- Modify: `src/executor/non-browser.ts`
- Modify: `src/browser/hosted-browser.ts`
- Modify: `src/browser/allocation-manager.ts`
- Modify: `src/account/browser-live-view.ts`
- Modify: `src/account/live-view.ts`
- Modify: `src/server.ts`
- Test: `tests/hosted-auth.test.ts`
- Test: `tests/browser-session-policy.test.ts`
- Test: `tests/browser-live-view.test.ts`
- Test: `tests/account-live-view.test.ts`
- Test: `tests/http-execute.test.ts`
- Test: `tests/http-browser.test.ts`

**Interfaces:**

- Consumes persisted `WebcmdSession.handoff*` and one allocation per Session.
- Produces verify commands containing Profile plus immutable Session ID.
- Produces `SESSION_PAUSED_FOR_HUMAN_HANDOFF` only for normal commands in the selected Session and revokes only that Session's view/allocation.

- [ ] **Step 1: Add sibling-handoff and exact-revocation tests**

Start login in `session_a`, capture its view, and assert:

```ts
expect(firstRow(login.result)).toMatchObject({
  status: 'action_required',
  verify_command: "webcmd --profile 'work' --session session_a github whoami",
  view_url: expect.stringContaining('/account/live/'),
});
await expect(execute({ session: 'session_a', command: 'linkedin/search' }))
  .rejects.toMatchObject({ code: 'SESSION_PAUSED_FOR_HUMAN_HANDOFF' });
await expect(execute({ session: 'session_b', command: 'linkedin/search' })).resolves.toBeDefined();
```

Assert `session_b`'s allocation, viewer token, live view, and command usability survive all of: `session_a` successful verification, handoff expiry, explicit allocation invalidation, and server restart/recovery from the stored allocation.

- [ ] **Step 2: Run tests and observe Profile-wide handoff lookup/revocation**

Run:

```bash
npx vitest run tests/hosted-auth.test.ts tests/browser-session-policy.test.ts tests/browser-live-view.test.ts tests/account-live-view.test.ts tests/http-execute.test.ts tests/http-browser.test.ts
```

Expected: FAIL because handoff maps/searches and cleanup are Profile/site scoped, `humanControlledSites` belongs to the Profile entry, and some live-view cleanup calls omit the Browser allocation identity.

- [ ] **Step 3: Make persisted Session state authoritative**

Add `session: WebcmdSession` to `HostedAuthCommandInput`. Key in-memory handoff timing by `[tenant, profile.id, session.id, site]`. Delete `activeProfileHandoff`; replace `activeStoredProfileHandoff` with an exact lookup of `getBrowserAllocation(tenant, profile.id, session.id)`.

On `action_required`, call:

```ts
await repository.setSessionHandoff({
  tenant: input.tenant,
  profileId: input.profile.id,
  sessionId: input.session.id,
  site: login.site,
  expiresAt: capability.expiresAt,
});
```

Successful `whoami` clears exactly that Session. Expiry clears the row, invalidates only its allocation, and revokes only its views. Remove `humanControlledSites`; subsequent requests learn pause state from the resolved Session record.

- [ ] **Step 4: Enforce pause across adapter and raw browser surfaces**

Before admission, reject a live handoff unless the server itself classified the command as the same `${site}/whoami` verification. Raw browser commands have no verification classification and therefore receive `SESSION_PAUSED_FOR_HUMAN_HANDOFF`. Do not accept a client-supplied `allowHumanControlled` or execution owner.

Use code `SESSION_PAUSED_FOR_HUMAN_HANDOFF`, HTTP 409, and exit 77. Return Session ID/kind and expiry but never the sibling view URL or Browser Use identifiers.

- [ ] **Step 5: Generate the scoped verify command**

Use the immutable ID and POSIX-safe Profile quoting:

```ts
function quoteCliArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function verifyCommand(profile: WebcmdProfile, session: WebcmdSession, site: string): string {
  return `webcmd --profile ${quoteCliArg(profile.displayName)} --session ${session.id} ${site} whoami`;
}
```

The existing public workflow stays `login -> human -> returned whoami`; add no takeover/complete route.

- [ ] **Step 6: Revoke live views by exact allocation**

Change `BrowserAllocationLiveViewScope` to carry `browserSessionId` (and optionally `targetUrl`) in addition to tenant/Profile/Session. Every close/reap/stale-row path knows the allocation row and must pass its `browserSessionId`. `LiveViewStore.revokeLiveViews` and `clearBrowserAllocationViewer` must include that ID whenever one allocation closes; only Profile deletion/workspace deletion may omit it and revoke all.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npx vitest run tests/hosted-auth.test.ts tests/browser-session-policy.test.ts tests/browser-live-view.test.ts tests/account-live-view.test.ts tests/http-execute.test.ts tests/http-browser.test.ts
npm run typecheck
```

Expected: PASS; handoff and cleanup affect one Session and sibling allocations continue.

Commit:

```bash
git add src/auth/hosted-auth.ts src/executor/browser-session-policy.ts src/executor/non-browser.ts src/browser/hosted-browser.ts src/browser/allocation-manager.ts src/account/browser-live-view.ts src/account/live-view.ts src/server.ts tests/hosted-auth.test.ts tests/browser-session-policy.test.ts tests/browser-live-view.test.ts tests/account-live-view.test.ts tests/http-execute.test.ts tests/http-browser.test.ts
git diff --cached --check
git commit -m "feat: scope hosted handoff to sessions"
```

---

### Task 11: Advertise Hosted Session Protocol Capability

**Repository:** `/Users/beubax/Desktop/AgentR/webcmd-cloud`

**Files:**

- Modify: `src/domain/types.ts`
- Modify: `src/adapter-packages/manifest-builder.ts`
- Modify: `tests/http-manifest.test.ts`
- Modify: `tests/default-adapters.test.ts`
- Modify: `tests/live-gate-matrix.test.ts`

**Interfaces:**

- Produces `HostedManifestMetadata.sessionProtocolVersion: 1`.
- Does not bump the unrelated hosted adapter contract schema or release-evidence schema.
- Task 12's CLI refuses hosted browser work unless this exact capability is present.

- [ ] **Step 1: Add the manifest capability assertion**

```ts
expect(body.manifest.metadata).toEqual({
  contractSchemaVersion: 1,
  sessionProtocolVersion: 1,
  webcmdPackageVersion: loadDefaultAdapterSource().packageVersion,
  generatedAt: expect.any(String),
});
```

Also assert the release matrix reads the same value from the public manifest.

- [ ] **Step 2: Run focused tests and verify the field is absent**

Run:

```bash
npx vitest run tests/http-manifest.test.ts tests/default-adapters.test.ts tests/live-gate-matrix.test.ts
```

Expected: FAIL because metadata has no Session protocol capability.

- [ ] **Step 3: Add the literal capability and verify**

Extend `HostedManifestMetadata` with `sessionProtocolVersion: 1` and emit the literal from `manifest-builder.ts`. Do not derive it from package version and do not add negotiation branches.

Run:

```bash
npx vitest run tests/http-manifest.test.ts tests/default-adapters.test.ts tests/live-gate-matrix.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/domain/types.ts src/adapter-packages/manifest-builder.ts tests/http-manifest.test.ts tests/default-adapters.test.ts tests/live-gate-matrix.test.ts
git diff --cached --check
git commit -m "feat: advertise hosted session protocol"
```

---

### Task 12: Require the Capability and Finish Hosted CLI Session UX

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/hosted/types.ts`
- Modify: `src/hosted/client.ts`
- Modify: `src/hosted/runner.ts`
- Modify: `src/hosted/manifest.ts`
- Modify: `src/completion-shared.ts`
- Modify: `src/hosted/contract.ts`
- Modify: `src/build-manifest.ts`
- Test: `src/hosted/client.test.ts`
- Test: `src/hosted/runner.test.ts`
- Test: `src/hosted/manifest.test.ts`
- Test: `src/hosted/contract.test.ts`
- Test: `src/build-manifest.test.ts`
- Test: `src/check-hosted-contract.test.ts`

**Interfaces:**

- Consumes `sessionProtocolVersion: 1` from Task 11.
- Produces `HostedClient.createSession`, `listSessions`, and `closeSession`, plus hosted lifecycle rendering.
- Fails incompatible CLI/server pairs with `HOSTED_CONTRACT_MISMATCH` before `/v1/execute` or `/v1/browser/...` is called.

- [ ] **Step 1: Add fail-fast and list tests**

For an old manifest, assert zero browser/execute calls:

```ts
await expect(runHostedCli(['--session', 'session_a', 'github', 'issues'], oldServerOptions))
  .resolves.toMatchObject({ exitCode: 78 });
expect(requests.map(request => request.pathname)).toEqual(['/v1/manifest']);
expect(stderr).toContain('HOSTED_CONTRACT_MISMATCH');
```

For a compatible server:

```ts
await runHostedCli(['--profile', 'work', 'session', 'list', '-f', 'json'], options);
expect(requests.at(-1)?.url).toContain('/v1/sessions?profile=work');
expect(JSON.parse(stdout)).toEqual([
  expect.objectContaining({ id: 'session_a', kind: 'explicit' }),
]);
```

Assert `session create` sends no name/ID, `session close session_a` calls the exact close route and treats already-idle as exit 0, completion includes all three lifecycle commands, and contains no `browser <session>` template.

- [ ] **Step 2: Run focused tests and verify old metadata is accepted/list is unknown**

Run:

```bash
npx vitest run --project unit src/hosted/client.test.ts src/hosted/runner.test.ts src/hosted/manifest.test.ts src/hosted/contract.test.ts src/build-manifest.test.ts src/check-hosted-contract.test.ts
```

Expected: FAIL because the client validator has no capability field/list response and completion still advertises positional browser syntax.

- [ ] **Step 3: Validate capability once before hosted dispatch**

Extend the hosted manifest metadata type and validator. Immediately after `getManifest()` and before adapter or browser dispatch:

```ts
if (manifest.metadata.sessionProtocolVersion !== 1) {
  throw new ConfigError(
    'HOSTED_CONTRACT_MISMATCH: this Webcmd Cloud server does not support Session protocol v1.',
    'Upgrade Webcmd Cloud or use a compatible webcmd CLI.',
  );
}
```

Reuse the fetched manifest within that dispatch; do not add a second capability endpoint.

- [ ] **Step 4: Add hosted Session list and canonical generated surfaces**

Add response validators plus `createSession(profile?)`, `listSessions(profile?)`, and `closeSession(profile?, sessionId)`, then route the lifecycle commands through the existing renderer. Replace completion/help templates with:

```ts
`${CLI_COMMAND} --session <session-id> [--profile <name>] browser <command> [args] [options]`
```

Browser help must show `session create` and `session list`. Adapter help describes `--session` as optional isolation and must not imply a raw-browser default.

Keep hosted adapter contract `schemaVersion: 1`; this feature changes CLI selectors and manifest metadata, not adapter argument schemas. Regenerate `cli-manifest.json`, `hosted-contract.json`, and plugin command manifests with existing build scripts.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx vitest run --project unit src/hosted/client.test.ts src/hosted/runner.test.ts src/hosted/manifest.test.ts src/hosted/contract.test.ts src/build-manifest.test.ts src/check-hosted-contract.test.ts
npm run build
npm run check:hosted-contract
```

Expected: PASS; old servers fail before browser work, list is available, and generated surfaces use root syntax.

Commit:

```bash
git add src/hosted/types.ts src/hosted/client.ts src/hosted/runner.ts src/hosted/manifest.ts src/completion-shared.ts src/hosted/contract.ts src/build-manifest.ts src/hosted/client.test.ts src/hosted/runner.test.ts src/hosted/manifest.test.ts src/hosted/contract.test.ts src/build-manifest.test.ts src/check-hosted-contract.test.ts cli-manifest.json hosted-contract.json plugin-command-manifest.json
git diff --cached --check
git commit -m "feat: require hosted session protocol"
```

---

### Task 13: Gate the Pinned Cloak Runtime for Issues #225, #242, and #276

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Create: `tests/e2e/cloak-session-concurrency.test.ts`
- Modify: `package.json`
- Modify: `src/browser/runtime/local-cloak/session-manager.test.ts`
- Modify: `src/browser/runtime/local-cloak/process-matcher.test.ts`

**Interfaces:**

- Produces runnable `npm run gate:cloak-sessions` against the exact installed Cloak/Chromium pair.
- Blocks release on concurrency, focus, anchor, lifecycle, or teardown failure; it does not select a degraded mode.

- [ ] **Step 1: Add a live test gated only by explicit release intent**

Create the suite with:

```ts
const live = process.env.WEBCMD_LIVE_CLOAK === '1';
describe.skipIf(!live)('pinned Cloak Profile Sessions', () => {
  it('runs two Profiles and two Sessions in one Profile concurrently', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'webcmd-cloak-session-gate-'));
    const manager = new CloakSessionManager({ baseDir });
    try {
      const [profileA, profileB] = await Promise.all([
        manager.getPage({ profileId: 'profile-a', sessionId: 'session_a' }),
        manager.getPage({ profileId: 'profile-b', sessionId: 'session_b' }),
      ]);
      await Promise.all([
        profileA.page.goto('data:text/html,<title>A</title>'),
        profileB.page.goto('data:text/html,<title>B</title>'),
      ]);
      expect(await profileA.page.title()).toBe('A');
      expect(await profileB.page.title()).toBe('B');
    } finally {
      await manager.shutdown();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
```

The body must use barriers and real navigations to two locally served pages, not timing guesses. It must assert all of these in one cleanup-safe suite:

1. `resolveCloakBrowserVersion()` is exactly `0.4.5`, and the runtime-reported Chromium version is `145.0.7632.109.2`.
2. Two Profile contexts with distinct temp user-data directories launch through `Promise.all` and both navigate.
3. Two Sessions in one Profile receive distinct window IDs and navigate simultaneously.
4. Same-Session extra tabs and popups retain ownership; background creation does not change `document.hasFocus()` in the foreground human window.
5. Closing Session A leaves Session B operational; after the last task page closes, the supported host's hidden/parking keeper keeps the Profile reusable.
6. A new Session opens during the warm period; another opens during forced idle close and receives one clean replacement runtime; shutdown during an in-flight launch leaks no process.
7. `work` teardown does not match `work-2` or an unrelated Chrome process fixture.

Always close contexts and delete only suite-created temp directories in `afterEach`/`finally`.

- [ ] **Step 2: Add the package command and static pin assertion**

Add:

```json
"gate:cloak-sessions": "WEBCMD_LIVE_CLOAK=1 vitest run --project e2e tests/e2e/cloak-session-concurrency.test.ts"
```

Keep dependencies unchanged. Add a unit assertion that `package.json` and lockfile both contain exact `cloakbrowser: 0.4.5` and `playwright-core: 1.61.1`, not ranges.

- [ ] **Step 3: Run unit coverage, then the real gate**

Run:

```bash
npx vitest run --project unit src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/process-matcher.test.ts
npm run gate:cloak-sessions
```

Expected: unit tests PASS; on every supported release OS, its live suite PASSes the applicable keeper and window invariants. At minimum, macOS release evidence is required before the first implementation lands, and Windows/Linux support cannot be claimed until their live keeper gates pass. Any live failure blocks release and returns the pinned runtime/launcher to repair.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/cloak-session-concurrency.test.ts package.json src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/process-matcher.test.ts
git diff --cached --check
git commit -m "test: gate pinned cloak session concurrency"
```

---

### Task 14: Gate Browser Use Same-Profile Persistence and Sibling Handoff

**Repository:** `/Users/beubax/Desktop/AgentR/webcmd-cloud`

**Files:**

- Modify: `src/live-gates/browser-use-spike.ts`
- Modify: `src/live-gates/browser-gates.ts`
- Modify: `src/live-gates/runner.ts`
- Modify: `src/live-gates/types.ts`
- Modify: `tests/browser-use-spike.test.ts`
- Modify: `tests/live-gate-matrix.test.ts`
- Modify: `tests/live-gate-runner.test.ts`

**Interfaces:**

- Extends the existing `npm run gate:browser-use-spike`; adds no new provider abstraction.
- Produces release evidence for both stop orders and Session-scoped handoff sibling usability.

- [ ] **Step 1: Add deterministic fake-provider gate tests**

Model two allocations from the same Browser Use Profile and assert the gate performs:

```ts
await sessionA.page.context().addCookies([{ name: 'marker_a', value: 'A', domain: 'a.example', path: '/' }]);
await sessionA.page.goto('https://a.example');
await sessionA.page.evaluate(() => localStorage.setItem('marker_a', 'A'));

await sessionB.page.context().addCookies([{ name: 'marker_b', value: 'B', domain: 'b.example', path: '/' }]);
await sessionB.page.goto('https://b.example');
await sessionB.page.evaluate(() => localStorage.setItem('marker_b', 'B'));
```

Run the scenario once stopping A then B and once B then A. A later allocation must read both domain cookies and both origins' local-storage markers. During each scenario, mark A as handoff-controlled and prove B can navigate/evaluate before A is verified/expired.

- [ ] **Step 2: Run focused tests and confirm the gate lacks merge-order coverage**

Run:

```bash
npx vitest run tests/browser-use-spike.test.ts tests/live-gate-matrix.test.ts tests/live-gate-runner.test.ts
```

Expected: FAIL because the existing spike does not run two same-Profile allocations with both persistence orders and sibling handoff.

- [ ] **Step 3: Extend the existing spike and evidence**

Use unique HTTPS origins owned by the live-gate fixture, not public third-party sites. Record sanitized evidence containing Session aliases, stop order, marker booleans, and sibling success; exclude cookies' values, Browser Use IDs, CDP URLs, and live-view URLs.

Register two required gate IDs:

```ts
'browser-use.same-profile-session-merge-both-orders'
'browser-use.session-handoff-sibling-continues'
```

Do not add a cookie sync fallback. A failed provider merge is a release-blocking architecture review.

- [ ] **Step 4: Run unit and live gates, then commit**

Run:

```bash
npx vitest run tests/browser-use-spike.test.ts tests/live-gate-matrix.test.ts tests/live-gate-runner.test.ts
npm run gate:browser-use-spike
```

Expected: unit tests PASS; with release credentials, both Browser Use persistence orders and sibling handoff gate PASS.

Commit:

```bash
git add src/live-gates/browser-use-spike.ts src/live-gates/browser-gates.ts src/live-gates/runner.ts src/live-gates/types.ts tests/browser-use-spike.test.ts tests/live-gate-matrix.test.ts tests/live-gate-runner.test.ts
git diff --cached --check
git commit -m "test: gate browser use session isolation"
```

---

### Task 15: Teach Users and Agents the Session Contract

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `README.md`
- Modify: `docs/authentication-and-profiles.mdx`
- Modify: `docs/browser-and-sitemap-memory.mdx`
- Modify: `docs/cli-reference.mdx`
- Modify: `docs/local-or-cloud.mdx`
- Modify: `docs/x-session-cli.mdx`
- Modify: `docs/agents/claude-code.md`
- Modify: `docs/agents/codex-cli.md`
- Modify: `docs/agents/cursor.md`
- Modify: `docs/agents/hermes.md`
- Modify: `docs/agents/openclaw.md`
- Modify: `docs/agents/opencode.md`
- Modify: `skills/webcmd-usage/SKILL.md`
- Modify: `skills/webcmd-browser/SKILL.md`
- Modify: `skills/webcmd-autofix/SKILL.md`
- Modify: `skills/webcmd-adapter-author/SKILL.md`
- Modify: `skills/webcmd-sitemap-author/SKILL.md`
- Modify: `skills/webcmd-browser-sitemap/SKILL.md`
- Modify: active Markdown references directly linked from those skills and containing `webcmd browser` examples
- Modify: `src/skills.test.ts`
- Modify: `src/docs-sync-review-cli.test.ts`

**Interfaces:**

- Documents the already-implemented behavior; introduces no runtime switches.
- Active raw-browser examples create and carry opaque IDs; adapter examples omit the selector unless demonstrating explicit isolation.

- [ ] **Step 1: Add documentation/skill contract tests first**

In `skills.test.ts`, require all six bundled skills to use root syntax and explain Session selection where relevant:

```ts
expect(browserSkill).toContain('webcmd --profile work session create');
expect(browserSkill).toContain('webcmd --session session_');
expect(browserSkill).toContain('webcmd --profile work session list');
expect(browserSkill).toContain('webcmd --profile work session close');
expect(browserSkill).toMatch(/different agents[\s\S]*different Sessions/i);
expect(usageSkill).toMatch(/SESSION_BUSY[\s\S]*same Session/i);
expect(usageSkill).toMatch(/adapter[\s\S]*default Session/i);
expect(autofixSkill).toMatch(/verify_command[\s\S]*immutable Session ID/i);
```

Add an active-doc scan that excludes `docs/superpowers/**` and fails on positional templates or examples:

```ts
expect(activeText).not.toMatch(/webcmd browser (?:<session>|[a-z][\w-]*)\s+(?:run|tabs|bind|close|snapshot)\b/);
expect(activeText).not.toContain('browser --session');
```

- [ ] **Step 2: Run the focused docs tests and observe stale examples**

Run:

```bash
npx vitest run --project unit src/skills.test.ts src/docs-sync-review-cli.test.ts
```

Expected: FAIL on positional syntax, unscoped verify guidance, and missing Profile/Session/tab explanations.

- [ ] **Step 3: Update the user documentation with one consistent model**

Every overview must use this concise distinction:

```text
Profile = shared login state (cookies and browser storage).
Session = one agent task's browser workspace and command lock, selected by an opaque ID.
Tab = a page owned by that Session.
```

Document:

- raw browser work runs `session create` once and carries its returned opaque ID; omission is `SESSION_REQUIRED`;
- `session list` lists stable IDs/state and attaching means passing an ID—there is no Session bind command;
- `session close` frees local windows or a hosted allocation, succeeds when already idle, and does not delete the record;
- non-browser adapters allocate no Session; browser-backed adapters use a system adapter default unless an explicit ID is supplied;
- `siteSession` ephemeral/persistent controls tab lifetime inside the selected/default Session, so ephemeral adapters do not mint one window per command;
- the adapter default is never chosen implicitly for raw browser work, but its listed ID may be passed deliberately and then shares admission/tabs with default-routed adapters;
- parallel agents use distinct created IDs;
- local Sessions are exclusive Cloak window groups inside one Profile context; hosted Sessions consume distinct Browser Use allocations;
- local Profiles remain warm for 60 seconds behind the platform keeper; only macOS promises a zero-visible-window hidden target;
- already-running hosted allocations do not receive live cookie injection;
- overlapping same-Session commands can receive `SESSION_BUSY`, including commands from the same agent/PID; sequential commands work;
- hosted quota exhaustion is `SESSION_CAPACITY_EXCEEDED` with close/wait/upgrade guidance;
- a handoff pauses only its Session and the returned immutable-ID `verify_command` is authoritative.

Use canonical examples:

```bash
webcmd --profile work github issues
webcmd --profile work session create
webcmd --profile work --session session_7d8f... browser run --stdin
webcmd --profile work session list
webcmd --profile work session close session_7d8f...
```

- [ ] **Step 4: Update all active skill examples and error playbooks**

Replace positional browser calls in each selected skill and its directly referenced active example files. Teach `SESSION_REQUIRED`, `SESSION_NOT_FOUND`, `SESSION_BUSY`, `SESSION_PAUSED_FOR_HUMAN_HANDOFF`, `SESSION_WINDOW_CONFLICT`, and `SESSION_CAPACITY_EXCEEDED` as structured runtime states, not adapter breakage. Explain that cookie APIs are Profile-wide even though pages are Session-scoped. Keep the existing prohibition on agents entering passwords, OTPs, cookies, recovery codes, or CAPTCHAs.

Do not edit historical `docs/superpowers/specs/**` or `docs/superpowers/plans/**` to rewrite history.

- [ ] **Step 5: Verify scans and commit**

Run:

```bash
npx vitest run --project unit src/skills.test.ts src/docs-sync-review-cli.test.ts
rg -n "webcmd browser (<session>|[a-z][[:alnum:]_-]*) (run|tabs|bind|close|snapshot)|browser --session" README.md docs skills -g '!docs/superpowers/**'
```

Expected: tests PASS; the final `rg` returns no matches.

Commit:

```bash
git add README.md docs/authentication-and-profiles.mdx docs/browser-and-sitemap-memory.mdx docs/cli-reference.mdx docs/local-or-cloud.mdx docs/x-session-cli.mdx docs/agents skills src/skills.test.ts src/docs-sync-review-cli.test.ts
git diff --cached --check
git commit -m "docs: teach profile sessions and concurrency"
```

---

### Task 16: Run Coordinated Verification and Package Parity

**Repositories:** `/Users/beubax/Desktop/AgentR/OpenCLI` and `/Users/beubax/Desktop/AgentR/webcmd-cloud`

**Files:**

- Modify only if generated artifacts are stale: `cli-manifest.json`, `hosted-contract.json`, `plugin-command-manifest.json`
- Modify only if the packed version is intentionally advanced for release: `/Users/beubax/Desktop/AgentR/webcmd-cloud/package.json`, `/Users/beubax/Desktop/AgentR/webcmd-cloud/package-lock.json`
- Test: all local and cloud suites named below

**Interfaces:**

- Produces a packed CLI whose manifest advertises canonical Session UX and a cloud image requiring `sessionProtocolVersion: 1`.
- Produces final evidence that issues #225, #242, and #276 are covered by automated/live checks.

- [ ] **Step 1: Verify the local repository from a clean build**

Run:

```bash
cd /Users/beubax/Desktop/AgentR/OpenCLI
npm run typecheck
npm test
npm run build
npm run check:hosted-contract
npm run check:codex-plugin
npm run gate:cloak-sessions
git status --short
```

Expected: every command exits 0; the live Cloak gate reports the exact pinned versions; only intentional generated changes appear.

- [ ] **Step 2: Pack the CLI and run cloud compatibility/parity**

Run:

```bash
cd /Users/beubax/Desktop/AgentR/webcmd-cloud
npm run typecheck
npm test
npm run build
npm run test:parity:packed
git status --short
```

Expected: all cloud unit/integration-with-fakes and packed CLI differential tests PASS. If the cloud package pin must advance to the just-packed CLI version, use the existing `npm run bump:webcmd -- <version>` workflow, inspect its lockfile diff, rerun this step, and commit only that intentional pin.

- [ ] **Step 3: Run PostgreSQL integration with the migrated schema**

With the repository's normal test PostgreSQL URL:

```bash
TEST_DATABASE_URL="$WEBCMD_TEST_DATABASE_URL" npx vitest run tests/postgres-migration.integration.test.ts tests/postgres-repository.integration.test.ts tests/postgres-session-write-leases.integration.test.ts
```

Expected: migrations `0010_profile_sessions` and `0011_session_browser_leases` are idempotent; concurrent adapter-default creation returns one row while explicit creates remain distinct; Session leases arbitrate across two pools.

- [ ] **Step 4: Run hosted live release gates**

Run:

```bash
npm run gate:browser-ready
npm run gate:browser-use-spike
npm run gate:session-write-lease
npm run gate:workspace-profiles
```

Expected: all gates PASS, including two same-Profile Session allocations, both persistence stop orders, sibling handoff continuation, and same-Session immediate busy behavior. No release proceeds with a skipped/failed Cloak or Browser Use gate.

- [ ] **Step 5: Perform the final issue/contract smoke test**

On the release candidate, create two Sessions, capture their IDs from structured output, then run two shells against one Profile:

```bash
webcmd --profile release-work session create -f json
webcmd --profile release-work session create -f json

webcmd --profile release-work --session session_A_FROM_OUTPUT browser run --stdin <<'JS'
await page.goto('data:text/html,<title>agent-a</title>');
await new Promise(resolve => setTimeout(resolve, 15000));
return { title: await page.title() };
JS
webcmd --profile release-work --session session_B_FROM_OUTPUT browser run --stdin <<'JS'
await page.goto('data:text/html,<title>agent-b</title>');
await new Promise(resolve => setTimeout(resolve, 15000));
return { title: await page.title() };
JS
webcmd --profile release-work session list -f json
```

Start the heredocs in separate shells so their 15-second holds overlap. Expected: distinct local window groups or hosted live views, both commands progress, and list returns the two stable IDs. During that hold, launch Session A from a third shell; expected `SESSION_BUSY` while B remains usable. Verify raw omission returns `SESSION_REQUIRED`. Run a browser-backed adapter with no selector and verify one `adapter-default` row appears without a per-command Session. Run login in A; expected its returned verify command contains the same immutable ID, A pauses, and B continues. Finally close both IDs and verify repeated close is a successful no-op.

- [ ] **Step 6: Commit any final generated/package-only changes**

In each repository with intentional final changes:

```bash
git diff --check
git diff --cached --check
git status --short
```

Commit generated artifacts in OpenCLI as:

```bash
git add cli-manifest.json hosted-contract.json plugin-command-manifest.json
git commit -m "build: refresh session command contracts"
```

Commit an intentional cloud package pin separately as:

```bash
git add package.json package-lock.json
git commit -m "build: pin session-capable webcmd"
```

Do not create either commit when its staged diff is empty.

---

## Completion Matrix

| Requirement | Implemented and verified by |
|---|---|
| Root selector, explicit create/list/close, raw requirement, adapter default | Tasks 1-2, 7, 9, 12 |
| Parallel Sessions, immediate same-Session busy, same-run re-entry, dead-owner cleanup | Tasks 3, 8-9 |
| Local window groups, tab/popup/page ownership, browser-run sandbox | Task 4 |
| Issue #276 platform keeper, close/arrival race, shutdown launch fence | Task 5 |
| Issue #242 exact Profile teardown | Tasks 5 and 13 |
| Issue #225 pinned concurrent Cloak guarantee | Task 13 |
| One Browser Use allocation/live view per hosted Session | Tasks 8-10 |
| Structured hosted Session capacity errors | Tasks 8, 12, 15 |
| Session-scoped local/hosted handoff with sibling continuation | Tasks 6, 10, 14 |
| Browser Use same-Profile storage merge in both stop orders | Task 14 |
| Capability break for incompatible CLI/cloud pairs | Tasks 11-12 |
| Help, completion, docs, harness guides, and bundled skills | Tasks 12 and 15 |
| Full build, packed parity, PostgreSQL, live gates, smoke test | Task 16 |
