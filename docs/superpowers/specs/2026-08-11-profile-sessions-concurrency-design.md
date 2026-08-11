# Webcmd Profile Sessions and Concurrency Design

**Status:** Approved design, pending implementation plan

**Date:** 2026-08-11

## Context

Webcmd runs locally through a Cloak-backed daemon and remotely through Webcmd Cloud with
Browser Use. Multiple agents must be able to work concurrently with the same authenticated
identity without sharing task tabs or corrupting browser state.

Webcmd already uses the word `session` in its browser runtime. This design keeps that name
and promotes it into the user-facing task boundary. It supersedes the task-space model in
`2026-08-06-profile-spaces-design.md`; Webcmd will not add a separate Space primitive.

This design also addresses:

- [#225](https://github.com/agentrhq/webcmd/issues/225): reliable concurrent Cloak profiles.
- [#242](https://github.com/agentrhq/webcmd/issues/242): exact profile process matching during teardown.
- [#276](https://github.com/agentrhq/webcmd/issues/276): closing the final leased tab must not invalidate a shared profile runtime.

## Goals

- Let different agents run concurrently in separate Session browser workspaces under one Profile.
- Make a local Session a Cloak window group and a hosted Session a Browser Use allocation.
- Reuse Profile authentication while isolating each Session's tabs, live view, and runtime lifecycle.
- Use one consistent Session selector for adapters and raw browser commands.
- Preserve Session identity across browser or daemon restarts without promising tab restoration.
- Make same-Session collisions and human handoffs explicit to agents.
- Give local Cloak and hosted Browser Use the same Session selection, ownership, and handoff behavior.
- Update user documentation, CLI help, and bundled agent skills as part of the release.

## Non-goals

- Cookie isolation between Sessions; Profile authentication is intentionally reusable.
- Arc-style spaces, tab groups, colors, themes, or pinned tabs.
- Automatic tab restoration after a Profile runtime is restarted or evicted.
- Live injection of newly changed hosted cookies into already-running Browser Use allocations.
- `session create`, `session complete`, `session takeover`, or a process-global current Session.
- A user-configurable local Profile warm period; v1 uses a fixed 60 seconds.
- Cloak licence/capability detection or a degraded single-context mode.
- A general output-format migration; existing output defaults remain unchanged.

## Concepts

| Concept | Responsibility |
|---|---|
| Profile | Persistent authentication state: cookies, local storage, and Cloak/Browser Use profile data. |
| Local Profile runtime | One persistent Cloak browser context for a Profile, shared by its Session windows. |
| Session | Persistent logical identity for one agent task. Owns a local window group or one hosted allocation, plus its tabs and command admission. |
| Tab | A Playwright `Page` owned by a Session. `Page` remains an implementation term. |
| Anchor target | Local-only, hidden Profile-owned CDP target that keeps Cloak alive with no visible Session windows. |

Session names are unique within a Profile. Immutable `session_...` IDs are globally
unambiguous. A browser window never mixes tabs from different Sessions. Sessions under the
same Profile cannot list, select, bind, close, or otherwise act on each other's tabs.

## CLI contract

`--session <name-or-id>` is a root selector alongside `--profile`:

```bash
webcmd --profile work --session invoice-audit github issues
webcmd --profile work --session invoice-audit browser run --stdin
webcmd --profile work session list
```

The existing positional raw-browser syntax is removed:

```text
webcmd browser invoice-audit run   # invalid
```

It is not retained as a compatibility alias. The parser returns a usage error with exit code
2 and the replacement command. Runtime help, completion, hosted argument routing, generated
hints, tests, documentation, and bundled skills must all use the root flag.

### Resolution

1. Resolve the Profile exactly as Webcmd does today.
2. If `--session` is omitted, resolve the reserved Session name `default` in that Profile.
3. If the selector is a known name, reuse its immutable ID.
4. If the selector is a missing name, lazily create it and return its ID.
5. If a `session_...` ID does not exist or does not belong to the selected Profile, return
   `SESSION_NOT_FOUND`; never create an ID supplied by the caller.

There is no PID-derived default and no process-global `session use` state. Parallel agents
must not overwrite an ambient selection. Explicit `session create` adds no value because
normal use already creates atomically and idempotently.

### Listing and persistence

`webcmd --profile <profile> session list` returns the Profile's Sessions with stable ID,
name, current runtime state, last activity, and handoff state. The default human format and
machine formats follow existing CLI output conventions.

Session metadata persists locally in Webcmd state and remotely in the Cloud database. A
runtime restart or idle eviction preserves the Session record but discards its owned-window,
owned-tab, selected-tab, and hosted-allocation state. The next command opens a fresh local
window or hosted allocation using the Profile's persisted authentication state.

Session records are small and are not automatically deleted in v1. A delete/complete command
can be added if real usage shows that accumulated records are a problem.

## Runtime architecture

### Shared invariant

Both providers make Session the running browser-workspace boundary, but use their native
isolation primitive:

```text
Local Profile context                 Hosted Browser Use Profile
├── hidden anchor target              ├── Session invoice-audit allocation
├── Session invoice-audit window(s)   │   └── owned tabs + live URL
│   └── owned tabs                    └── Session research allocation
└── Session research window(s)            └── owned tabs + live URL
    └── owned tabs
```

Ending or idling a Session closes its local window group or hosted allocation but preserves
the Session record and Profile authentication state. Sessions never share a visible window,
hosted allocation, live-view URL, selected tab, or command lock. A local Profile with no
active Session windows remains warm for 60 seconds before its runtime is closed.

### Local Cloak

Local mode uses one persistent `BrowserContext` per Profile so cookies and browser storage
remain live-shared. Runtime launch creates the hidden Profile anchor before publishing the
runtime for Session use. A Session's first page is then created with CDP
`Target.createTarget({ newWindow: true })`; its `windowId`, targets, tabs, and selected tab are
registered under the immutable Session ID.

Later tabs are created in that Session's window under the existing short per-Profile page-
creation lock. Webcmd verifies the resulting `windowId` before registering the tab. Site-
created tabs and popup windows inherit their opener's Session. A Session may therefore own a
primary window and child popup windows, but no window may contain targets from two Sessions.
Webcmd never adopts a target whose window ownership conflicts with its Session.
Manual tab moves between Session windows are unsupported. If Webcmd detects one, it leaves
the tab untouched and returns `SESSION_WINDOW_CONFLICT`; it never reassigns or closes the tab.

The current command queue is keyed only by Profile. It will be re-keyed by Profile and
Session so different Session windows execute concurrently. The fixed local Profile idle
expiry or daemon shutdown closes the whole context; closing a Session closes only its owned
window targets.

### Hosted Browser Use

Hosted mode uses one Browser Use browser allocation per Session. Every allocation is created
from the same Browser Use Profile ID, but has its own CDP endpoint, tabs, live-view URL,
timeout, and lifecycle. The durable allocation key becomes
`(userId, workspaceId, profileId, sessionId)` and the current one-allocation-per-Profile
constraint is removed.

Browser Use Profiles persist cookies and local storage across browsers. A new or restarted
Session loads that state. Webcmd does not promise that a cookie changed in one allocation is
injected live into another already-running allocation. Browser Use's concurrent same-Profile
save/merge behavior must pass the release gate below; Webcmd will not add its own cookie or
storage synchronization layer.

This model consumes one hosted browser allocation per active Session. That cost and provider
concurrency usage are intentional consequences of clean Session isolation.

Before release, a live Browser Use gate must start two allocations concurrently from one
Profile, write different-domain cookies and local storage in each, stop them in both orders,
and prove that a later allocation loads both markers. It must also prove that a handoff in one
allocation leaves the sibling allocation usable. Failure blocks the release and returns this
architecture to design review; it does not trigger a Webcmd-owned cookie-sync subsystem.

### Adapter routing

The user-selected Session and adapter `siteSession` are different concerns:

- `--session` chooses the agent task and its tab boundary.
- `siteSession: persistent|ephemeral` remains an adapter tab-lifecycle policy.

A persistent adapter tab is keyed by `(profileId, sessionId, site)`. An ephemeral adapter
command creates a tab within the Session's local window group or hosted allocation and closes
it when the command ends. Raw browser commands act on that Session's selected owned tab. Tab
IDs may be globally unique, but every operation must still verify Session and window/allocation
ownership.

## Concurrency and admission

- Different Sessions under one Profile execute concurrently.
- Different Profiles execute concurrently.
- Independently submitted commands targeting a busy Session fail immediately with
  `SESSION_BUSY`; they do not wait in an invisible public queue.
- Commands belonging to the same logical execution may use the existing defensive internal
  queue.
- Brief local window/tab placement remains serialized by the Profile's existing critical-
  section lock; hosted Sessions need no cross-Session browser lock.
- Local Profile launch, idle shutdown, and anchor recovery use that same per-Profile lock.
- A human handoff blocks normal automation only in its owning Session.

The existing local `SessionLeaseRegistry` and hosted persistent write-lease mechanism should
be extended and re-keyed by immutable Session ID rather than replaced. `SESSION_BUSY`
includes the Session ID/name and safe holder metadata, uses the existing temporary-failure
exit-code convention, and is retryable by the caller.

## Hidden local anchor and issue #276

Each local Profile runtime creates one hidden `about:blank` CDP target with
`Target.createTarget({ hidden: true, background: true })` before the runtime enters the
reusable Profile map. Its browser-level CDP session remains open for the runtime's lifetime.
The hidden target keeps Cloak connected when no visible Session windows exist without adding
a blank window or tab-strip entry.

The anchor target:

- Is stored separately from every Session window and tab map.
- Has no public page ID, is never registered as a Playwright Session page, and never appears
  in tab listing, selection, snapshots, or network capture.
- Survives Session window close, release, `freshPage`, and Session idle expiry.
- Is recreated under the existing per-Profile creation lock if unexpectedly destroyed while
  the context remains healthy.
- Is not visible or closable through normal Cloak or Webcmd tab UI; low-level CDP clients can
  observe and explicitly close it, after which Webcmd recreates it if the context is healthy.
- Is closed with its context after local Profile idle expiry, daemon shutdown, explicit
  Profile teardown, or an unrecoverable disconnect.

When the last local Session window closes and the Profile has no running command or human
handoff, Webcmd starts one fixed 60-second, unreferenced idle timer. New local browser work
cancels the timer under the per-Profile lifecycle lock and reuses the warm runtime.

If the timer fires, it acquires that same lock, rechecks the idle conditions, removes the
runtime from the reusable Profile map, and then closes the entire context while still holding
the lock. A command that arrives first cancels eviction; a command that arrives after shutdown
starts waits briefly on the lock and launches a new runtime after closure completes. Multiple
arriving commands share the existing single-flight launch. A closing runtime is never returned
to a command, and a late close event from an old runtime cannot invalidate its replacement.
If graceful close exceeds three seconds, the exact Profile recovery path from #242
finishes teardown before relaunch; the old runtime is never put back in the reusable map.

`freshPage` creates and registers its replacement in the same Session window before closing
the previous tab. Closing the final visible Session window therefore leaves only the hidden
anchor during the warm period, never a stale runtime awaiting an asynchronous close event.
Hosted allocations need no anchor or Profile timer because ending one Session intentionally
stops that allocation and cannot affect a sibling allocation.

## Pinned Cloak concurrency and issue #225

Webcmd pins and distributes a tested Cloak package/browser artifact pair. Concurrency is a
supported-runtime guarantee, not a runtime capability negotiated from licence state.

A candidate pair cannot be released unless it passes live gates for:

- Two persistent Profile contexts launched concurrently with separate user-data directories.
- Two Sessions in one Profile navigating concurrently in distinct OS windows.
- Additional tabs and popups remaining inside their owning Session's window group.
- Background window/tab creation not stealing focus from a human-controlled Session window.
- A hidden anchor keeping the Profile connected with zero visible Session windows, followed
  by successful creation of a new Session window.
- Profile idle shutdown and concurrent arrival using one lifecycle lock without returning a
  closing context.
- The macOS foreground/background launch paths used by Webcmd remaining connected through navigation.
- Closing one Session window without affecting sibling windows or the Profile runtime.

There is no `CLOAK_CONCURRENCY_LIMIT` product branch for the supported pinned runtime. A
failure, including focus theft during background tab placement, blocks release until the
runtime or launcher is fixed; Webcmd does not fall back to Profile-wide serialization.

## Exact Profile teardown and issue #242

All process discovery and teardown paths must reuse one exact Cloak Profile matcher. The
matcher must:

- Recognize only Cloak browser commands.
- Match `--user-data-dir` as a complete argument, including its accepted spelling variants.
- Never treat Profile `work` as matching `work-2`.
- Never terminate unrelated Chrome/Chromium processes.

The safe matcher already used by locked-profile recovery should become the shared path for
background teardown and recovery. Closing a Session never invokes Profile process teardown.

## Human authentication handoff

The existing `login` -> human action -> `whoami` protocol remains the public workflow. No
generic handoff, takeover, or complete commands are added.

When a login needs human action:

1. Mark the initiating immutable Session as human-controlled.
2. Local mode foregrounds that Session's Cloak window. Hosted mode returns that Session
   allocation's live-view URL.
3. Return `action_required`, expiry, and a verify command containing the same `--profile`
   and immutable `--session` selectors.
4. Normal browser commands targeting that Session fail immediately with
   `SESSION_PAUSED_FOR_HUMAN_HANDOFF`; they do not queue.
5. Only that Session's verification command may automate the browser while human-controlled.
6. Successful `whoami` or handoff expiry releases human control.

Sibling Sessions under the same Profile continue normally in their own local windows or
hosted allocations, including when they are working on different sites. They receive neither
the handoff URL nor a pause error. Authentication persisted to the Profile becomes available
to future or restarted hosted allocations according to the Profile semantics above.

## Errors

| Code | Meaning |
|---|---|
| `SESSION_NOT_FOUND` | An immutable Session ID is unknown or belongs to another Profile. |
| `SESSION_BUSY` | Another execution currently owns command admission for the selected Session. |
| `SESSION_PAUSED_FOR_HUMAN_HANDOFF` | A human controls the selected Session during authentication handoff. |
| `SESSION_WINDOW_CONFLICT` | A local tab was manually moved into a window owned by another Session. |

These are structured errors in local and hosted modes with consistent exit codes and safe
metadata. They must not be collapsed into generic browser-closed, timeout, or HTTP errors.

## Agent and user documentation

The feature is incomplete until agents and users can discover and use it correctly. The same
release updates:

- Root and browser help, completion output, examples, and targeted migration errors.
- README and active browser/auth documentation.
- Bundled `webcmd-usage`, `webcmd-browser`, `webcmd-autofix`, adapter-author, sitemap-author,
  and browser-sitemap skills where they select browser state or explain handoff.
- Agent harness setup guides that show Webcmd browser commands.
- Generated command hints and auth `verify_command` output.
- Hosted help/contract examples and release notes.

Documentation must explain Profile versus Session versus tab, lazy/default Session behavior,
how separate agents choose separate Sessions, how to list Sessions, `SESSION_BUSY`, and how a
Session-scoped human handoff leaves sibling Sessions running. It must also explain that local
Sessions appear as separate Cloak windows, hosted Sessions consume separate Browser Use
allocations, a windowless local Profile remains warm behind an invisible anchor for 60 seconds,
and already-running hosted allocations do not receive live cookie injection. Examples use
immutable IDs when resuming an auth handoff and friendly names for normal task selection.

Historical design documents remain historical. This specification explicitly supersedes the
old Spaces decision; active documentation must not teach Spaces or positional browser syntax.

## Verification

Focused automated and live checks must cover:

1. Root `--session` parsing for adapters and browser commands, plus rejection of positional syntax.
2. Lazy name creation, reserved `default`, immutable-ID lookup, Profile scoping, listing, and restart persistence.
3. Parallel wall-clock execution for two Sessions in one Profile and for two Profiles.
4. Immediate `SESSION_BUSY` for concurrent independent commands in one Session.
5. Distinct local `windowId` ownership, same-Session tab placement, popup inheritance, and no
   cross-Session target adoption, including a non-destructive error after a manual tab move.
6. Session-scoped list/select/bind/close behavior and persistent adapter separation with
   unchanged `siteSession` lifecycle behavior.
7. A hidden anchor absent from all public surfaces while zero visible windows -> immediate
   Session window creation remains reliable.
8. The 60-second Profile timer starting only at zero Session windows, remaining unreferenced,
   and being cancelled by new work or a handoff.
9. Commands winning just before idle expiry reusing the runtime, and commands arriving during
   shutdown waiting for one close and single-flight relaunch without target-closed errors.
10. Repeated release/close/`freshPage`/idle-expiry cycles without target-closed errors.
11. Idle expiry and daemon shutdown closing every Session window, the context, and the hidden
   anchor; bounded failed close uses exact Profile recovery before relaunch.
12. One hosted Browser Use allocation and distinct live-view URL per active Session.
13. Concurrent hosted allocations from one Browser Use Profile preserving different-domain
   cookies and local storage after both stop, regardless of stop order, and a later allocation
   loading both markers.
14. Session-scoped local and hosted handoff, successful verification, expiry recovery, and a
   sibling Session continuing throughout.
15. Exact Profile teardown for `work` versus `work-2` and unrelated Chrome processes.
16. Live release gates for the pinned Cloak concurrency contract.
17. Help, generated hints, bundled skill examples, and active docs containing only canonical syntax.

## Rollout

This is one coordinated local/cloud contract change. The hosted protocol advertises the new
Session capability so incompatible CLI/server pairs fail before browser work. The release is
a clean CLI syntax break with a targeted migration error; there is no long-lived positional
compatibility shim.
