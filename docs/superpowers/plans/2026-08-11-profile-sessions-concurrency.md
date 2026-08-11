# Profile Sessions and Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Webcmd Session the deterministic browser-workspace and command-admission boundary in local and hosted modes, so agents can run concurrently under one authenticated Profile without sharing windows, allocations, tabs, live views, or handoffs.

**Architecture:** The local daemon atomically resolves a friendly Session selector to a persisted immutable ID, admits one top-level execution per Session, and maps that Session to a Cloak window group inside the Profile's single persistent context. Webcmd Cloud stores the same Session identity in PostgreSQL and keys Browser Use allocations and admission leases by `(userId, workspaceId, profileId, sessionId)`; both modes retain existing adapter `siteSession` behavior inside the selected Session.

**Tech Stack:** TypeScript, Node.js 20.6+, Commander 14, Playwright Core 1.61.1, Cloak Browser package 0.4.5 with Chromium v145.0.7632.159, Vitest, PostgreSQL, Browser Use, GCP release gates.

## Global Constraints

- Implement the approved contract in `docs/superpowers/specs/2026-08-11-profile-sessions-concurrency-design.md`; do not reintroduce Spaces.
- Work in `/Users/beubax/Desktop/AgentR/OpenCLI` for CLI/local tasks and `/Users/beubax/Desktop/AgentR/webcmd-cloud` for hosted tasks.
- Preserve unrelated user changes. Before every commit, stage only that task's files and inspect `git diff --cached`.
- Keep `cloakbrowser` exactly pinned to `0.4.5`, Playwright Core exactly pinned to `1.61.1`, and the supported Chromium artifact at v145.0.7632.159. Do not add capability/licence fallback branches.
- Add no dependency. Reuse Commander, Playwright/CDP, the local `SessionLeaseRegistry`, the hosted persistent write lease, existing Profile services, existing live-view storage, and existing rendering.
- `--session <name-or-id>` is a root option. Omission resolves the reserved name `default`; no PID default, ambient `session use`, explicit create, takeover, complete, or positional compatibility alias is allowed.
- A missing friendly name is created atomically. An unknown or cross-Profile `session_...` selector returns `SESSION_NOT_FOUND` and is never created.
- Session records persist; local pages/windows and hosted allocations do not survive runtime restart or eviction.
- Different Sessions and Profiles run concurrently. A different overlapping execution in the same Session fails immediately with `SESSION_BUSY`; it never waits in a public queue.
- Generate execution IDs only at the trusted top-level CLI/server boundary. Permit re-entry by the same ID; never treat PID, agent identity, or caller-supplied hosted IDs as ownership.
- Local windows never mix Sessions. Manual cross-window tab moves return `SESSION_WINDOW_CONFLICT` without moving or closing the tab.
- A human handoff pauses only its owning Session. Its verify command must contain the same Profile and immutable Session ID; sibling Sessions continue.
- Local Profile warm time is the fixed, unreferenced `60_000` ms. Graceful context close is bounded at `3_000` ms before exact Profile recovery.
- Hosted mode uses one Browser Use allocation and one live-view URL per active Session. Do not implement Webcmd-owned cookie/storage synchronization.
- Roll out the hosted schema and runtime as one drained revision: route the old browser-worker revision to zero, wait at least the existing 45-second lease TTL, then enable Session-keyed browser traffic. Do not run legacy Profile-keyed and new Session-keyed workers concurrently.
- Active docs, help, completion, generated hints, and bundled skills must use canonical root syntax in the same release. Historical specs and plans remain historical.

---

## Planned File Map

### Webcmd CLI and local runtime

- `src/root-command-surface.ts`: canonical root `--session` parsing for local and hosted dispatch.
- `src/cli-argv-preprocess.ts`: reject retired positional raw-browser syntax with a targeted exit-2 migration error; retain unrelated argv preprocessing.
- `src/cli.ts`, `src/commanderAdapter.ts`: consume the root selector and expose `session list`.
- `src/hosted/browser-args.ts`, `src/hosted/runner.ts`, `src/hosted/client.ts`, `src/hosted/types.ts`: send the selector for adapter and raw-browser requests and render hosted Session lists.
- `src/browser/sessions.ts`: local persisted Session records, lazy/default resolution, handoff metadata, and public list rows.
- `src/browser/protocol.ts`, `src/browser/runtime/provider.ts`, `src/daemon/server.ts`: resolve a selector before admission, carry immutable Session IDs, expose Session status, and return structured errors.
- `src/execution.ts`, `src/browser/page.ts`, `src/browser/daemon-client.ts`, `src/session-lease.ts`, `src/errors.ts`: top-level run identity, Session admission, adapter tab routing, and handoff controls.
- `src/browser/runtime/local-cloak/session-manager.ts`, `src/browser/runtime/local-cloak/actions.ts`, `src/browser/runtime/local-cloak/provider.ts`: Session window groups, owned tabs, hidden anchor, Profile idle lifecycle, and Session-scoped actions.
- `src/browser/runtime/local-cloak/process-matcher.ts`: the one exact Cloak Profile process matcher reused by recovery and teardown.
- `tests/e2e/cloak-session-concurrency.test.ts`: live gate for the pinned Cloak/Chromium pair.

