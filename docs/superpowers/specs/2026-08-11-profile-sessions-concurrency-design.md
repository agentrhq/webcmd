# Webcmd Profile Sessions and Concurrency Design

**Status:** Approved design; implementation plan updated

**Date:** 2026-08-11

## Context

Webcmd runs locally through a Cloak-backed daemon and remotely through Webcmd Cloud with
Browser Use. Multiple agents must be able to work concurrently with the same authenticated
identity without sharing tabs, selecting each other's pages, or corrupting browser state.

Webcmd already uses the word `session`. This design keeps that name and makes a Session the
explicit browser-workspace and command-admission boundary. It supersedes
`2026-08-06-profile-spaces-design.md`; Webcmd will not add a separate Space primitive.

This design also addresses:

- [#225](https://github.com/agentrhq/webcmd/issues/225): the distributed Cloak/browser pair
  must support concurrent Profile contexts and Session windows.
- [#242](https://github.com/agentrhq/webcmd/issues/242): Profile teardown must match the exact
  Cloak process and never a prefix-sharing Profile or unrelated Chrome process.
- [#276](https://github.com/agentrhq/webcmd/issues/276): closing the final task page must not
  return a dying Profile runtime to an immediately arriving command.

The design assumes Webcmd pins and distributes a Cloak/browser pair whose concurrency and
window behavior pass the release gates below. There is no product branch for a less capable
unpinned runtime.

## Final decisions

1. A Profile is the persistent authentication jar. Sessions under it deliberately share
   cookies and browser storage.
2. A Session is a durable browser-workspace identity with an opaque, Webcmd-generated
   `session_...` ID. Callers do not choose Session names.
3. Raw `browser` commands require an explicitly supplied existing Session ID. Omission is a
   usage error; there is no raw-browser default and no PID-derived or process-global current
   Session.
4. `session create` creates a new ID. `session list` discovers existing IDs. Passing an ID in
   `--session` is the only attach operation; there is no separate `session bind` command.
5. `session close` intentionally stops that Session's local window group or hosted allocation
   and frees runtime capacity. It is idempotent, preserves the durable record, and is not a
   delete, complete, or takeover operation.
6. Adapter commands remain CLI-like. A non-browser adapter allocates no Session. A
   browser-backed adapter may omit `--session`, in which case Webcmd lazily uses one
   system-managed adapter-default Session for the Profile. An explicit Session ID overrides
   the default.
7. `siteSession: persistent|ephemeral` controls adapter-tab lifetime inside the resolved
   Session; it never creates or selects the user Session.
8. Local Sessions own exclusive Cloak window groups inside one Profile `BrowserContext`.
   Hosted Sessions own separate Browser Use allocations created from the same Profile.
9. Admission is intentionally keyed by immutable Session ID, not site. One top-level execution
   owns a Session at a time; sibling Sessions run concurrently.
10. A human authentication handoff pauses only the Session that requested it. Sibling Sessions
    under the same Profile continue.

The create/list/opaque-ID flow follows the useful part of ego-lite's agent experience—agents
receive isolated workspaces and can enumerate them—without introducing ambient UI selection
into a shell CLI. Explicit IDs are important because independent agent harnesses do not share
a trustworthy process-local “current Session.”

## Goals

- Let multiple agents use one authenticated Profile concurrently without sharing pages.
- Make accidental same-Session attachment impossible when callers follow the create-and-carry
  contract.
- Give adapters an ergonomic default while preserving explicit isolation for parallel work.
- Give local and hosted modes the same Session identity, admission, close, and handoff model.
- Scope every tab/page API, including `browser run` and `--page`, to the selected Session.
- Preserve Session records across browser, daemon, or allocation restarts without promising
  tab restoration.
- Fix #225, #242, and #276 as part of the same lifecycle and concurrency change.
- Update help, completion, docs, generated hints, and bundled agent skills in the same release.

## Non-goals

- Cookie isolation between Sessions; use separate Profiles for separate identities.
- A process-global `session use`, `session bind`, caller-chosen Session name, or PID default.
- `session delete`, `session complete`, or `session takeover` in v1.
- Restoring tabs after a Profile runtime or hosted allocation is evicted.
- Live injection of newly persisted hosted cookies into already-running sibling allocations.
- A Webcmd-owned cookie/storage merge layer for Browser Use.
- Arbitrary CDP target reparenting; Chromium exposes no API to move a target into a chosen
  existing window.
- A general output-format migration. New Session output is compact and structured using the
  existing renderer; unrelated commands keep their current defaults.

## Concepts and invariants

| Concept | Responsibility |
|---|---|
| Profile | Persistent authentication state: cookies, local storage, and provider Profile data. |
| Local Profile runtime | One persistent Cloak `BrowserContext` plus lifecycle keeper for a Profile. |
| Session | Durable task identity, exclusive command-admission key, and owner of one local window group or one hosted allocation. |
| Window group | One or more OS windows owned exclusively by one local Session. A window never mixes Sessions. |
| Tab | A Playwright `Page` owned by one Session. `Page` and CDP `Target` are implementation terms. |
| Adapter-default Session | Lazily created system Session used only when a browser-backed adapter omits `--session`. |
| Profile keeper | Local-only runtime-owned target/window that prevents the final task-tab race during the fixed warm period. |

Session IDs are globally unambiguous and immutable. Session records are scoped and authorized
through their Profile even though the ID is globally unique. Every lookup verifies the selected
Profile; a cross-Profile ID returns `SESSION_NOT_FOUND`.

A local window belongs to at most one Session. A Session may own more than one window because
CDP can request a new window but cannot place a new target into a specified existing window.
Every tab, selected tab, popup, network capture, browser-run page, and page ID belongs to exactly
one Session.

## CLI and agent experience

`--session <session-id>` is a root selector alongside `--profile`:

```bash
webcmd --profile work session create
webcmd --profile work session list
webcmd --profile work --session session_7d8f... browser run --stdin
webcmd --profile work --session session_7d8f... github issues
webcmd --profile work session close session_7d8f...
```

The existing positional raw-browser syntax is removed:

```text
webcmd browser work run   # invalid
```

It is not retained as a compatibility alias. The parser returns exit code 2 with the canonical
root form. A raw browser command without `--session` returns `SESSION_REQUIRED`, exit code 2,
and complete next actions:

```text
error: SESSION_REQUIRED
help[2]:
  webcmd --profile <profile> session create
  webcmd --profile <profile> session list
```

The selector must be an opaque `session_...` ID. Friendly arbitrary strings are rejected as
usage errors rather than lazily creating a shared name.

### `session create`

`webcmd --profile <profile> session create` atomically inserts a new durable record and returns
at minimum its `id`, `kind`, and `runtimeState`. It does not launch a browser. Each successful
call creates a different ID, so concurrent agents cannot collide on a shared name. Agents call
it once per browser task and carry the returned ID in every later raw-browser invocation.

### `session list`

`webcmd --profile <profile> session list` is read-only and does not launch a browser or create
the adapter default. Its default row schema is intentionally small:

```text
sessions[N]{id,kind,runtimeState,handoff}:
```

`kind` is `explicit` or `adapter-default`. Detail fields such as timestamps are available
through the existing field/format mechanisms. An empty list explicitly reports zero Sessions.

Listing is how a human or agent resumes a known Session. “Attaching” means selecting one of
those IDs with `--session`; a separate bind command would only duplicate the selector.

### `session close`

`webcmd --profile <profile> session close <session-id>` closes only the selected Session's local
windows or hosted allocation, clears its selected-tab/runtime metadata, and releases its live
view and expired handoff metadata. It preserves the Session record so the ID can be reused later, at which point
a fresh window/allocation is opened with the Profile's persisted authentication state. Closing
an already-idle Session is a successful no-op.

Before this design, “sessions” were implicit page-lease keys. Tabs were closed through browser
tab/close operations or adapter release, and the daemon/browser lifecycle eventually reclaimed
the runtime. There was no durable task-level runtime to close. The new command exists so agents
and humans can deliberately free a window or hosted allocation/quota slot; automatic idle and
shutdown cleanup still remains.

`session close` fails with `SESSION_BUSY` while another execution owns the Session and with
`SESSION_PAUSED_FOR_HUMAN_HANDOFF` while a human controls it. It never steals either owner.

### Tabs and binding

Existing browser tab commands remain Session-scoped. `browser tabs`, `browser tabs select`,
`browser tabs close`, and `browser bind --page <id>` can see or mutate only tabs owned by the
explicit Session ID. `browser bind` binds a tab within that Session's own window group; it is
not a way to move a tab or Session across ownership boundaries.

The adapter-default row is not an implicit raw-browser choice. Because it is still a real listed
Session, a caller may deliberately pass its ID to a raw command; doing so knowingly shares
admission and tabs with default-routed adapters.

## Adapter routing

Session resolution depends on whether the adapter actually needs browser state:

| Invocation | Session behavior |
|---|---|
| Non-browser/API/local-tool adapter | Ignore omitted `--session`; create no Session, allocation, or lease. If an explicit ID is supplied, validate it but do not launch a browser. |
| Browser-backed adapter, explicit ID | Use that existing Session. Unknown IDs fail; no lazy explicit creation. |
| Browser-backed adapter, omitted ID | Resolve or lazily create the Profile's single system `adapter-default` Session. |
| Raw browser command | Require an existing explicit ID; never use the adapter default implicitly. |

Within the resolved Session:

- A persistent adapter tab is keyed by `(profileId, sessionId, site)` and is reused by later
  persistent commands in that same Session.
- An ephemeral adapter command creates a tab in the Session's window group/allocation and closes
  that tab when the command ends. It does not mint a Session or a window group of its own.
- Closing an ephemeral tab does not close the Session while other tabs exist. When it was the
  final task tab, the Profile keeper/lifecycle rules below prevent #276.
- An explicit Session is the opt-in escape hatch when concurrent adapters would otherwise
  collide on the adapter-default Session.

Admission remains Session-wide, including across sites. This is an intentional safety tradeoff:
`github issues` and `linkedin posts` overlap only if they target the same Session. A caller that
needs them in parallel creates two Sessions. This avoids a site-keyed admission scheme that
would still let `browser run` race both site tabs.

This routing removes today's `site:<site>:<uuid>` Session creation for ephemeral adapters and
therefore avoids one OS window or hosted allocation per one-shot command.

## Runtime architecture

### Shared model

```text
Profile authentication state
├── Session session_A
│   ├── local: exclusive window group
│   └── hosted: Browser Use allocation + live URL
├── Session session_B
│   ├── local: exclusive window group
│   └── hosted: Browser Use allocation + live URL
└── adapter-default Session (only after first browser-backed adapter without --session)
```

Sessions never share a visible local window, hosted allocation, live-view URL, selected tab, or
command lease. They intentionally share the Profile's persisted authentication state.

### Local Cloak Profile context

Local mode uses one persistent `BrowserContext` per Profile. This is the cookie/storage scope,
not the Session scope. Multiple Session window groups live inside it and therefore observe the
same Profile authentication changes.

The first task page for a Session is created with CDP
`Target.createTarget({ newWindow: true })`. Webcmd records the target ID and its actual
`windowId` before making it public.

Chromium has no CDP method that creates a target in a specified existing `windowId`, and its
window APIs cannot reparent targets. Therefore later tabs use this explicit policy:

1. If the Session has an owned page, call `window.open` from that page under the existing short
   per-Profile creation lock. The pinned background launcher includes
   `--disable-popup-blocking` so this path is not dependent on a user gesture.
2. Inspect the created target's actual `windowId`.
3. If Chromium placed it in an already owned Session window, register it there.
4. If Chromium created a new window, add that window to the same Session's window group.
5. Never loop hoping for a particular window, never reparent, and never register a target in a
   window owned by a sibling Session.

The pinned-runtime live gate must prove both foreground and background paths. A failure blocks
the pinned runtime/launcher release; it does not weaken Session isolation.

Site-created tabs and popups inherit ownership from a known opener. Pages without a known
opener remain unowned until a Session-scoped bind verifies that their window is either unowned
or already belongs to the selected Session. A manual cross-Session tab move returns
`SESSION_WINDOW_CONFLICT` without reassigning or closing the page.

`selectedPageId` is stored per Session, never per Profile. Every page lookup accepts both
`sessionId` and `pageId`; a globally unique page ID is not authorization. The test that currently
allows a misleading Session/Profile to resolve `--page` is replaced with a cross-Session denial
test.

### `browser run` isolation

The QuickJS sandbox must not receive the raw Profile `BrowserContext`. Its Playwright transport
receives a Session-scoped context facade whose:

- `pages()` returns only owned Session pages and never the keeper/anchor or sibling pages;
- `newPage()` routes through the Session window-creation policy above;
- page events are filtered to targets attributed to the Session;
- context/browser close and unrestricted browser-level CDP operations remain denied.

The Session manager owns the one context-wide `page` listener. `browser run` no longer installs
a listener that labels every new context page with the command's Session. Runner startup
registers only the selected Session's existing pages. A one-line program in Session A therefore
cannot enumerate or close Session B's tab or the Profile keeper.

Cookie APIs continue to act at Profile scope because Profile authentication is deliberately
shared. Documentation must make this boundary explicit: Sessions isolate browser workspaces,
not credentials.

### Hosted Browser Use

Hosted mode uses one Browser Use allocation per active Session. Every allocation is created
from the same Browser Use Profile ID but has its own CDP endpoint, tabs, live-view URL, timeout,
and lifecycle. The durable key is `(userId, workspaceId, profileId, sessionId)`; the current
one-allocation-per-Profile collapse is removed.

New or restarted allocations load persisted Profile state. Webcmd does not promise live cookie
injection into a sibling allocation that is already running. Before release, a live gate starts
two allocations from one Profile, writes different-domain cookies and local storage, stops them
in both orders, and proves that a later allocation loads both markers. Failure returns the
architecture to design review; it does not trigger Webcmd-owned synchronization.

Hosted adapter `/v1/execute` accepts an optional `session` field. Raw browser endpoints require
the Session ID in their existing route/command contract. The public manifest advertises Session
protocol capability so incompatible CLI/server pairs fail before browser work.

Allocation-capacity failures use a dedicated structured `SESSION_CAPACITY_EXCEEDED` response,
not a generic provider error. It includes safe `active` and `limit` counts when known, whether
retrying after another Session closes can succeed, and help for `session list`, `session close`,
or plan upgrade. Provider internals, CDP URLs, and allocation IDs remain private.

## Concurrency and execution admission

- Different Profiles run concurrently.
- Different Sessions in one Profile run concurrently.
- A different overlapping top-level execution in the same Session fails immediately with
  `SESSION_BUSY`; it does not wait in an invisible public queue.
- Nested operations from the same logical execution may re-enter admission and may use a small
  defensive internal queue.
- The brief local target/window creation critical section remains per Profile.
- Hosted allocations require no cross-Session browser lock.

Admission distinguishes logical executions, not sources, agents, processes, sites, or clients.
Every top-level browser-backed adapter invocation and every raw browser invocation receives a
unique trusted execution ID before its first daemon/provider operation. Two rapidly launched
commands from the same agent and PID have different IDs and conflict if they overlap; two truly
sequential commands do not.

Local raw browser commands must enter `runWithDaemonRunContext`; merely widening
`isSessionLeaseCommand` without minting a `runId` is a no-op. The current `access` field is
removed from the lease predicate and daemon protocol because the sender hardcodes it to
`write`; it is not used to reason about safety.

The local lease registry remains the implementation, re-keyed to `(profileId, sessionId)` and
broadened to all browser-backed commands. It also gains bounded owner recovery:

1. CLI `SIGINT`/`SIGTERM` handlers send a best-effort cancel for the current run.
2. Daemon request disconnect/cancel aborts the tracked operation and releases admission only
   after its `finally` settles.
3. If a new acquisition finds a recorded holder PID is dead, the daemon aborts that holder's
   tracked work and waits a short bounded cleanup interval before retrying acquisition. It does
   not allow overlapping work merely because the PID disappeared.
4. The existing 45-second heartbeat TTL remains only the final unknown-outcome recovery path.
5. Busy hints check PID liveness and never tell the caller to kill a PID already known dead.

Hosted mode mints ownership at the trusted server execution boundary. Caller-supplied execution
IDs cannot impersonate an owner. Both providers release only after the top-level outcome and
cleanup are known.

## Profile keeper, lifecycle, and issue #276

The Profile keeper is runtime-owned and never appears in Session tab APIs, selection, snapshots,
network capture, or `browser run`.

On macOS with the pinned Chromium pair, the keeper is one hidden background CDP target created
with `Target.createTarget({ hidden: true, background: true })`. Its browser-level CDP session is
retained for the complete Profile runtime lifetime; detaching it would destroy the hidden
target. The target ID is filtered before Playwright page adoption or context-wide page events
can register it.

A hidden target does not keep Chromium alive at zero windows on Linux and Windows. On those
platforms, when the final Session task page would close, Webcmd parks one final page as a
Profile-owned `about:blank` keeper window for the fixed warm period and minimizes it where the
platform supports that operation. It is excluded from public APIs. A user can close this
parking window; that only forfeits the warm runtime, and the next command launches a fresh one.
The design does not falsely claim an invisible zero-window keeper on those platforms.

When the Profile has no task pages, active commands, or handoffs, Webcmd starts one fixed
60-second unreferenced idle timer. New work cancels it under the Profile lifecycle lock.

If the timer fires, it acquires that same lock, rechecks the conditions, removes the exact
runtime from the reusable map, and closes the context before allowing relaunch. A command that
wins first reuses the runtime. A command that arrives after closing starts waits for closure and
then joins one single-flight relaunch. A closing runtime is never returned, and a late close
event from an old generation cannot invalidate its replacement.

`freshPage` creates and registers the replacement before closing or parking the old page.
Keeper loss recreates or relaunches under the same lifecycle lock. If graceful close exceeds
three seconds, exact Profile recovery from #242 completes before the lock releases.

`shutdown()` first marks the manager as shutting down, awaits every `profileLaunches` promise,
closes any runtime that completed during shutdown, and only then clears the maps. A launch may
not publish a runtime after shutdown begins. This prevents an invisible leaked browser process.

Hosted allocations need no keeper because ending one Session cannot invalidate a sibling
allocation.

## Pinned Cloak concurrency and issues #225/#242

Webcmd pins `cloakbrowser` `0.4.5`, Playwright Core `1.61.1`, and Chromium
`v145.0.7632.159`. Release evidence, not runtime licence probing, defines support. The live gate
must prove:

- two Profile contexts with separate user-data directories launch and navigate concurrently;
- two Sessions in one Profile navigate concurrently in distinct exclusive window groups;
- additional tabs/popups remain owned and background creation does not steal human focus;
- the platform keeper strategy survives final-task-page close and immediate reuse;
- idle close versus concurrent arrival produces one clean replacement runtime;
- closing one Session leaves its sibling usable;
- foreground and background launch paths remain connected.

There is no `CLOAK_CONCURRENCY_LIMIT` fallback. A failure blocks the pinned package/artifact.

All discovery and teardown paths reuse one exact Cloak Profile matcher. It recognizes Cloak
browser commands, parses complete `--user-data-dir` arguments and supported spelling/quoting
forms, distinguishes `work` from `work-2`, and never terminates unrelated Chrome/Chromium.
Closing a Session never invokes Profile process teardown.

## Human authentication handoff

The existing `login -> human action -> returned whoami` protocol remains public. There are no
generic handoff, takeover, or complete commands.

When login needs human action:

1. Resolve the adapter's explicit or adapter-default immutable Session.
2. Mark only that Session human-controlled.
3. Local mode foregrounds one of its owned windows; hosted mode returns only its allocation's
   live-view URL.
4. Return `action_required`, expiry, and a verify command containing the same Profile and
   immutable Session ID.
5. Normal commands in that Session fail immediately with
   `SESSION_PAUSED_FOR_HUMAN_HANDOFF`; they do not queue.
6. Only server-classified verification for the same site and Session may proceed.
7. Successful `whoami` or expiry clears the handoff.

Sibling Sessions continue and never receive the handoff URL or pause error. Profile auth saved
by the human becomes available according to the local shared-context and hosted persisted-
Profile semantics already described.

## Errors

| Code | Meaning |
|---|---|
| `SESSION_REQUIRED` | A raw browser command omitted `--session`; exit 2 includes create/list help. |
| `SESSION_NOT_FOUND` | The opaque ID is unknown or does not belong to the selected Profile. |
| `SESSION_BUSY` | Another execution currently owns the selected Session. |
| `SESSION_PAUSED_FOR_HUMAN_HANDOFF` | A human controls the selected Session. |
| `SESSION_WINDOW_CONFLICT` | A local tab is in a window owned by another Session. |
| `SESSION_CAPACITY_EXCEEDED` | Hosted concurrent-allocation capacity is exhausted; response says whether close/wait or upgrade is actionable. |

Errors are structured consistently across local and hosted modes. Usage mistakes exit 2;
temporary ownership/capacity errors use the existing temporary-failure convention. Errors
include safe Session and holder metadata but never internal execution IDs, tokens, CDP URLs, or
provider stack traces.

## Documentation and skills

The same release updates root/browser/session help, completions, README, active browser/auth
docs, harness setup guides, generated hints, hosted contracts, and bundled `webcmd-usage`,
`webcmd-browser`, `webcmd-autofix`, adapter-author, sitemap-author, and browser-sitemap skills.

They must teach:

- Profile = shared authentication; Session = task browser workspace/lock; tab = owned page.
- Raw agents run `session create` once, save the ID, and pass it to every browser command.
- `session list` resumes known IDs; passing the ID is attachment; no bind command exists.
- `session close` frees a window/allocation and is not tab close or record deletion.
- Learned adapter commands do not require ceremony: non-browser adapters allocate nothing and
  browser-backed adapters use the adapter default unless explicitly isolated.
- Ephemeral/persistent describe tab lifetime, not Session creation.
- Separate agents use separate explicit Session IDs; same-Session overlap may return busy even
  for one PID or one agent.
- Local Sessions are exclusive window groups; hosted Sessions consume separate allocations.
- Cookie state is Profile-shared, while pages, selection, live views, and handoffs are Session-
  scoped.
- The returned immutable-ID verify command is authoritative and sibling Sessions continue.

Active examples use opaque IDs, not caller-chosen names. Historical specs remain historical.

## Verification

Automated and live checks cover:

1. `session create/list/close`, opaque-ID validation, Profile scoping, restart persistence, and
   definitive empty/no-op output.
2. Raw omission returning `SESSION_REQUIRED`; adapters using explicit/default/no Session
   according to browser need; positional syntax rejection.
3. No per-command Session/window explosion for ephemeral adapters; persistent site tabs remain
   keyed inside the resolved Session.
4. Parallel Sessions and Profiles; immediate same-Session busy; same-run re-entry; same-agent
   overlapping conflict; sequential success.
5. Signal/disconnect cancellation, dead-PID cleanup, no unsafe overlap, and TTL fallback.
6. Per-Session selected tab and strict Session checks on every `--page` action.
7. `browser run` seeing only owned pages, creating only owned pages, and never adopting sibling
   or keeper targets through context-wide events.
8. First-window creation, same-window/new-window follow-up policy, popup inheritance, focus, and
   non-destructive manual-move conflicts.
9. macOS hidden keeper and Linux/Windows parking keeper behavior, including accidental keeper
   close and immediate relaunch.
10. Idle expiry/arrival race, `freshPage`, bounded close, late-generation events, and shutdown
    awaiting in-flight launches.
11. Exact `work` versus `work-2` teardown and unrelated Chrome exclusion.
12. One hosted allocation/live view per Session, explicit capacity errors, and adapter
    `/v1/execute` routing.
13. Same-Profile Browser Use persistence in both stop orders.
14. Session-scoped local/hosted handoff with a sibling continuing throughout.
15. Pinned Cloak concurrency gates for #225 and lifecycle coverage for #242/#276.
16. Help, generated surfaces, active docs, and skills teaching only the canonical contract.

## Rollout

This is one coordinated local/cloud contract change. The cloud advertises Session protocol v1;
the CLI refuses incompatible hosted browser work before execution. Rollout drains the old
Profile-keyed browser-worker revision, waits at least the existing 45-second lease TTL, applies
the Session schema, and then enables Session-keyed traffic. Legacy and Session-keyed browser
workers do not run concurrently.

The CLI syntax break ships with targeted migration errors. There is no long-lived positional or
friendly-name compatibility shim.
