---
title: Codex CLI Agent
sidebarTitle: Codex CLI
---

> **Agent prompt**
>
> ```text
> Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
> ```

> Use Webcmd with [Codex CLI](https://developers.openai.com/codex/) to replace its native `web_search` tool with the Webcmd browser surface.

Codex CLI's native `web_search` tool returns cached or indexed search results but cannot read pages or run authenticated sessions. Point Codex at Webcmd's browser CLI instead: adapters return exact, stable fields, and `webcmd browser` sessions render real pages with logged-in profiles. Codex runs `webcmd` through its shell tool.

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

Codex CLI's native web tool is `web_search`, controlled by the top-level `web_search` setting in `~/.codex/config.toml`. Set it to `"disabled"` to remove the tool so Codex relies on Webcmd for web work:

```toml
web_search = "disabled"
```

Do not rely on the CLI flag `--dangerously-allow-web-search`; it only gates the tool and does not replace Webcmd's browser surface. Note that `web_search` defaults to `"cached"` (results from an OpenAI-maintained index without external web access) unless overridden.

The setting removes only the search tool; it does not affect the shell tool, which is how `webcmd` is driven.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in Codex | Run `webcmd skills add` with the `agents` provider, then restart `codex`. |
| Codex still uses `web_search` | Confirm `web_search = "disabled"` in `~/.codex/config.toml`, then restart `codex`. |
| `webcmd` not found in Codex shell | Confirm `webcmd` is on the PATH Codex uses; restart after installing the CLI. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
