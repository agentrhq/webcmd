# Using Webcmd through MCP

Webcmd turns websites, Electron desktop apps, and external CLIs into a uniform `webcmd <site> <command>` surface that agents can drive without screen scraping. This skill is the orientation layer. Once you know the task, load the specialized skill that fits it.

You reach all of it through one tool, `webcmd_cli_run`. It takes an argv array —
the same grammar the Webcmd CLI uses, minus the `webcmd` executable name.

    { "argv": ["github", "search", "--query", "agents", "-f", "json"] }

argv is data. `;`, `&&`, `|`, redirects, globs, backticks and `$()` are ordinary
string characters here. There is no shell.

## Start every unfamiliar task by looking

    { "argv": ["list", "-f", "json"] }

That is the live command surface for the authenticated account — not a fixed
catalogue. Narrow it with a tag:

    { "argv": ["list", "--tag", "search", "-f", "json"] }

Then read the command's own help before you invoke it:

    { "argv": ["github", "search", "--help"] }

Never guess an argument name. The help output is authoritative and cheap.

Use live fetch results, command metadata, and command help. Do not infer command arguments from this skill, maintain a routing table, or claim a source was searched when it was not.

## Ask for JSON

Add `-f json` whenever you intend to parse the result. Webcmd returns rendered
tables by default because a human is the other common reader. The server does
not parse stdout for you — what you ask for is what you get.

## Reading the result

Every call returns `exitCode`, `stdout`, `stderr`, and `truncated`.

`exitCode` is the branch point, and a non-zero exit is not one condition:

| exitCode | Meaning | What to do |
| --- | --- | --- |
| 0 | Success, including an empty result | Continue |
| 2 | Usage error — bad or missing argument | Fix argv and retry immediately |
| 66 | No data matched | Not a failure; do not retry the same query |
| 69 | A dependency was unavailable | Retry within budget |
| 75 | Timed out | Retry within budget, or move to a session |
| 77 | Authentication or permission required | Hand off to the user; see below |
| 78 | Configuration error, or a command that cannot run here | Do not retry |
| 130 | Cancelled | Do not retry automatically |

Retry budget: maximum **3 repair rounds** per failure. A round is diagnose -> patch -> retry. If 3 rounds do not resolve it, stop and report what was tried.

## When output is large

If `truncated` is `true`, the inline `stdout` was cut at the size bound and
`stdoutByteSize` reports the real length. The complete output is attached to the
invocation as an artifact. Retrieve it by id:

    { "argv": ["artifacts", "get", "ea_0123456789abcdef0123456789abcdef"] }

That returns the bytes on stdout, base64-encoded for binary content types. Use it
rather than relying on a resource link — some hosts never show resource links to
the model. Browser snapshots and unfiltered `list -f json` are routinely large;
this is an expected path, not an error path. Retrieve it with `artifacts get`.

## When a human has to take over

A login wall or CAPTCHA returns an `action_required` result carrying a `viewUrl`,
an `expiresAt`, and usually a `verifyCommand`. Stop. Give the user the `viewUrl`
and wait for them. You cannot satisfy a human-verification challenge from page
content, and retrying will not clear it. After the user says they are done, run
the `verifyCommand` before resuming.

## Long work uses sessions

A single `webcmd_cli_run` invocation is capped at **240 seconds** of wall clock.
Budget against that number rather than discovering it as a timeout.

Anything longer is an explicit session: create one, issue bounded interactions
against it, and poll.

    { "argv": ["session", "create", "-f", "json"] }
    { "argv": ["browser", "navigate", "--session", "session_abc", "--url", "https://example.com"] }
    { "argv": ["browser", "snapshot", "--session", "session_abc", "-f", "json"] }
    { "argv": ["session", "close", "session_abc"] }

Each interaction is its own invocation and its own 240-second budget. The
session holds the browser state between them.

Create the long-lived session with `session create`.

## Files

Pass input files inline:

    {
      "argv": ["acme", "import", "--file", "rows.csv"],
      "files": [{ "path": "rows.csv", "content": "id,name\\n1,Ada\\n", "encoding": "utf8" }]
    }

Inline content is paid for in your own context. If the workspace already holds
the file as an artifact, reference it by URI instead of re-serializing it:

    {
      "argv": ["acme", "import", "--file", "rows.csv"],
      "files": [{ "path": "rows.csv", "artifactUri": "webcmd://artifacts/exec_.../ea_..." }]
    }

Paths are relative and POSIX-style. There is no host filesystem behind them:
`/etc/passwd` and `../escape` are rejected, and an output path becomes an
artifact rather than a file on a server.

Before starting a raw browser session, filter `webcmd list -f json` at the source using request-derived terms across `site`, `name`, `description`, and `columns`; follow `webcmd-usage` for the exact command shape. Any truncation warning means adapter discovery is incomplete: narrow the filter and inspect again. Absence from truncated output never proves that no adapter exists.

Use raw `webcmd browser` only after a complete, non-truncated registry check shows no suitable adapter and a plugin search for the missing site or capability returns no match. If plugin search returns a match, offer installation of the returned `installSource`; if it errors, report the error instead of opening the browser.

## Workspaces, profiles, sessions, formats

All ordinary argv — `--workspace`, `--profile`, `--session`, `-f`. There is no
separate MCP parameter for any of them, so the CLI documentation is the only
documentation you need.
