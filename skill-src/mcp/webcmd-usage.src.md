# Using Webcmd through MCP

@[what Webcmd is](../shared/what-webcmd-is.src.md)

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

@[safety rules](../shared/safety-rules.src.md)

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

@[retry budget](../shared/retry-budget.src.md)

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

Anything longer is an explicit named Session: create one, issue bounded
interactions against its immutable, Profile-scoped readable ID, and poll. Raw
browser commands require that explicit selector. Adapter commands without
`--session` reuse `adapter-default`.

    { "argv": ["--profile", "work", "session", "create", "Work Project", "-f", "json"] }
    {
      "argv": ["--profile", "work", "--session", "work-project-k7", "browser", "run", "--file", "navigate.js", "-f", "json"],
      "files": [{ "path": "navigate.js", "content": "await page.goto('https://example.com'); return { url: page.url(), title: await page.title() };", "encoding": "utf8" }]
    }
    { "argv": ["--profile", "work", "--session", "work-project-k7", "browser", "snapshot", "-f", "json"] }
    { "argv": ["--profile", "work", "session", "close", "work-project-k7"] }

Each interaction is its own invocation and its own 240-second budget. The
session holds the browser state between them.

Create the long-lived Session with `session create <name>`.

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

@[why adapters](../shared/why-adapters.src.md)

Use a deterministic adapter before generic browser work. Discover it through
`webcmd_cli_run` argv, and only use browser actions after a complete registry
result and the relevant plugin search have no suitable command:

    { "argv": ["list", "-f", "json"] }

## Workspaces, profiles, sessions, formats

All ordinary argv — `--workspace`, `--profile`, `--session`, `-f`. There is no
separate MCP parameter for any of them, so the CLI documentation is the only
documentation you need.
