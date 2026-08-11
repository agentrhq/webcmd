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

- Let different agents run concurrently in separate Sessions under one Profile.
- Share Profile cookies and authentication while isolating each Session's tabs and command state.
- Use one consistent Session selector for adapters and raw browser commands.
- Preserve Session identity across browser or daemon restarts without promising tab restoration.
- Make same-Session collisions and human handoffs explicit to agents.
- Give local Cloak and hosted Browser Use the same observable behavior.
- Update user documentation, CLI help, and bundled agent skills as part of the release.

## Non-goals

- Cookie isolation between Sessions; that remains a Profile responsibility.
- Arc-style spaces, tab groups, colors, themes, pinned tabs, or one window per task.
- Automatic tab restoration after a Profile runtime is restarted or evicted.
- `session create`, `session complete`, `session takeover`, or a process-global current Session.
- Cloak licence/capability detection or a degraded single-context mode.
- A general output-format migration; existing output defaults remain unchanged.

## Concepts

| Concept | Responsibility |
|---|---|
| Profile | Persistent browser identity: cookies, local storage, authentication, and Cloak/Browser Use profile data. |
| Profile runtime | One running browser context/allocation for a Profile. |
| Session | Persistent logical identity for one agent task under a Profile. Owns task tabs and command admission. |
| Tab | A Playwright `Page` owned by a Session. `Page` remains an implementation term. |
| Anchor tab | Local-only, Profile-owned blank tab that keeps a Cloak runtime alive. It is never exposed as a Session tab. |

Session names are unique within a Profile. Immutable `session_...` IDs are globally
unambiguous. Sessions under the same Profile share authentication but cannot list, select,
bind, close, or otherwise act on each other's tabs.

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
runtime restart or idle eviction preserves the Session record but discards its owned-tab and
selected-tab state. The next command creates a fresh owned tab while the Profile supplies
the preserved login state.

Session records are small and are not automatically deleted in v1. A delete/complete command
can be added if real usage shows that accumulated records are a problem.

## Runtime architecture

### Shared invariant

Both providers implement this hierarchy:

```text
Profile
└── Profile runtime (shared authentication)
    ├── Session default
    │   └── owned tabs
    ├── Session invoice-audit
    │   └── owned tabs
    └── Session research
        └── owned tabs
```

Ending or idling a Session releases only its runtime tab resources. It must not end the
Profile runtime. Only Profile eviction, daemon shutdown, an explicit Profile shutdown, or an
unrecoverable browser disconnect ends the Profile runtime.

### Local Cloak

Local mode uses one persistent `BrowserContext` per Profile. The Session manager partitions
tracked tabs and selected-tab state by immutable Session ID.

The current command queue is keyed only by Profile. It will be re-keyed by Profile and
Session so different Sessions can execute concurrently. The existing per-Profile page-
creation lock remains because creating/adopting tabs mutates shared context state; it covers
only that short critical section.

### Hosted Browser Use

Hosted mode uses one Browser Use browser allocation per Profile and partitions logical tabs,
active-tab state, and command admission by Session ID. The existing Profile allocation is
not duplicated per Session because doing so would lose immediate cookie sharing and spend
unnecessary browser infrastructure.

The current in-process Profile/session-name lock and persistent Profile-wide database lease
must use the immutable Session ID. A Profile remains the allocation key; a Session becomes
the write-admission key.

### Adapter routing

The user-selected Session and adapter `siteSession` are different concerns:

- `--session` chooses the agent task and its tab boundary.
- `siteSession: persistent|ephemeral` remains an adapter tab-lifecycle policy.

A persistent adapter tab is keyed by `(profileId, sessionId, site)`. An ephemeral adapter
command creates a new tab within the selected Session and closes it when the command ends.
Raw browser commands act on that Session's selected owned tab. Tab IDs may be globally
unique, but every operation must still verify Session ownership.

## Concurrency and admission

- Different Sessions under one Profile execute concurrently.
- Different Profiles execute concurrently.
- Independently submitted commands targeting a busy Session fail immediately with
  `SESSION_BUSY`; they do not wait in an invisible public queue.
- Commands belonging to the same logical execution may use the existing defensive internal
  queue.
- Brief shared operations such as page creation remain serialized by the Profile's existing
  critical-section lock.
- Human handoff pause takes precedence over Session admission.

The existing local `SessionLeaseRegistry` and hosted persistent write-lease mechanism should
be extended and re-keyed rather than replaced. `SESSION_BUSY` includes the Session ID/name
and safe holder metadata, uses the existing temporary-failure exit-code convention, and is
retryable by the caller.

