---
title: OpenClaw
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

When `webcmd skills add` prompts, choose the `agents` provider. It installs into `~/.agents/skills/` (user) or `.agents/skills/` (project), both of which OpenClaw checks for skills. OpenClaw then surfaces `webcmd-browser` as a skill.

Restart the Gateway (or start a new session) after installing skills.

### Override default tools

Deny `web_fetch`. It is an HTTP fetch with readable extraction and does not execute JavaScript, so it fails on exactly the dynamic sites Webcmd handles. In the Gateway config (`~/.openclaw/openclaw.json`):

```json
{
  "tools": {
    "deny": ["web_fetch"]
  }
}
```

**Keep the search tools** — `web_search` (backed by Brave, Gemini, Grok, Kimi, or Perplexity), `x_search`, and `search_news`. Webcmd has no search index of its own, so search stays the cheapest way to find URLs for Webcmd to read.

The `browser` tool is a single tool with subcommands (`doctor`, `status`, `start`, `stop`, `tabs`, `open`, `focus`, `close`, `snapshot`, `screenshot`, `navigate`, `act`). It reaches both localhost and the open web, so keep it for the app being edited and route open-web work to Webcmd. State that split in your OpenClaw system prompt or project instructions.

Worth raising with the user: OpenClaw's browser has a `user` profile that reuses their existing signed-in sessions, which overlaps directly with Webcmd's auth profiles. Its isolated `openclaw` profile does not.

The Gateway watches the config file and applies changes automatically. Denying these tools does not affect the `exec` tool, which is how `webcmd` is driven.

**Full override (opt-in).** If the user never debugs local apps through OpenClaw's browser, disable it outright:

```json
{
  "browser": { "enabled": false }
}
```

Or remove it entirely — CLI, `browser.request` gateway method, and agent tool — by disabling the plugin:

```json
{
  "plugins": {
    "entries": {
      "browser": { "enabled": false }
    }
  }
}
```

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in OpenClaw | Run `webcmd skills add` with the `agents` provider, then restart the Gateway. |
| OpenClaw still uses `web_fetch` | Confirm `tools.deny` lists it in `~/.openclaw/openclaw.json`; the Gateway hot-reloads config. |
| OpenClaw uses `browser` for external sites | Remind it that Webcmd handles the open web; for a hard block, set `browser.enabled: false`. |
| Search stopped working | Check whether `web_search` was denied. Webcmd does not replace search — remove it from `tools.deny`. |
| `webcmd` not found in OpenClaw exec | Confirm `webcmd` is on the PATH the Gateway's `exec` tool uses; restart after installing the CLI. |
| Browser Session idles or loses its window | Keep its immutable, Profile-scoped ID; `webcmd --profile work --session work-project-k7 browser tabs` reopens it. Start with `webcmd --profile work session create "Work Project"`; use `webcmd --profile work session list` and `webcmd --profile work session close work-project-k7` for lifecycle. Adapter commands without `--session` reuse `adapter-default`; raw browser commands require an explicit readable selector. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
