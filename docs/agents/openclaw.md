---
title: OpenClaw Agent
sidebarTitle: OpenClaw
---

## Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

## Manual

### Requirements

* Node.js 20.6+
* The `webcmd` npm CLI, installed globally or in the project
* An OpenClaw Gateway + an agent session where `exec` is enabled
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Install Webcmd and its skills:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add
```

When `webcmd skills add` prompts, choose the `agents` provider. It installs into `~/.agents/skills/` (user) or `.agents/skills/` (project), both of which OpenClaw checks for skills. OpenClaw then surfaces `webcmd-usage` and `webcmd-browser` as skills.

Restart the Gateway (or start a new session) after installing skills.

### Override default tools

OpenClaw's built-in web tools split into two groups — see [the routing rule](../../start.md#the-routing-rule).

Webcmd replaces the fetch and search tools outright. Deny them in the Gateway config (`~/.openclaw/openclaw.json`):

```json
{
  "tools": {
    "deny": ["web_search", "web_fetch", "x_search", "search_news"]
  }
}
```

Keep `browser` and `browser_visual`. They are wired into OpenClaw's dev loop, so use them for the app being edited — localhost dev server, console and network triage, visual checks — and route open-web work to Webcmd. State that split in your OpenClaw system prompt or project instructions.

The Gateway watches the config file and applies changes automatically. Denying these tools does not affect the `exec` tool, which is how `webcmd` is driven.

**Full override (opt-in).** If you never debug local apps through OpenClaw's browser, add `"browser"` and `"browser_visual"` to the deny list so all web access goes through Webcmd.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in OpenClaw | Run `webcmd skills add` with the `agents` provider, then restart the Gateway. |
| OpenClaw still uses `web_search` / `web_fetch` | Confirm `tools.deny` lists the tool IDs in `~/.openclaw/openclaw.json`; the Gateway hot-reloads config. |
| OpenClaw uses `browser` for external sites | Restate the routing rule; for a hard block, add `browser` and `browser_visual` to `tools.deny`. |
| `webcmd` not found in OpenClaw exec | Confirm `webcmd` is on the PATH the Gateway's `exec` tool uses; restart after installing the CLI. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