### Webcmd Cloud

- `src/domain/types.ts`, `src/sessions/service.ts`: hosted Session record and selector resolution.
- `src/storage/schema.sql`, `src/storage/repository.ts`, `src/storage/postgres-repository.ts`: durable Session rows and Session-keyed admission leases; retain the physical `browser_allocations.session_key` column but store immutable Session IDs in it.
- `src/http/router.ts`, `src/executor/non-browser.ts`: accept/resolve `session`, mint trusted execution IDs, and route adapters.
- `src/browser/allocation-manager.ts`, `src/browser/dependencies.ts`, `src/browser/runtime.ts`: one durable Browser Use allocation per Session without the current `PROFILE_SESSION_KEY` collapse.
- `src/executor/browser-session-policy.ts`, `src/executor/session-write-lease.ts`, `src/browser/hosted-browser.ts`, `src/browser/session-lock.ts`: Session-keyed adapter tabs, immediate admission, and raw-browser reuse of the same allocation.
- `src/auth/hosted-auth.ts`, `src/account/browser-live-view.ts`, `src/account/live-view.ts`: Session-scoped handoff and exact allocation/view revocation.
- `src/live-gates/browser-use-spike.ts`, `src/live-gates/browser-gates.ts`, `src/live-gates/runner.ts`: concurrent same-Profile persistence and sibling-handoff release gates.

### Active documentation and generated surfaces

- `README.md`, `docs/authentication-and-profiles.mdx`, `docs/browser-and-sitemap-memory.mdx`, `docs/cli-reference.mdx`, `docs/local-or-cloud.mdx`, `docs/x-session-cli.mdx`, and `docs/agents/*.md`: user and harness guidance.
- `skills/webcmd-usage/SKILL.md`, `skills/webcmd-browser/SKILL.md`, `skills/webcmd-autofix/SKILL.md`, `skills/webcmd-adapter-author/SKILL.md`, `skills/webcmd-sitemap-author/SKILL.md`, `skills/webcmd-browser-sitemap/SKILL.md`, plus directly referenced active skill examples: agent instructions.
- `src/completion-shared.ts`, generated hosted contract/manifest artifacts, and their sync tests: canonical discoverability and compatibility.

---

### Task 1: Canonical Root Session Selector and Syntax Break

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
- Produces `rejectPositionalBrowserSessionArgv(argv): string[]`, which never rewrites a Session selector, retains the existing trailing-`--window` normalization, or throws `BrowserSessionArgvError`.
- Later tasks consume the selector as an unresolved name-or-ID; this task does not create Session records.

- [ ] **Step 1: Replace positional-success tests with canonical and migration-error tests**

Add these central assertions and update every existing positional fixture in the listed test files:

```ts
expect(parseHostedRootCommandSurface([
  '--profile', 'work', '--session', 'invoice-audit', 'github', 'issues',
])).toEqual({
  kind: 'dispatch',
  argv: ['github', 'issues'],
  profile: 'work',
  session: 'invoice-audit',
  literal: false,
});

expect(() => rejectPositionalBrowserSessionArgv(['browser', 'invoice-audit', 'run', '--stdin']))
  .toThrowError(/webcmd --session invoice-audit browser run --stdin/);

expect(rejectPositionalBrowserSessionArgv(['--session', 'invoice-audit', 'browser', 'run', '--stdin']))
  .toEqual(['--session', 'invoice-audit', 'browser', 'run', '--stdin']);
```

For hosted transport, assert both surfaces carry the same selector:

