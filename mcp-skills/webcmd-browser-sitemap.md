# Browser Sitemap Context through MCP

Use this document with `webcmd_cli_run` when a task has sitemap context or a
browser result reports that it is available. Sitemap memory is prior knowledge,
not ground truth.

Use live fetch results, command metadata, and command help. Do not infer command arguments from this skill, maintain a routing table, or claim a source was searched when it was not.

## Consumption loop

Use a bounded session to inspect current state, then request only the smallest
relevant hosted memory: site orientation, one matching page, one matching
workflow, and pitfalls only when blocked.

    { "argv": ["--profile", "work", "session", "create", "Work Project", "-f", "json"] }
    { "argv": ["--profile", "work", "--session", "work-project-k7", "browser", "snapshot", "--snapshot-mode", "tree", "-f", "json"] }
    { "argv": ["site", "memory", "show", "example", "-f", "json"] }

The returned readable Session ID is immutable and Profile-scoped. Raw browser
commands require it explicitly.

Prefer an adapter named by the workflow. If it is unavailable or fails, use the
fallback browser path. After every state-changing action refresh the snapshot
and compare the workflow checkpoint. If the live page disagrees, follow the
live page rather than repeatedly clicking the remembered path.

## Hosted memory write-back

When drift is durable, write a short hosted site-memory note or draft that says
what was observed, the expected state, current URL, and next probe. If the
workflow asks for an adapter health update, mark it suspect or broken before
using its fallback so the next agent does not repeat it.

    { "argv": ["site", "memory", "list", "example", "-f", "json"] }
    { "argv": ["site", "note", "add", "example", "--text", "Observed stale workflow; inspect current checkout path", "-f", "json"] }

Large sitemap material is an artifact; retrieve its id with `artifacts get`.
Never direct sitemap output to an agent-machine path. Report the path chosen,
checkpoint reached, and whether hosted memory was used, marked stale, or absent.