## Local runtime anchor and issue #276

Cloak's initial clean `about:blank` tab becomes a Profile runtime anchor; if launch provides
none, Webcmd creates one. It is never leased to a Session. The first Session command always
creates a separate user tab.

The anchor:

- Is stored separately from the Session tab map.
- Has no public page ID and never appears in tab listing, selection, snapshots, or network capture.
- Survives Session release, explicit tab close, `freshPage`, and Session tab idle expiry.
- Is closed only when the Profile runtime is intentionally ended or disconnected.
- Is recreated under the existing per-Profile page-creation lock if it is unexpectedly closed
  while the context remains healthy, before Webcmd closes the final leased tab.

`freshPage` creates and registers its replacement before closing the previous leased tab.
This removes the transient zero-user-tab interval and ensures failure leaves the old tab
available. Recovery retries remain a fallback for genuine browser disconnects, not the
primary lifecycle mechanism.

## Pinned Cloak concurrency and issue #225

Webcmd pins and distributes a tested Cloak package/browser artifact pair. Concurrency is a
supported-runtime guarantee, not a runtime capability negotiated from licence state.

A candidate pair cannot be released unless it passes live gates for:

- Two persistent Profile contexts launched concurrently with separate user-data directories.
- Two Sessions in one Profile navigating concurrently in separate tabs.
- The macOS foreground/background launch paths used by Webcmd remaining connected through navigation.
- Closing Session tabs without closing the Profile runtime.

There is no `CLOAK_CONCURRENCY_LIMIT` product branch for the supported pinned runtime. A
failure is a Webcmd runtime/launcher defect to fix before release.

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

When a hosted login needs human action:

1. Record the initiating immutable Session ID and pause browser work for that Profile.
2. Return `action_required`, the live-view URL, expiry, and a verify command that includes
   the same `--profile` and immutable `--session` selectors.
3. Other browser commands under the Profile fail immediately with
   `PROFILE_PAUSED_FOR_HUMAN_HANDOFF`; they do not queue.
4. Only the initiating Session's verification command may use the browser while paused.
5. Successful `whoami` releases the pause. Expiry also releases it.

The pause is Profile-wide because Browser Use live view exposes the shared browser. The error
payload tells other agents that a human handoff is active and includes Profile ID, initiating
Session ID, and expiry, but does not disclose the initiator's live-view URL. Other Profiles
and non-browser commands continue normally.

Local handoff keeps its visible-browser workflow. It uses the same Session-bound verify
command and Session tab-ownership checks, but does not add the hosted live-view pause.

## Errors

| Code | Meaning |
|---|---|
| `SESSION_NOT_FOUND` | An immutable Session ID is unknown or belongs to another Profile. |
| `SESSION_BUSY` | Another execution currently owns command admission for the selected Session. |
| `PROFILE_PAUSED_FOR_HUMAN_HANDOFF` | A human controls the Profile through another Session's hosted handoff. |

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
Profile-wide human handoff affects sibling Sessions. Examples use immutable IDs when resuming
an auth handoff and friendly names for normal task selection.

Historical design documents remain historical. This specification explicitly supersedes the
old Spaces decision; active documentation must not teach Spaces or positional browser syntax.

## Verification

Focused automated and live checks must cover:

1. Root `--session` parsing for adapters and browser commands, plus rejection of positional syntax.
2. Lazy name creation, reserved `default`, immutable-ID lookup, Profile scoping, listing, and restart persistence.
3. Parallel wall-clock execution for two Sessions in one Profile and for two Profiles.
4. Immediate `SESSION_BUSY` for concurrent independent commands in one Session.
5. Session-scoped list/select/bind/close behavior, including popup registration.
6. Persistent adapter tab separation by Session and unchanged `siteSession` lifecycle behavior.
7. Hosted Profile-wide handoff pause, safe sibling error, successful verification, and expiry recovery.
8. Anchor exclusion and repeated release/close/`freshPage`/idle-expiry -> immediate create -> navigate cycles.
9. Intentional Profile eviction and daemon shutdown closing the context and anchor.
10. Exact Profile teardown for `work` versus `work-2` and unrelated Chrome processes.
11. Live release gates for the pinned Cloak concurrency contract.
12. Help, generated hints, bundled skill examples, and active docs containing only canonical syntax.

## Rollout

This is one coordinated local/cloud contract change. The hosted protocol advertises the new
Session capability so incompatible CLI/server pairs fail before browser work. The release is
a clean CLI syntax break with a targeted migration error; there is no long-lived positional
compatibility shim.
