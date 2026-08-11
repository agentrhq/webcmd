# Set Up Webcmd

This is a guide for agents to install Webcmd and verify that it runs end to end. Start with understanding the environment where webcmd will be used.

- **Coding agent** — a terminal- or shell-driven harness with a bash/shell tool and skills support (Cursor, OpenCode, Claude Code, Codex CLI, Hermes Agent, Pi, OpenClaw). Fully supported by this guide; each has a per-agent page below.
- **MCP-based agent** — a harness that consumes tools only through MCP tools and supports skills, but cannot access locally installed software. Not implemented yet; support is coming soon.
- **Custom SDK** — programmatic integration (AI SDK, LangGraph, and similar). No agent onboarding here; follow the manual docs under `docs/agents/`.

If the user already chose a path, location, name, or harness, treat that as binding. For example, opencode agent maybe asked to setup Hermes agent, then you should instructions related to Hermes.

## Coding agents

### 1. Install or update

Check whether Webcmd is already installed:

```bash
webcmd --version
```

If that fails, install it. For a global install:

```bash
npm install -g @agentrhq/webcmd
```

For a project install, run the equivalent commands with the project's package manager (npm, pnpm, yarn, bun).

If Webcmd is already installed, update it:

```bash
webcmd update
```

Then run:

```bash
webcmd doctor
```

`webcmd doctor` must be green before browser commands will work. Fix only the setup issue `doctor` reports; do not proceed until it passes.

### 2. Read installed guidance

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

If none of those paths exist because the project has no `.agents/`, `.codex/`, or `.claude/` directory, create the appropriate agent directory and rerun `webcmd skills add`.

### 3. Verify

Using the Webcmd skill installed in the previous step, complete this task:

> Pull the top 5 stories from Hacker News and return each story's title and URL.

Do not hand-write a one-off script from memory. Follow the skill guidance, run the task end to end, and close any browser session you open. Success means returning five real stories with titles and URLs.

### 4. Override installed tools

Recommend these changes to the user and ask before applying any of them. Do not edit their tool configuration on your own.

Suggest disabling the harness's built-in fetch and search tools, since Webcmd covers them and returns exact fields from real pages instead of summaries:

| Harness | Suggest disabling | Page |
| --- | --- | --- |
| Claude Code | `WebFetch`, `WebSearch` | [claude-code.md](docs/agents/claude-code.md#override-default-tools) |
| Codex CLI | `web_search` | [codex-cli.md](docs/agents/codex-cli.md#override-default-tools) |
| OpenCode | `webfetch`, `websearch` | [opencode.md](docs/agents/opencode.md#override-default-tools) |
| Cursor | `Web` | [cursor.md](docs/agents/cursor.md#override-default-tools) |
| OpenClaw | `web_search`, `web_fetch`, `x_search`, `search_news` | [openclaw.md](docs/agents/openclaw.md#override-default-tools) |
| Hermes Agent | `web_search` (bundled in `browser`; see page) | [hermes.md](docs/agents/hermes.md#override-default-tools) |
| Pi | none | [pi.md](docs/agents/pi.md#override-default-tools) |

Leave full browser toolsets enabled — Cursor's `Browser`, Hermes' `browser_*`, OpenClaw's `browser`. They are attached to the local dev server, which Webcmd is not. Use them for localhost; use Webcmd for the open web.

The same applies to tools the user installed themselves. A Playwright or Puppeteer MCP, a scraping or search MCP, or a custom web-fetch skill competes with Webcmd for the same tasks — list what you find and ask. Leave project-specific tools and skills alone.

### 5. Finish

After verifying Webcmd is set up and working properly, summarize the steps you took and offer some sample browser automations you could build next, such as:

- Research a topic across a site and return a concise comparison with source links.
- Collect bookmarks, messages, or profile data using a logged-in profile.
- Check product prices, availability, or delivery options.
- Turn a proven browser workflow into a reusable `webcmd <site>` command.

## MCP-based agents

MCP-based agents consume tools only through an MCP server. Not implemented yet; support is coming soon.
