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

### 4. Override default tools

Open the *Override default tools* section on the matching per-agent page under `docs/agents/`. Disable the agent's native browser tools so Webcmd is used instead:

| Harness | Native tools Webcmd replaces | Page |
| --- | --- | --- |
| Cursor | `Browser`, `Web` | [cursor.md](docs/agents/cursor.md#override-default-tools) |
| OpenCode | `webfetch`, `websearch` | [opencode.md](docs/agents/opencode.md#override-default-tools) |
| Claude Code | `WebFetch`, `WebSearch` | [claude-code.md](docs/agents/claude-code.md#override-default-tools) |
| Codex CLI | `web_search` | [codex-cli.md](docs/agents/codex-cli.md#override-default-tools) |
| Hermes Agent | `browser_*` | [hermes.md](docs/agents/hermes.md#override-default-tools) |
| Pi | none (optional `pi-skills`) | [pi.md](docs/agents/pi.md#override-default-tools) |
| OpenClaw | `web_search`, `web_fetch`, `browser` | [openclaw.md](docs/agents/openclaw.md#override-default-tools) |
| Other Coding Agents | native web fetch / browser tools | see instructions below |

If your harness is not listed above, disable any default built-in browser tool or web-search tool so the agent uses Webcmd instead. Do not disable builtin web search tool and keep custom tools and skills untouched. If the harness has none of these tools, no override is needed.

### 5. Finish

After verifying Webcmd is set up and working properly, summarize the steps you took and offer some sample browser automations you could build next, such as:

- Research a topic across a site and return a concise comparison with source links.
- Collect bookmarks, messages, or profile data using a logged-in profile.
- Check product prices, availability, or delivery options.
- Turn a proven browser workflow into a reusable `webcmd <site>` command.

## MCP-based agents

MCP-based agents consume tools only through an MCP server. Not implemented yet; support is coming soon.
