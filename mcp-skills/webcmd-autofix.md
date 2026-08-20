# Webcmd AutoFix through MCP

Repair a broken adapter only when a command failure is reproducibly caused by
site drift. Every operation is a `webcmd_cli_run` argv call, and repair state
lives in hosted site memory and artifacts.

Retry budget: maximum **3 repair rounds** per failure. A round is diagnose -> patch -> retry. If 3 rounds do not resolve it, stop and report what was tried.
Use live fetch results, command metadata, and command help. Do not infer command arguments from this skill, maintain a routing table, or claim a source was searched when it was not.

## Hard stops

`action_required`, authentication challenges, CAPTCHA, rate limits, and access
controls are not adapter repairs. Stop, hand the user the returned view URL,
and run the returned verification command only after they report completion.
Do not request secrets or try to solve a challenge from page content.

## Bounded repair loop

Create a session for the investigation; each invocation has a 240-second wall
clock budget. Reuse the session for snapshots and probes, then close it.

    { "argv": ["session", "create", "-f", "json"] }
    { "argv": ["example", "search", "--query", "agents", "--trace", "retain-on-failure", "-f", "json"] }
    { "argv": ["artifacts", "get", "ea_0123456789abcdef0123456789abcdef"] }
    { "argv": ["session", "close", "session_abc"] }

Read the retained trace artifact before changing anything. Rule out a valid empty
result, stale session state, an auth wall, or a rate limit. Then inspect the
current page and response evidence with bounded session interactions.

## Patch only tenant-owned source

Fetch the named adapter source as a virtual artifact, change only that source,
and return it with `adapter source put` plus a virtual file. Validate and verify
after every repair round:

    { "argv": ["adapter", "source", "get", "example/search", "-f", "json"] }
    { "argv": ["validate", "example/search", "-f", "json"] }
    { "argv": ["browser", "verify", "example/search", "-f", "json"] }

When the budget is exhausted, report the command, trace artifact, observed
drift, repairs attempted, and verification result. Do not report expected
argument, configuration, authentication, or transient failures as product bugs.
