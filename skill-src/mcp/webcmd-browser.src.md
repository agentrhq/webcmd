# Webcmd Browser through MCP

Use `webcmd_cli_run` for a live browser task only after a complete, non-truncated
adapter lookup and relevant plugin search leave no suitable deterministic
adapter.

@[why adapters](../shared/why-adapters.src.md)
@[safety rules](../shared/safety-rules.src.md)

Discover candidate adapters with argv data; if the complete result and relevant
plugin search have no suitable command, browser work is the fallback:

    { "argv": ["list", "-f", "json"] }

## Session lifecycle

Create one named Session, use its returned readable ID on each bounded browser
action, and close it when finished. IDs are immutable and Profile-scoped. Raw
browser commands require an explicit readable selector; adapter commands without
`--session` reuse `adapter-default`. Each invocation has a 240-second wall-clock
budget.

    { "argv": ["--profile", "work", "session", "create", "Work Project", "-f", "json"] }
    { "argv": ["--profile", "work", "--session", "work-project-k7", "browser", "tabs", "-f", "json"] }
    { "argv": ["--profile", "work", "--session", "work-project-k7", "browser", "snapshot", "--snapshot-mode", "act", "-f", "json"] }
    { "argv": ["--profile", "work", "session", "close", "work-project-k7"] }

Take a fresh snapshot after navigation, submits, SPA transitions, login, or a
human handoff. Prefer semantic locators and scoped extraction. Return compact
evidence: URL, title, selected text, response URL/status/sample, or specific
fields, never an unbounded DOM dump.

## Browser programs and artifacts

Put a browser program in an attached virtual file and invoke it with argv:

    {
      "argv": ["--profile", "work", "--session", "work-project-k7", "browser", "run", "--file", "probe.js", "-f", "json"],
      "files": [{ "path": "probe.js", "content": "await page.goto('https://example.com'); return { url: page.url(), title: await page.title() };", "encoding": "utf8" }]
    }

Keep dependent waits, clicks, fills, and response listeners in one program. Arm
a response listener before the UI action that triggers it. Do not copy browser
program syntax into an adapter.

Screenshots and large snapshots are artifacts, not local files. Retrieve a
returned artifact id through:

    { "argv": ["artifacts", "get", "ea_0123456789abcdef0123456789abcdef"] }

For a login wall or CAPTCHA, stop automation and keep the live-view handoff.
Give the user the returned view URL, wait, then run the returned verifier and
take a fresh snapshot before resuming.