```ts
expect(executeRequest.body).toMatchObject({
  command: 'github/issues',
  session: 'invoice-audit',
});
expect(browserRequest.pathname).toBe('/v1/browser/invoice-audit/commands');
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
export const ROOT_SESSION_FLAGS = '--session <name-or-id>';
export const ROOT_SESSION_DESCRIPTION = 'Agent task session name or immutable session ID';

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

Keep `BROWSER_SUBCOMMAND_NAMES`, because it distinguishes `browser run` from the retired `browser invoice-audit run`. Replace only `rewriteBrowserArgv`:

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

Add `session?: string` to `HostedClient.execute` and `runPreparedExecution`, their JSON validators/types, and `dispatchHosted`. For raw browser commands, choose `normalized.session ?? 'default'` and continue using the existing encoded path segment. Do not accept a browser-namespace selector.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx vitest run --project unit src/hosted/root-command-surface.test.ts src/cli-argv-preprocess.test.ts src/cli.test.ts src/hosted/browser-args.test.ts src/hosted/runner.test.ts src/hosted/client.test.ts
npm run typecheck
```

Expected: PASS; positional syntax exits 2 with the canonical replacement, and root syntax works for adapters and browser commands.

Commit:

```bash
git add src/root-command-surface.ts src/cli-argv-preprocess.ts src/main.ts src/cli.ts src/commanderAdapter.ts src/hosted/browser-args.ts src/hosted/runner.ts src/hosted/client.ts src/hosted/types.ts src/hosted/root-command-surface.test.ts src/cli-argv-preprocess.test.ts src/cli.test.ts src/hosted/browser-args.test.ts src/hosted/runner.test.ts src/hosted/client.test.ts
git diff --cached --check
git commit -m "feat: make session a root cli selector"
```

---

### Task 2: Persist and Resolve Local Session Identity

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
- Produces `resolve(profileId, selector?): BrowserSessionRecord`, `list(profileId)`, `markHandoff`, `clearHandoff`, and `touch`.
- Provider produces `resolveSession(command)` before browser dispatch and includes `sessions` in a Profile-filtered status response.

- [ ] **Step 1: Write persistence and resolution tests**

Use a temporary base directory and deterministic dependencies:

```ts
const store = new LocalBrowserSessionStore({
  baseDir,
  now: () => new Date('2026-08-11T00:00:00.000Z'),
  idFactory: () => 'session_11111111-1111-4111-8111-111111111111',
});

const created = store.resolve('profile_work', 'invoice-audit');
expect(created).toMatchObject({
  id: 'session_11111111-1111-4111-8111-111111111111',
  profileId: 'profile_work',
  name: 'invoice-audit',
});
expect(store.resolve('profile_work', 'invoice-audit').id).toBe(created.id);
expect(new LocalBrowserSessionStore({ baseDir }).resolve('profile_work', created.id).name)
  .toBe('invoice-audit');
expect(() => store.resolve('profile_other', created.id)).toThrowError(
  expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
);
expect(store.resolve('profile_work').name).toBe('default');
```

Also assert `list` does not create `default`, malformed JSON fails closed with a useful configuration error, the state file is mode `0600`, and a temp file is renamed over the destination.

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
  name: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  handoff?: { site: string; expiresAt: string };
}

