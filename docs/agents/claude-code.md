---
title: Claude Code Agent
sidebarTitle: Claude Code
---

## Agent prompt

> Fetch and follow [https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md](https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md) to set up Webcmd end to end.

## Manual

### Requirements

* Node.js 20.6+
* The `webcmd` npm CLI, installed globally or in the project
* Claude Code (`claude`), installed globally or in the project
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Install Webcmd and its skills:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add
```

When `webcmd skills add` prompts, choose the `claude` provider. It installs into `~/.claude/skills/` (user) or `.claude/skills/` (project), which Claude Code reads on startup. Claude Code then surfaces `webcmd-usage` and `webcmd-browser` as skills when a task matches their descriptions.

Restart Claude Code (or start a new session) after installing skills.

### Override default tools

Claude Code ships two native web tools — `WebFetch` (fetch a URL) and `WebSearch` (search). Both are permission-gated by default. Deny them so Claude Code cannot fall back to them while Webcmd is its web surface. Add to the user or project settings file (`.claude/settings.json` in the project, or `~/.claude/settings.json`):

```json
{
  "permissions": {
    "deny": ["WebFetch", "WebSearch"]
  }
}
```

Alternatively, pass the flag per invocation:

```bash
claude --disallowedTools WebFetch WebSearch
```

Denying these tools does not affect the Bash tool, which is how `webcmd` is driven.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in Claude Code | Run `webcmd skills add` with the `claude` provider, then restart `claude`. |
| Claude Code still uses `WebFetch` / `WebSearch` | Confirm `permissions.deny` lists both in the active settings file, then restart `claude`. |
| `claude` requires permission prompts for `webcmd` | The Bash tool still asks before non-approved commands; run `claude --dangerously-skip-permissions` or allow the shell command if you accept the risk. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
