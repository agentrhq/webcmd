# Client-Owned Web Fetch Design

**Date:** 2026-08-12
**Status:** Approved

## Goal

Make `webcmd web fetch` one small, deterministic, non-browser command. It always
runs on the user's machine, including while Webcmd is configured for hosted
mode. It tries only native HTTP and two Impit TLS fingerprints. Browser work is
never an implicit fetch tier; an agent must create a Session and use the
existing `browser run` surface explicitly.

## Decisions

- `web fetch` is a core, client-owned command, not an adapter.
- It runs locally in both local and hosted configurations.
- It never opens Cloak, Chromium, Browser Use, a daemon connection, or a browser
  Session.
- Its only network stages are native HTTP, Impit Chrome, and Impit Firefox.
- `web fetch-browser` is removed rather than deprecated or retained as an
  alias.
- No `browser open` or other fetch-specific browser helper is added.
- Explicit browser fallback uses `session create`, `browser run`, and
  `browser snapshot`.
- In hosted mode, those browser commands continue to execute in Webcmd Cloud
  against Browser Use.

## Non-goals

- Rendering JavaScript inside `web fetch`.
- Automatically allocating a local or hosted browser.
- Automatically forwarding a failed fetch to Webcmd Cloud.
- Replacing the existing raw-browser command surface.
- Adding a second article-export or browser-download command.

## Command surface

`web fetch` keeps one registered argument definition:

```text
webcmd web fetch --url <http-or-https-url>
                 [--timeout <seconds>]
                 [--max-chars <count>]
                 [--allow-private <true|false>]
                 [-f|--format <format>]
                 [--trace <mode>]
```

The command removes `--browser` and `--wait`. Because these options have not
shipped as part of an auto-escalating release, no compatibility alias or
deprecation period is needed.

`web fetch-browser` is removed from command registration, manifests, help,
completion, documentation, skills, tests, and error hints.

The core registry is the sole source of the command's arguments, help, output
formatting, and validation. There is no separate hand-written argv grammar.
Equals-form options and unknown-option rejection therefore behave like every
other Webcmd command.

## Fetch ladder

The command owns one deadline and one private-network policy across all stages:

1. Native `fetch` through the safe proxy.
2. Impit with the Chrome fingerprint through the same safe proxy.
3. Impit with the Firefox fingerprint through the same safe proxy.

A stage succeeds only when it returns usable content that is neither a
recognized challenge nor a JavaScript-only shell. A challenge or a recoverable
transport/TLS failure advances to the next stage while deadline remains.

Argument errors, unsafe-address rejections, oversized bodies, and an exhausted
deadline fail immediately. They are not fingerprint-dependent and retrying
would only waste the shared budget.

If a response is a JavaScript-only shell, the command returns
`FETCH_REQUIRES_BROWSER` immediately. Impit changes HTTP/TLS fingerprints; it
does not execute JavaScript, so trying its second fingerprint cannot make that
response usable.

If all eligible stages remain challenged, the command returns `FETCH_BLOCKED`.
It never imports browser execution code in either error path.

The result records which successful non-browser tier answered:

```text
tier: plain
tier: impit
profile: chrome | firefox  # Impit results only
```

`--timeout` remains one total deadline across the ladder. `--max-chars` and
`--allow-private` retain their current meanings and never need to cross into a
browser runtime.

## Explicit browser fallback

`FETCH_BLOCKED` and `FETCH_REQUIRES_BROWSER` return structured errors with a
concise next action:

```text
Create a browser Session with `webcmd --profile <profile> session create`, then
navigate with `webcmd --profile <profile> --session <session-id> browser run --stdin`.
```

Bundled skills and user-facing documentation include the complete workflow.
Agents create one opaque Session for the browser task, carry its exact ID, and
close it when finished:

```bash
webcmd --profile work session create
# Copy the returned ID, for example:
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

The error itself stays compact. The longer snippet belongs in `smart-search`,
the browser skill, and CLI documentation so routine error output does not grow
into a shell tutorial.

## Local and hosted routing

| Configuration | `web fetch` | Explicit browser commands |
|---|---|---|
| Local | Local native HTTP/Impit | Local Cloak runtime |
| Hosted | Local native HTTP/Impit | Webcmd Cloud and Browser Use |

The manifest marks `web/fetch` as client-owned. It remains visible in local and
hosted help, list output, and completion, but it is excluded from Cloud's
server-executable command set. The hosted CLI dispatches it through the same
core command parser and renderer as local mode without reading user adapter
directories.

`webcmd-cloud` must not load or execute `web/fetch`. The core-command loader and
embedded-executor mechanism proposed by `webcmd-cloud#33` are unnecessary for
this feature. The Cloud north-star documentation records `web fetch` as the
explicit client-owned exception to hosted server execution; raw browser
commands remain server-owned in hosted mode.

