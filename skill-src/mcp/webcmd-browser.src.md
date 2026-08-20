# Webcmd Browser through MCP

Use `webcmd_cli_run` for a live browser task only after a complete, non-truncated
adapter lookup and relevant plugin search leave no suitable deterministic
adapter.

@[why adapters](../shared/why-adapters.src.md)
@[safety rules](../shared/safety-rules.src.md)

## Session lifecycle

Create one session, use its id on each bounded browser action, and close it when
finished. Each invocation has a 240-second wall-clock budget.

    { "argv": ["session", "create", "-f", "json"] }
    { "argv": ["browser", "tabs", "--session", "session_abc", "-f", "json"] }
    { "argv": ["browser", "snapshot", "--session", "session_abc", "--snapshot-mode", "act", "-f", "json"] }
    { "argv": ["session", "close", "session_abc"] }

Take a fresh snapshot after navigation, submits, SPA transitions, login, or a
human handoff. Prefer semantic locators and scoped extraction. Return compact
evidence: URL, title, selected text, response URL/status/sample, or specific
fields, never an unbounded DOM dump.

## Browser programs and artifacts

Put a browser program in an attached virtual file and invoke it with argv:

    {
      "argv": ["browser", "run", "--session", "session_abc", "--file", "probe.js", "-f", "json"],
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
