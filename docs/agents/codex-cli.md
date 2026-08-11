---
title: Codex CLI Agent
sidebarTitle: Codex CLI
---

## Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

## Manual

### Requirements

* Node.js 20.6+
* The `webcmd` npm CLI, installed globally or in the project
* Codex CLI (`codex`), installed and authenticated
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Install Webcmd and its skills:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add
```

When `webcmd skills add` prompts, choose the `agents` provider. It installs into `~/.agents/skills/` (user) or `.agents/skills/` (project), which Codex CLI reads on startup. Codex then surfaces `webcmd-usage` and `webcmd-browser` as skills.

Restart Codex (or start a new session) after installing skills.

### Override default tools

**Nothing to disable.** Codex CLI has no fetch tool and no browser tool, so Webcmd does not displace anything — it adds the surface Codex is missing. Codex drives it through the shell tool.

Its one web tool is `web_search`, set by the top-level `web_search` key in `~/.codex/config.toml`. **Keep it enabled.** Webcmd has no search index of its own, and search is how a question becomes URLs for Webcmd to read.

One change is worth recommending. `web_search` defaults to `"cached"`, an OpenAI-maintained index with no external web access, so results can be stale. Switching to `"live"` pairs better with Webcmd:

```toml
web_search = "live"
```

Accepted values are `"disabled"`, `"cached"` (default), `"indexed"`, and `"live"`. Ask before changing it — `"live"` means real network egress from the user's machine.

If the user has installed a browser or scraping MCP server, that does overlap with Webcmd. Individual MCP tools are denied per server:

```toml
[mcp_servers.some_browser_mcp]
disabled_tools = ["navigate", "screenshot"]
```

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in Codex | Run `webcmd skills add` with the `agents` provider, then restart `codex`. |
| Search results look stale | `web_search` defaults to `"cached"`. Set `web_search = "live"` in `~/.codex/config.toml`, then restart `codex`. |
| `web_search` was disabled and search stopped working | Expected. Set it back to `"live"` or `"cached"` — Webcmd does not replace search. |
| `webcmd` not found in Codex shell | Confirm `webcmd` is on the PATH Codex uses; restart after installing the CLI. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