`web/fetch-browser` is absent from the hosted contract. Cloud therefore has no
article-directory materialization or worker-stdout special case to support.

## Packaging and discovery

The npm package ships `src/fetch` through the existing compiled `dist/src`
tree. `cli-manifest.json` contains one core `web/fetch` entry using the package
export for its registration module. There is no `clis/web` adapter tree.

An installed-tarball smoke test must prove that a fresh global installation:

- lists `web/fetch` as built in;
- exposes it through root/site help and completion;
- runs `web fetch -h` successfully;
- imports its declared package export; and
- contains no `web/fetch-browser` command.

## Errors

The existing structured envelope and exit-code rules remain authoritative:

- `ARGUMENT` for invalid URLs, values, or flags;
- the existing unsafe-address error for blocked private destinations;
- `TIMEOUT` when the shared deadline expires;
- `FETCH_BODY_TOO_LARGE` for the body limit;
- `FETCH_REQUIRES_BROWSER` for JavaScript-only content; and
- `FETCH_BLOCKED` after every eligible non-browser fingerprint remains
  challenged.

Only the last two errors suggest the explicit Session/browser workflow.
Timeouts, DNS failures, refused connections, policy failures, and oversized
bodies do not recommend a browser because a browser does not correct them
reliably.

## Skills and documentation

All bundled, user-facing skills and active documentation use the same model:

1. Try `web fetch` once.
2. Treat its structured code, not message prose, as the escalation decision.
3. For `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER`, create a Session.
4. Navigate with `browser run`.
5. Inspect with `browser snapshot --snapshot-mode read` or `act` as appropriate.
6. Continue browser interaction through `browser run` and close the Session
   when finished.

`smart-search` keeps its fetch-first budgets but counts explicit browser
Sessions rather than hidden browser-fetch tiers. The browser skill owns the
detailed Playwright example and Session lifecycle. Active README, CLI reference,
help text, error examples, generated docs, and skills contain no
`fetch-browser`, `web read`, or automatic-escalation instructions.

Historical dated plans and specifications may retain historical command names
when rewriting them would falsify the record. They must not be linked as active
instructions, and current north-star documents must describe the approved
behavior.

## Removal and reuse

Delete fetch-browser-specific registration, browser extraction glue, and tests.
Before deleting shared article extraction or download utilities, inspect every
caller. Shared utilities used by other browser or adapter workflows remain;
dead utilities are removed rather than preserved for a speculative future
command.

## Verification

The implementation is complete only when tests prove:

- exact native HTTP -> Chrome Impit -> Firefox Impit ordering for challenged
  responses and eligible transport failures;
- immediate exit for policy, argument, body-size, and exhausted-deadline errors;
- early `FETCH_REQUIRES_BROWSER` for JavaScript-only shells;
- `FETCH_BLOCKED` after three challenged non-browser stages;
- one timeout budget across the ladder;
- no browser, daemon, Cloak, Browser Use, or command self-dispatch import during
  `web fetch`;
- local execution of `web fetch` under both local and hosted configuration;
- identical help, formats, equals-form parsing, unknown-flag rejection, list,
  and completion behavior in both configurations;
- `clientOwned` availability excludes `web/fetch` from Cloud execution while
  retaining client discovery;
- a packed global installation loads the command from its package export;
- `web/fetch-browser` is absent from active code, generated contracts,
  manifests, skills, and documentation;
- local browser commands still use Cloak; and
- hosted browser commands still use Browser Use with the explicit Session ID.

The normal full unit/plugin suite, package checks, hosted-contract checks, and
Cloud compatibility tests remain required. Live gates should exercise one
local Session through Cloak and one hosted Session through Browser Use; neither
gate involves `web fetch` opening or allocating a browser.

## Release coordination

Revise `webcmd#295` to this design rather than merging its auto-escalating
implementation. Close or replace draft `webcmd-cloud#33`; Cloud must not load
these client-owned commands. Publish the Webcmd release only after the client,
generated contract, bundled skills, active docs, and Cloud compatibility checks
agree on the ownership boundary.

Release notes call out the intentional removal of the previously advertised
but inconsistently shipped `web fetch-browser` command and direct agents to the
explicit Session plus `browser run` workflow.
