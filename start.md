# Set Up Webcmd

Install Webcmd and verify that it runs end to end.

This is the common setup guide for every agent harness. Per-agent pages under `docs/agents/` cover harness-specific configuration; each has a *Manual* section ending with an *Override default tools* section that differs per agent. Start here, then follow the page for your harness.

## 1. Determine your agent type

Inspect the current environment and ask only for missing information. Ask which harness is in use and classify it:

- **Coding agent** — a terminal- or shell-driven harness that runs commands (Cursor, OpenCode, Claude Code, Codex CLI, Hermes Agent, Pi, OpenClaw). Fully supported by this guide; each has a per-agent page below.
- **MCP-based agent** — a harness that consumes tools only through an MCP server. Not implemented yet; support is coming soon.
- **Custom SDK** — programmatic integration through the Webcmd SDK. Not available yet; see [custom-sdk.md](docs/agents/custom-sdk.md).

### Coding agent harnesses

| Harness | Native tools Webcmd replaces | Page |
| --- | --- | --- |
| Cursor | `Browser`, `Web` | [cursor.md](docs/agents/cursor.md#override-default-tools) |
| OpenCode | `webfetch`, `websearch` | [opencode.md](docs/agents/opencode.md#override-default-tools) |
| Claude Code | `WebFetch`, `WebSearch` | [claude-code.md](docs/agents/claude-code.md#override-default-tools) |
| Codex CLI | `web_search` | [codex-cli.md](docs/agents/codex-cli.md#override-default-tools) |
| Hermes Agent | `browser_*` | [hermes.md](docs/agents/hermes.md#override-default-tools) |
| Pi | none (optional `pi-skills`) | [pi.md](docs/agents/pi.md#override-default-tools) |
| OpenClaw | `web_search`, `web_fetch`, `browser` | [openclaw.md](docs/agents/openclaw.md#override-default-tools) |

For MCP-based and Custom SDK harnesses, the per-agent page's *Agent prompt* does not point here yet; follow the page directly.

If the user already chose a path, location, name, or harness, treat that as binding.

## 2. Set up the package

For a global install:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
```

For a project install, run the equivalent commands with the project's package manager (npm, pnpm, yarn, bun).

`webcmd doctor` must be green before browser commands will work. Fix only the setup issue `doctor` reports; do not proceed until it passes.

## 3. Read installed guidance

Install the Webcmd skills for your harness:

```bash
webcmd skills add
```

When prompted, choose the provider that matches your agent (`agents`, `codex`, or `claude`). Then read the repo-level skill that was copied into the project before creating or editing browser automation. Use whichever path exists:

```text
.agents/skills/webcmd-usage/SKILL.md
.codex/skills/webcmd-usage/SKILL.md
.claude/skills/webcmd-usage/SKILL.md
```

If none of those paths exist because the project has no `.agents/`, `.codex/`, or `.claude/` directory, create the appropriate agent directory and rerun `webcmd skills add`. Follow the per-agent page under `docs/agents/` for harness-specific configuration, including the *Override default tools* section that disables the agent's native browser tools.

## 4. Verify

For this smoke check, copy the program below directly; do not inspect additional references unless validation fails. Run it against a real page:

```bash
webcmd browser work run --stdin <<'JS'
await page.goto('https://example.com');
return { title: await page.title(), url: page.url() };
JS
```

Then release the session:

```bash
webcmd browser work close
```

The run must return the page title and URL.

## 5. Finish

After verifying Webcmd is set up and working properly, summarize the steps you took and offer some sample browser automations you could build next, such as:

- Research a topic across a site and return a concise comparison with source links.
- Collect bookmarks, messages, or profile data using a logged-in profile.
- Check product prices, availability, or delivery options.
- Turn a proven browser workflow into a reusable `webcmd <site>` command.

## Auth profiles and human handoff

Webcmd browser sessions keep signed-in state in profiles. To sign in once, run the session headed and complete login in the window yourself, then close the session; later headless runs reuse the cookies. Profile changes save only on a clean close.

For login walls or CAPTCHA during a run, stop browser writes and hand off to the user with any `handoff.viewUrl` or `Webcmd browser:` link, then verify the post-action state before retrying. Never ask for or type passwords, OTPs, cookies, credentials, or session secrets.

## Security

`webcmd browser run` executes Playwright and JavaScript in the sandboxed browser runtime. Treat the machine running Webcmd as the trust boundary. Do not share profile directories across untrusted users.

## Important Instructions and Constraints to be Successful

- Fix only setup-related failures.
- Do not make unrelated changes or invent secrets.
- Adapter first, browser second: before opening a raw browser session, check `webcmd list -f json` for an adapter that covers the task. Use raw `webcmd browser` only when no adapter exists.
- Never ask for or type passwords, OTPs, cookies, credentials, or session secrets. Use Webcmd's human handoff for login walls.
