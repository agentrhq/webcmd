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

### 4. Route web work to Webcmd

Open the *Override default tools* section on the matching per-agent page under `docs/agents/`. Harnesses get one of two treatments.

**Replace** — narrow fetch and search tools. Webcmd covers these end to end (adapters plus the `smart-search` skill), so disable them and let Webcmd be the harness's web surface.

| Harness | Tools to disable | Page |
| --- | --- | --- |
| Claude Code | `WebFetch`, `WebSearch` | [claude-code.md](docs/agents/claude-code.md#override-default-tools) |
| Codex CLI | `web_search` | [codex-cli.md](docs/agents/codex-cli.md#override-default-tools) |
| OpenCode | `webfetch`, `websearch` | [opencode.md](docs/agents/opencode.md#override-default-tools) |

**Route** — full browser toolsets. These do more than Webcmd targets: they are wired into the local dev loop, attaching to a running dev server and surfacing console errors, network activity, and screenshots of the app under edit. Do not disable them by default. Apply the routing rule below instead.

| Harness | Native browser toolset | Also disable (Replace tools) | Page |
| --- | --- | --- | --- |
| Cursor | `Browser` | `Web` | [cursor.md](docs/agents/cursor.md#override-default-tools) |
| Hermes Agent | `browser_*` | — (bundles `web_search`; see page) | [hermes.md](docs/agents/hermes.md#override-default-tools) |
| OpenClaw | `browser`, `browser_visual` | `web_search`, `web_fetch`, `x_search`, `search_news` | [openclaw.md](docs/agents/openclaw.md#override-default-tools) |
| Pi | none (optional `pi-skills`) | — | [pi.md](docs/agents/pi.md#override-default-tools) |

#### The routing rule

Use **Webcmd** for the open web: research and fetching, authenticated third-party sites, multi-step automation, anything worth turning into a reusable adapter. Webcmd owns auth profiles, human handoff, token-compact snapshots, and the adapter registry.

Use the **harness's native browser tool** for the app you are editing: localhost dev server, console and network triage, visual checks after a change. It is attached to the dev loop; Webcmd is not.

This is a question of integration, not capability — `webcmd browser <session> run` can drive localhost too. Routing by task domain means neither surface has to be crippled.

If your harness is not listed above, apply the same split: disable a plain fetch or search tool, keep a full browser toolset and state the routing rule in the harness's system prompt or rules file. Leave custom tools and skills untouched. If the harness has neither kind of tool, no override is needed.

**Full override (opt-in).** If you never debug local apps through the harness browser and want the token savings, disable the native browser toolset as well and use Webcmd for everything. Each per-agent page documents how.

### 5. Finish

After verifying Webcmd is set up and working properly, summarize the steps you took and offer some sample browser automations you could build next, such as:

- Research a topic across a site and return a concise comparison with source links.
- Collect bookmarks, messages, or profile data using a logged-in profile.
- Check product prices, availability, or delivery options.
- Turn a proven browser workflow into a reusable `webcmd <site>` command.

## MCP-based agents

MCP-based agents consume tools only through an MCP server. Not implemented yet; support is coming soon.
