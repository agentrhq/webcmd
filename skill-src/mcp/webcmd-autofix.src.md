# Webcmd AutoFix through MCP

Repair a broken adapter only when a command failure is reproducibly caused by
site drift. Every operation is a `webcmd_cli_run` argv call, and repair state
lives in hosted site memory and artifacts.

@[retry budget](../shared/retry-budget.src.md)
@[safety rules](../shared/safety-rules.src.md)

## Hard stops

`action_required`, authentication challenges, CAPTCHA, rate limits, and access
controls are not adapter repairs. Stop, hand the user the returned view URL,
and run the returned verification command only after they report completion.
Do not request secrets or try to solve a challenge from page content.

## Bounded repair loop

Create a named Session for the investigation; each invocation has a 240-second
wall-clock budget. Reuse its immutable, Profile-scoped readable ID for snapshots
and probes, then close it.

    { "argv": ["--profile", "work", "session", "create", "Work Project", "-f", "json"] }
    { "argv": ["example", "search", "--query", "agents", "--trace", "retain-on-failure", "-f", "json"] }
    { "argv": ["artifacts", "get", "ea_0123456789abcdef0123456789abcdef"] }
    { "argv": ["--profile", "work", "session", "close", "work-project-k7"] }

Read the retained trace artifact before changing anything. Rule out a valid empty
result, stale session state, an auth wall, or a rate limit. Then inspect the
current page and response evidence with bounded session interactions.

## Patch only tenant-owned source

Fetch the named adapter source into the virtual relative path `adapter.ts`,
change only that virtual file, and return it with `adapter source put`. Validate
and verify after every repair round:

    { "argv": ["adapter", "source", "get", "example/search", "--output", "adapter.ts"] }
    {
      "argv": ["adapter", "source", "put", "example/search", "adapter.ts"],
      "files": [{ "path": "adapter.ts", "artifactUri": "webcmd://artifacts/exec_.../ea_..." }]
    }
    { "argv": ["validate", "example/search", "-f", "json"] }
    { "argv": ["browser", "verify", "example/search", "-f", "json"] }

When the budget is exhausted, report the command, trace artifact, observed
drift, repairs attempted, and verification result. Do not report expected
argument, configuration, authentication, or transient failures as product bugs.
