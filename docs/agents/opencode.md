---
title: OpenCode Agent
sidebarTitle: OpenCode
---

## Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

## Manual

### Requirements

* Node.js 20.6+
* The `webcmd` npm CLI, installed globally or in the project
* OpenCode config access (`./opencode.json` or `~/.config/opencode/opencode.json`)
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Install Webcmd and its skills:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add
```

When `webcmd skills add` prompts, choose the `agents` provider (installs into `~/.agents/skills/`, which OpenCode auto-loads). OpenCode then reads `webcmd-usage` and `webcmd-browser` as skills.

Restart OpenCode after changing config. Confirm the skill loads with `/skills` and the permissions are active before starting browser work.

### Override default tools

OpenCode's native web tools are `webfetch` (fetch a URL) and `websearch` (search). Deny both so OpenCode cannot fall back to them while Webcmd is its browser surface. Do not add a legacy `tools` block as well; `permission` is the supported field. Denying the tools does not turn off the Bash tool, which is how `webcmd browser` is driven.

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "webfetch": "deny",
    "websearch": "deny"
  }
}
```

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in OpenCode | Run `webcmd skills add` with the `agents` provider, restart OpenCode, and check `/skills`. |
| OpenCode still uses `webfetch` / `websearch` | Confirm `permission.webfetch` and `permission.websearch` are `deny` in the active config, then restart OpenCode. |
| `webcmd browser` errors | Read `webcmd-usage` and `webcmd-browser` skills; sessions require a `<session>` name after `browser`. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