export interface BrowserSessionListRow extends BrowserSessionRecord {
  runtimeState: 'idle' | 'active';
}
```

Persist `{ version: 1, sessions: BrowserSessionRecord[] }` at `path.join(baseDir ?? getWebcmdConfigDir(), 'browser-sessions.json')`. Generate IDs with `session_${randomUUID()}`. Resolution is:

```ts
const value = selector?.trim() || 'default';
if (value.startsWith('session_')) {
  const found = sessions.find(row => row.id === value && row.profileId === profileId);
  if (!found) throw new SessionNotFoundError(value, profileId);
  return touch(found);
}
const found = sessions.find(row => row.profileId === profileId && row.name === value);
return found ? touch(found) : create(profileId, value);
```

Write JSON to `.<basename>.<pid>.<uuid>.tmp` with mode `0600`, then `renameSync`. The daemon is the sole writer, so do not add filesystem locking.

- [ ] **Step 4: Resolve before daemon admission and expose list state**

Extend the provider contract:

```ts
resolveSession(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord>;
listSessions(input: { profileId?: string }): Promise<BrowserSessionListRow[]>;
```

At `/command`, resolve once, then dispatch an enriched copy:

```ts
const session = await provider.resolveSession(body);
const command = { ...body, sessionId: session.id, sessionName: session.name };
```

Do not resolve `lease-release` or Session-list/status controls. Add Profile-filtered `sessions` to `/status`; local `runtimeState` is `active` only when the manager owns an open visible tab/window for that immutable ID.

- [ ] **Step 5: Add `webcmd --profile work session list`**

Register `session list` in `cli.ts`, read the root Profile selector through the existing Profile resolution, and render columns:

```ts
['id', 'name', 'runtimeState', 'lastUsedAt', 'handoff']
```

When the daemon is absent, read the persisted store and report every row as `idle`; listing must not launch Cloak or create `default`. Use the existing `render` function for `table`, `json`, `yaml`, `md`, and `csv` instead of a new formatter.

- [ ] **Step 6: Verify restart persistence and commit**

Run:

```bash
npx vitest run --project unit src/browser/sessions.test.ts src/daemon/server.test.ts src/cli.test.ts
npm run typecheck
```

Expected: PASS; a new store instance resolves the same immutable ID, cross-Profile IDs fail, and list works with or without a running daemon.

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
- Modify: `src/errors.ts`
- Test: `src/session-lease.test.ts`
- Test: `src/daemon/server.test.ts`
- Test: `src/browser/daemon-client.test.ts`
- Test: `src/execution.test.ts`

**Interfaces:**

- Consumes immutable `sessionId` from Task 2.
- Produces `getSessionLeaseKey(profileId, sessionId)` and admission for every browser-backed top-level run.
- Produces separate adapter tab identity `(profileId, sessionId, site)` while preserving `siteSession: persistent|ephemeral`.

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

In `execution.test.ts`, assert persistent tabs for the same site produce different daemon Session IDs when root Sessions differ, while ephemeral tabs are released only inside their owning Session.

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
    && typeof command.sessionId === 'string'
    && command.sessionId.length > 0
    && typeof command.runId === 'string'
    && command.runId.length > 0;
}
```

Acquire after Session resolution and before `provider.dispatch`. On conflict return HTTP 409 with `{ code: 'SESSION_BUSY', session: { id, name }, holder: { command, pid?, acquiredAt, heartbeatAt } }`; never include `runId`.

- [ ] **Step 4: Mint and propagate one run ID for every browser-backed CLI invocation**

Move `generateRunId()` to the top-level browser-backed branch in `executeCommand`, not the persistent-write branch. Run the complete adapter command inside `runWithDaemonRunContext`, and release by run ID in the existing `finally`. Raw browser actions must use the same wrapper in their Commander action so nested daemon operations re-enter.

Hosted callers are unrelated here; do not accept a CLI flag or environment variable as `runId`.

- [ ] **Step 5: Separate selected Session from adapter tab lifecycle**

Delete `resolveAdapterBrowserSession(cmd, siteSession)` as a source of the user Session. Pass root `options.session` to `BrowserPage`; after daemon resolution, use:

```ts
const tabKey = command.surface === 'adapter' && command.siteSession === 'persistent'
  ? `${command.sessionId}\0site:${command.adapterSite}`
  : `${command.sessionId}\0ephemeral:${command.runId}`;
```

Add `adapterSite?: string` to the daemon protocol and set it from `cmd.site` in `execution.ts`. `siteSession` still decides whether release closes the adapter tab. It must never choose the Session admission key.

- [ ] **Step 6: Add consistent typed errors and verify**

Add `SessionNotFoundError` (exit 66), enhance `SessionBusyError` with safe Session ID/name metadata (exit 75), add `SessionPausedForHumanHandoffError` (exit 77), and `SessionWindowConflictError` (exit 75). Map the same uppercase daemon codes in `daemon-client.ts`.

Run:

```bash
npx vitest run --project unit src/session-lease.test.ts src/daemon/server.test.ts src/browser/daemon-client.test.ts src/execution.test.ts
npm run typecheck
```

Expected: PASS; overlapping runs in one Session fail immediately, the same run re-enters, and different Sessions progress concurrently.

Commit:

```bash
git add src/session-lease.ts src/daemon/server.ts src/browser/protocol.ts src/browser/daemon-client.ts src/browser/page.ts src/execution.ts src/errors.ts src/session-lease.test.ts src/daemon/server.test.ts src/browser/daemon-client.test.ts src/execution.test.ts
git diff --cached --check
git commit -m "feat: admit local browser work by session"
```

---

### Task 4: Give Each Local Session an Owned Cloak Window Group

**Repository:** `/Users/beubax/Desktop/AgentR/OpenCLI`

**Files:**

- Modify: `src/browser/runtime/local-cloak/session-manager.ts`
- Modify: `src/browser/runtime/local-cloak/actions.ts`
- Modify: `src/browser/runtime/local-cloak/provider.ts`
- Test: `src/browser/runtime/local-cloak/session-manager.test.ts`
- Test: `src/browser/runtime/local-cloak/browser-run.test.ts`
- Test: `src/browser/runtime/local-cloak/provider.test.ts`

**Interfaces:**

- Consumes immutable `sessionId` and adapter tab key from Tasks 2-3.
- Produces `SessionRuntime` ownership of `windowIds`, `pages`, and `selectedPageId` under one `ProfileRuntime` context.
- Produces `SESSION_WINDOW_CONFLICT` before any operation on a tab whose actual `windowId` belongs to another Session.

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

Create another tab for `session_a` and assert it has `session_a`'s existing `windowId`, not `session_b`'s. Emit a popup with `opener() === first.page` and assert it inherits `session_a`, including when it has a child popup window.

Simulate a manual move by returning `session_b`'s window ID for an `session_a` target. Assert `list`, `select`, `bind`, and `close` reject with `SESSION_WINDOW_CONFLICT`, the page remains open, and neither ownership map changes.

- [ ] **Step 2: Run the local runtime tests and confirm Profile-global page state fails them**

Run:

```bash
npx vitest run --project unit src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/browser-run.test.ts src/browser/runtime/local-cloak/provider.test.ts
```

Expected: FAIL because `ProfileRuntime` has one global `pages` map/selection, `context.newPage()` does not establish distinct windows, and actions can see cross-Session tabs.

- [ ] **Step 3: Replace Profile-global page ownership with Session runtimes**

Use these internal shapes in `session-manager.ts`:

```ts
interface SessionRuntime {
  id: string;
  name: string;
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

Wait for the matching Playwright page, read `Browser.getWindowForTarget({ targetId })`, and register the window only if unowned or already owned by that Session. Later tabs use `window.open('about:blank', '_blank')` from an open owned page while the Profile creation lock is held, then verify the new target's `windowId` before registration.

- [ ] **Step 4: Register popups and verify ownership before every public action**

Listen to `context.on('page')`; resolve `await page.opener()`, copy the opener's immutable Session ID, then verify/register the popup target and `windowId`. If a page has no known opener, leave it unadopted until an explicit bind verifies that its window is unowned or owned by the selected Session.

All methods must take `sessionId`: `listPages`, `findPageById`, `selectPage`, `bindPage`, `closePage`, `newPage`, and `release`. Before returning/mutating a page, call one shared guard:

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

- [ ] **Step 5: Preserve fresh-page and adapter semantics inside the window group**

For `freshPage`, open and register the replacement in the same Session window first, update the selected and canonical adapter tab entries, then close the old target. `release` closes only ephemeral entries for that Session. Closing the last tab closes that Session's visible window targets but leaves sibling Session windows and the Profile context intact.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx vitest run --project unit src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/browser-run.test.ts src/browser/runtime/local-cloak/provider.test.ts
npm run typecheck
```

Expected: PASS; two Sessions receive distinct OS window IDs, tabs/popups stay in their owner, and a manual move is non-destructive.

Commit:

```bash
git add src/browser/runtime/local-cloak/session-manager.ts src/browser/runtime/local-cloak/actions.ts src/browser/runtime/local-cloak/provider.ts src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/browser-run.test.ts src/browser/runtime/local-cloak/provider.test.ts
git diff --cached --check
git commit -m "feat: isolate local sessions by cloak window"
```

---

### Task 5: Add the Hidden Anchor, Warm Profile Lifecycle, and Exact Teardown

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

- Produces one hidden Profile-owned `anchorTargetId` and one browser CDP session per live Profile runtime.
- Produces a fixed `PROFILE_IDLE_TIMEOUT_MS = 60_000`, `PROFILE_CLOSE_TIMEOUT_MS = 3_000`, and one per-Profile lifecycle lock shared by launch, cancellation, anchor repair, idle close, and recovery.
- Produces `findExactCloakProfileProcesses(userDataDir)` reused by locked-Profile recovery and background teardown.

- [ ] **Step 1: Add anchor and lifecycle race tests with fake timers**

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

Start a new command at `59_999` ms and assert it cancels eviction and reuses the context. Start a command after close begins and assert it waits, then all simultaneous callers receive one replacement runtime from one launch. Resolve `context.close()` after more than 3 seconds and assert exact recovery runs once before relaunch.

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

Expected: FAIL because no hidden anchor/timer exists, close and launch are separate paths, and the matcher accepts only a substring form.

- [ ] **Step 4: Create and maintain the hidden anchor**

Immediately after Cloak launch and before `profiles.set`, obtain `context.browser()`, create `browser.newBrowserCDPSession()`, and send:

```ts
const { targetId: anchorTargetId } = await cdp.send('Target.createTarget', {
  url: 'about:blank',
  hidden: true,
  background: true,
});
```

If the pinned runtime returns `null` from `context.browser()` or rejects the hidden target, fail launch and let the live gate block the release; do not fall back to a visible page. Store the anchor outside Session/page maps. Filter its `targetId` from all page events and public lists. If `Target.targetDestroyed` reports the anchor while the context is healthy, recreate it under the Profile lifecycle lock.

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

On timeout call exact Profile recovery and await it before the lock releases. Guard context `close` events by runtime object identity so an old event cannot delete a replacement.

- [ ] **Step 6: Extract and reuse the exact matcher**

Move process discovery out of `session-manager.ts`. Recognize a Cloak executable path first, then match only complete `--user-data-dir=/path` or `--user-data-dir /path` arguments, including single/double-quoted values. Both locked-profile recovery and Darwin background teardown call this helper. Session close never calls it.

- [ ] **Step 7: Verify issue #276 cycles and commit**

Run:

```bash
npx vitest run --project unit src/browser/runtime/local-cloak/process-matcher.test.ts src/browser/runtime/local-cloak/session-manager.test.ts src/browser/runtime/local-cloak/provider.test.ts src/browser/runtime/local-cloak/darwin-background-launch.test.ts
npm run typecheck
```

Expected: PASS for repeated release/close/fresh-page/idle cycles, zero-visible-window anchor reuse, shutdown cleanup, the close/arrival race, and `work` versus `work-2`.

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

### Task 7: Store and Resolve Hosted Sessions

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

- Produces `WebcmdSession`, `HostedSessionService.resolve(tenant, profile, selector?)`, and `list`.
- Extends `CloudRepository` with `getSession`, `getOrCreateSession`, `listSessions`, `touchSession`, `setSessionHandoff`, and `clearSessionHandoff`.
- Produces `GET /v1/sessions?profile=<selector>` returning persisted metadata plus runtime state derived from Browser allocations.

- [ ] **Step 1: Add schema, repository, and resolver tests**

Use this record shape in tests:

```ts
const session = {
  id: 'session_11111111-1111-4111-8111-111111111111',
  userId: tenant.userId,
  workspaceId: tenant.workspaceId,
  profileId: profile.id,
  name: 'invoice-audit',
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
  lastUsedAt: '2026-08-11T00:00:00.000Z',
};
```

Assert two concurrent `getOrCreateSession` calls for the same `(tenant, profileId, name)` return one ID; the same name in another Profile differs; omitted selector resolves `default`; unknown/cross-Profile immutable IDs throw `SESSION_NOT_FOUND`; listing does not create a row; handoff set/clear is owner-scoped.

For HTTP:

```ts
const response = await fetch(`${baseUrl}/v1/sessions?profile=work`, {
  headers: { authorization: `Bearer ${demoKey}` },
});
expect(await response.json()).toEqual({
  ok: true,
  sessions: [expect.objectContaining({
    id: session.id,
    name: 'invoice-audit',
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
  name text not null,
  handoff_site text,
  handoff_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (user_id, workspace_id, profile_id, name),
  unique (user_id, workspace_id, profile_id, id),
  constraint webcmd_sessions_profile_fkey
    foreign key (user_id, workspace_id, profile_id)
    references webcmd_profiles(user_id, workspace_id, id) on delete cascade
);
```

Add a guarded `0010_profile_sessions` block for existing databases that creates the same table and records the migration. Do not delete or rewrite current `browser_allocations` rows; they expire through the existing reaper and new code addresses only rows whose `session_key` equals a resolved immutable Session ID.

- [ ] **Step 4: Implement atomic repository semantics**

Define:

```ts
export interface GetOrCreateSessionInput {
  tenant: TenantContext;
  profileId: string;
  id: string;
  name: string;
}
```

PostgreSQL must use `insert ... on conflict (user_id, workspace_id, profile_id, name) do update set last_used_at = excluded.last_used_at returning *`; the Profile foreign key validates tenancy. The in-memory repository uses `JSON.stringify([userId, workspaceId, profileId, name])` and returns clones.

Handoff updates must require the full tenant/Profile/Session tuple and set both `handoff_site` and `handoff_expires_at`; `clearSessionHandoff` must use the same tuple and may optionally guard the expected site.

- [ ] **Step 5: Implement one resolver service**

Use the Profile service before Session resolution. `HostedSessionService` accepts an `idFactory` defaulting to `session_${randomUUID()}` and implements exactly:

```ts
async resolve(tenant: TenantContext, profile: WebcmdProfile, selector?: string): Promise<WebcmdSession> {
  const value = selector?.trim() || 'default';
  if (value.startsWith('session_')) {
    const found = await this.repository.getSession(tenant, profile.id, value);
    if (!found) throw new PublicHttpError(404, 'SESSION_NOT_FOUND',
      `Session ${value} was not found in Profile ${profile.displayName}.`, undefined, 66);
    return found;
  }
  return (await this.repository.getOrCreateSession({
    tenant, profileId: profile.id, id: this.idFactory(), name: value,
  })).session;
}
```

Clear expired handoff metadata when resolving/listing. Do not create an explicit create endpoint.

- [ ] **Step 6: Add the list endpoint and verify**

`GET /v1/sessions` authenticates the tenant, resolves the requested/default Profile, lists rows, and joins active `browser_allocations` in memory by `session_key === session.id`. Return `runtimeState: 'active'|'idle'` and `handoff: null|{site,expiresAt}`; never expose Browser Use IDs, CDP URLs, or viewer tokens.

Run:

```bash
npx vitest run tests/schema.test.ts tests/repository.test.ts tests/sessions-service.test.ts tests/http-sessions.test.ts tests/postgres-repository.integration.test.ts
npm run typecheck
```

Expected: PASS; friendly creation is atomic and immutable IDs remain tenant/Profile scoped.

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

Rename only TypeScript symbols and public copy to `Session`; keep the physical table name to avoid a second migration. Conflict response is HTTP 409, code `SESSION_BUSY`, exit 75, safe Session name/ID plus holder command/timestamps, never `ownerExecutionId`.

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

- Consumes `session?: string` from `/v1/execute` and raw-browser path selectors, then resolves them with `HostedSessionService`.
- Acquires the Task 8 admission lease after the trusted execution row exists and before auth, allocation, CDP, pre-navigation, worker, or adapter work.
- Keys persistent adapter tabs by `(profileId, sessionId, site)` and uses the same Session allocation for raw actions.

- [ ] **Step 1: Add trusted-boundary, no-queue, and cross-surface tests**

Send an execute body containing a fake `executionId` and assert the server ignores/rejects it while minting its own execution. Hold `session_a`, then submit raw browser and adapter commands to it and assert immediate 409 `SESSION_BUSY` with zero Browser Use/worker calls. Submit the same commands to `session_b` and assert they run before `session_a` releases.

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

Add `session?: string` validation to `readExecuteRequest`; reject non-string values. Resolve Profile, then Session, before calling adapter/auth browser code. For prepared executions, persist no caller ownership token: reuse the existing queued execution ID only after `startQueuedExecution` succeeds.

For raw browser paths, treat the encoded segment as a selector, resolve it, and pass both `session.id` and `session.name` to `HostedBrowserController`. Its execution records and public run output use the immutable ID for ownership and may include the friendly name for display.

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

Expected: PASS; Session admission is immediate, trusted, cross-surface, and parallel across siblings.

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

Use code `SESSION_PAUSED_FOR_HUMAN_HANDOFF`, HTTP 409, and exit 77. Return Session ID/name and expiry but never the sibling view URL or Browser Use identifiers.

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
- Produces `HostedClient.listSessions(profile?)` and hosted `webcmd --profile work session list` rendering.
- Fails incompatible CLI/server pairs with `HOSTED_CONTRACT_MISMATCH` before `/v1/execute` or `/v1/browser/...` is called.

- [ ] **Step 1: Add fail-fast and list tests**

For an old manifest, assert zero browser/execute calls:

```ts
await expect(runHostedCli(['--session', 'work-a', 'github', 'issues'], oldServerOptions))
  .resolves.toMatchObject({ exitCode: 78 });
expect(requests.map(request => request.pathname)).toEqual(['/v1/manifest']);
expect(stderr).toContain('HOSTED_CONTRACT_MISMATCH');
```

For a compatible server:

```ts
await runHostedCli(['--profile', 'work', 'session', 'list', '-f', 'json'], options);
expect(requests.at(-1)?.url).toContain('/v1/sessions?profile=work');
expect(JSON.parse(stdout)).toEqual([
  expect.objectContaining({ id: 'session_a', name: 'invoice-audit' }),
]);
```

Assert completion includes root `--session` and `session list`, and contains no `browser <session>` template.

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

Add `HostedSessionsResponse` validator and `listSessions(profile?)`, then route `session list` through it and existing renderer. Replace completion/help templates with:

```ts
`${CLI_COMMAND} [--profile <name>] [--session <name-or-id>] browser <command> [args] [options]`
```

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

1. `resolveCloakBrowserVersion()` is exactly `0.4.5`, and the runtime-reported Chromium version is `145.0.7632.159`.
2. Two Profile contexts with distinct temp user-data directories launch through `Promise.all` and both navigate.
3. Two Sessions in one Profile receive distinct window IDs and navigate simultaneously.
4. Same-Session extra tabs and popups retain ownership; background creation does not change `document.hasFocus()` in the foreground human window.
5. Closing Session A leaves Session B operational and leaves the Profile connected behind the hidden anchor at zero visible windows.
6. A new Session opens during the warm period; another opens during forced idle close and receives one clean replacement runtime.
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

Expected: unit tests PASS; on the supported macOS release host, the live suite PASSes every listed invariant. Any live failure blocks release and returns the pinned runtime/launcher to repair.

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
- Active examples use friendly names for normal work and immutable Session IDs for handoff verification.

- [ ] **Step 1: Add documentation/skill contract tests first**

In `skills.test.ts`, require all six bundled skills to use root syntax and explain Session selection where relevant:

```ts
expect(browserSkill).toContain('webcmd --session work browser run --stdin');
expect(browserSkill).toContain('webcmd --profile work session list');
expect(browserSkill).toMatch(/different agents[\s\S]*different Sessions/i);
expect(usageSkill).toMatch(/SESSION_BUSY[\s\S]*same Session/i);
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
Profile = persistent login state (cookies and browser storage).
Session = one agent task's browser workspace and command lock.
Tab = a page owned by that Session.
```

Document:

- omitted selector lazily uses `default`; a new friendly name is lazily created;
- `webcmd --profile work session list` lists stable IDs and state;
- parallel agents choose distinct names, for example `--session invoice-audit` and `--session research`;
- local Sessions are distinct Cloak windows inside one Profile context; hosted Sessions consume distinct Browser Use allocations;
- local zero-window Profiles remain warm behind an invisible anchor for 60 seconds;
- already-running hosted allocations do not receive live cookie injection;
- overlapping same-Session commands can receive `SESSION_BUSY`, including commands from the same agent/PID; sequential commands work;
- a handoff pauses only its Session and the returned immutable-ID `verify_command` is authoritative.

Use canonical examples:

```bash
webcmd --profile work --session invoice-audit github issues
webcmd --profile work --session invoice-audit browser run --stdin
webcmd --profile work session list
```

- [ ] **Step 4: Update all active skill examples and error playbooks**

Replace positional browser calls in each selected skill and its directly referenced active example files. Teach `SESSION_NOT_FOUND`, `SESSION_BUSY`, `SESSION_PAUSED_FOR_HUMAN_HANDOFF`, and `SESSION_WINDOW_CONFLICT` as structured runtime states, not adapter breakage. Keep the existing prohibition on agents entering passwords, OTPs, cookies, recovery codes, or CAPTCHAs.

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

Expected: migrations `0010_profile_sessions` and `0011_session_browser_leases` are idempotent; concurrent friendly creation returns one row; Session leases arbitrate across two pools.

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

On the release candidate, run two shells against one Profile:

```bash
webcmd --profile release-work --session agent-a browser run --stdin <<'JS'
await page.goto('data:text/html,<title>agent-a</title>');
await new Promise(resolve => setTimeout(resolve, 15000));
return { title: await page.title() };
JS
webcmd --profile release-work --session agent-b browser run --stdin <<'JS'
await page.goto('data:text/html,<title>agent-b</title>');
await new Promise(resolve => setTimeout(resolve, 15000));
return { title: await page.title() };
JS
webcmd --profile release-work session list -f json
```

Start the first two heredocs in separate shells so their 15-second holds overlap. Expected: distinct local windows or hosted live views, both commands progress, and list returns two stable IDs. During that hold, launch the same `agent-a` command from a third shell; expected `SESSION_BUSY` while `agent-b` remains usable. Run a login in `agent-a`; expected its returned verify command contains `--session session_...`, `agent-a` pauses, and `agent-b` continues.

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
| Root selector, lazy/default resolution, immutable IDs, listing | Tasks 1-2, 7, 12 |
| Parallel Sessions, immediate same-Session busy, same-run re-entry | Tasks 3, 8-9 |
| Local Session windows, tab/popup ownership, manual-move error | Task 4 |
| Issue #276 anchor and close/arrival race | Task 5 |
| Issue #242 exact Profile teardown | Tasks 5 and 13 |
| Issue #225 pinned concurrent Cloak guarantee | Task 13 |
| One Browser Use allocation/live view per hosted Session | Tasks 8-10 |
| Session-scoped local/hosted handoff with sibling continuation | Tasks 6, 10, 14 |
| Browser Use same-Profile storage merge in both stop orders | Task 14 |
| Capability break for incompatible CLI/cloud pairs | Tasks 11-12 |
| Help, completion, docs, harness guides, and bundled skills | Tasks 12 and 15 |
| Full build, packed parity, PostgreSQL, live gates, smoke test | Task 16 |
