---
title: OpenClaw Agent
sidebarTitle: OpenClaw
---

> **Agent prompt**
>
> Fetch and follow [start.md](https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md) to set up Webcmd end to end, then read this page's Manual — especially [Override default tools](#override-default-tools) — before doing browser work.

> Use Webcmd with [OpenClaw](https://openclaw.ai) to replace its built-in `web_search`, `web_fetch`, and `browser` tools with the Webcmd browser surface.

OpenClaw ships core web tools (`web_search`, `web_fetch`, `browser`, `browser_visual`, `search_news`) plus a Playwright-based browser. Point OpenClaw at Webcmd's browser CLI instead: adapters return exact, stable fields, and `webcmd browser` sessions keep logged-in profiles. OpenClaw runs `webcmd` through its `exec` tool.

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

OpenClaw's built-in web tools are `web_search`, `web_fetch`, `browser`, `browser_visual`, and `search_news`. Deny the ones that overlap with Webcmd in the Gateway config (`~/.openclaw/openclaw.json`) so OpenClaw relies on Webcmd for browser work:

```json
{
  "tools": {
    "deny": ["web_search", "web_fetch", "browser", "browser_visual"]
  }
}
```

`search_news` only covers news queries; deny it too if you want all web access through Webcmd. The Gateway watches the config file and applies changes automatically. Denying these tools does not affect the `exec` tool, which is how `webcmd` is driven.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in OpenClaw | Run `webcmd skills add` with the `agents` provider, then restart the Gateway. |
| OpenClaw still uses its native web tools | Confirm `tools.deny` lists the tool IDs in `~/.openclaw/openclaw.json`; the Gateway hot-reloads config. |
| `webcmd` not found in OpenClaw exec | Confirm `webcmd` is on the PATH the Gateway's `exec` tool uses; restart after installing the CLI. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
