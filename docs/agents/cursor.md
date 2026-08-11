---
title: Cursor Agent
sidebarTitle: Cursor
---

## Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

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

Cursor's agent ships two native web tools, and they get different treatment — see [the routing rule](../../start.md#the-routing-rule).

Webcmd replaces **Web** (search and fetch external documentation) outright. **Browser** (navigate, click, screenshot running apps) is wired into Cursor's dev loop, so keep it for localhost work and route open-web work to Webcmd.

Cursor has no config key that removes either tool, so use an always-applied rule. Add `.cursor/rules/webcmd-browser.mdc`:

```markdown
---
description: Route open-web work to Webcmd; keep Cursor's Browser tool for the local dev loop.
globs:
  - "**/*"
alwaysApply: true
---

Do not use your native Web tool (search/fetch). Use Webcmd instead.

Use Webcmd for anything on the open web — research, fetching, authenticated
third-party sites, multi-step automation, workflows worth making reusable:

- Check `webcmd list -f json` for an adapter that covers the task; use it first.
- Otherwise drive a live browser with `webcmd browser <session> ...` via the shell tool.
- Run `webcmd doctor` first and keep the session lifecycle (`tabs`, `bind`, `snapshot`, `run`, `close`).
- For login walls, use Webcmd's human handoff; never type passwords, OTPs, cookies, or credentials.

Use the native Browser tool only for the app being edited: localhost dev server,
console and network triage, visual checks after a change.
```

The `alwaysApply: true` rule is injected into every Cursor session.

**Full override (opt-in).** If you never debug local apps through Cursor's browser, drop the last paragraph of the rule and set the Browser Automation dropdown in the agent window to **Off** so the built-in browser is not attached at all.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not surfacing in Cursor | Confirm the `webcmd-*` skill folders are under `.cursor/skills/`, `.agents/skills/`, or `~/.agents/skills/`, then restart Cursor. |
| Cursor uses its Web tool instead of Webcmd | Confirm `.cursor/rules/webcmd-browser.mdc` has `alwaysApply: true`. |
| Cursor uses its Browser tool for external sites | Restate the routing rule; for a hard block, set Browser Automation to Off. |
| `webcmd` not found in Cursor shell | Confirm `webcmd` is on the PATH the Cursor shell uses; restart Cursor after installing the CLI. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
