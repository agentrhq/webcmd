# Sitemap Authoring through MCP

Author a small, verified task graph for agents through `webcmd_cli_run`. It is
not an SEO crawl map: it records durable page state, actions, workflow paths,
API references, pitfalls, and recovery evidence in hosted site memory.

Use live fetch results, command metadata, and command help. Do not infer command arguments from this skill, maintain a routing table, or claim a source was searched when it was not.

## Authoring loop

Inspect the current page in a bounded session, read existing hosted memory, and
record only task-relevant structure actually observed. Current browser evidence
wins over remembered state.

    { "argv": ["site", "memory", "show", "example", "-f", "json"] }
    { "argv": ["--session", "session_abc", "browser", "snapshot", "--snapshot-mode", "tree", "-f", "json"] }

Use stable ids for pages, actions, and workflows. Mark unverified paths `draft`
or `stale`; never call them verified. Do not record secrets, private messages,
account-specific identifiers, bypasses, or brittle snapshot indices.

## Action schema

Each action records these fields in hosted sitemap memory:

```yaml
action: stable-id
pre: current page, state, and auth requirements
do: adapter command or semantic browser action
post: URL, state, or output proving success
fail: failure signals
recover: fallback plus adapter health update when needed
evidence: bounded browser snapshot, browser program, or retained trace artifact
```

Prefer an existing adapter as the best path and give a browser fallback. On an
adapter failure, write the health update first, refresh browser state, and then
follow the fallback. Keep each memory document narrowly scoped so it can be
loaded lazily.

## Save and audit

Use virtual-file attachments for sitemap content and preserve returned material
as artifacts, never as local paths. Inspect command help before writing because
site-memory commands are live capability surface:

    { "argv": ["site", "memory", "--help"] }
    { "argv": ["site", "memory", "show", "example", "-f", "json"] }
    { "argv": ["artifacts", "get", "ea_0123456789abcdef0123456789abcdef"] }

Report what is verified, what is stale, evidence used, and the next probe for
any gap.
