---
title: Cursor Agent
sidebarTitle: Cursor
---

## Agent prompt

Use this prompt with a coding agent to set up Webcmd end to end:

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

> Use Webcmd with [Cursor](https://cursor.com) to replace its built-in Browser and Web tools with Webcmd's adapters and `webcmd browser` sessions.

Point Cursor's agent at Webcmd's browser CLI to replace its native Browser (navigate/click/screenshot) and Web (search/fetch) tools with Webcmd's adapters and `webcmd browser` sessions. Cursor's agent drives Webcmd through its shell tool. Adapter-first commands and compact snapshots usually use fewer tokens than Cursor's native web tools.

## Manual

### Requirements

* Node.js 20.6+
* The `webcmd` npm CLI, installed globally or in the project
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Install Webcmd and its skills:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add
```

When `webcmd skills add` prompts, choose the `agents` provider. It installs into `~/.agents/skills/`, which Cursor reads on startup along with `.cursor/skills/`, `.agents/skills/`, and `~/.cursor/skills/`. Cursor then surfaces `webcmd-usage` and `webcmd-browser` as skills when a task matches their descriptions.

For a project-scoped setup, copy the `webcmd-*` skill folders into the project's `.cursor/skills/` or `.agents/skills/` so the whole team gets them. Restart Cursor after installing skills.

### Override default tools

Cursor's agent ships two native web tools: **Browser** (navigate, click, screenshot running apps) and **Web** (search and fetch external documentation). Cursor has no single config key that removes them, so replace them with an always-applied rule that forces Webcmd usage.

Add `.cursor/rules/webcmd-browser.mdc`:

```markdown
---
description: Use Webcmd for all browser automation instead of Cursor's built-in Browser and Web tools.
globs:
  - "**/*"
alwaysApply: true
---

Do not use your native Browser tool (navigate/click/screenshot) or your Web tool (search/fetch) for browser work.

Use Webcmd instead:

- Check `webcmd list -f json` for an adapter that covers the task; use it first.
- Otherwise drive a live browser with `webcmd browser <session> ...` via the shell tool.
- Run `webcmd doctor` first and keep the session lifecycle (`tabs`, `bind`, `snapshot`, `run`, `close`).
- For login walls, use Webcmd's human handoff; never type passwords, OTPs, cookies, or credentials.
```

The `alwaysApply: true` rule is injected into every Cursor session, so the agent does not fall back to its native Browser/Web tools. You can also set the Browser Automation dropdown in the agent window to **Off** so the built-in browser is not attached at all.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not surfacing in Cursor | Confirm the `webcmd-*` skill folders are under `.cursor/skills/`, `.agents/skills/`, or `~/.agents/skills/`, then restart Cursor. |
| Cursor still uses its Browser/Web tools | Confirm `.cursor/rules/webcmd-browser.mdc` has `alwaysApply: true`, and set Browser Automation to Off. |
| `webcmd` not found in Cursor shell | Confirm `webcmd` is on the PATH the Cursor shell uses; restart Cursor after installing the CLI. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
