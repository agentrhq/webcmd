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

When `webcmd skills add` prompts, choose the `agents` provider. It installs into `~/.agents/skills/`, which Cursor reads on startup along with `.cursor/skills/`, `.agents/skills/`, and `~/.cursor/skills/`. Cursor then surfaces `webcmd-browser` as a skill when a task matches its description.

For a project-scoped setup, copy the `webcmd-*` skill folders into the project's `.cursor/skills/` or `.agents/skills/` so the whole team gets them. Restart Cursor after installing skills.

### Override default tools

Cursor's agent ships two native web tools:

* **Web** — generates search queries and performs web searches. This is Cursor's search tool. **Keep it on** (Settings has a "Web Search Tool" toggle); Webcmd has no search index of its own.
* **Browser** — navigate, click, type, scroll, screenshot, plus console logs and network traffic. It has dev-server awareness for localhost but can navigate anywhere on the web, so it is the tool that overlaps with Webcmd.

Cursor has no config key that removes the Browser tool for individual users, so steer it with an always-applied rule. Add `.cursor/rules/webcmd-browser.mdc`:

```markdown
---
description: Use Webcmd for the open web; keep Cursor's Browser tool for the local dev loop.
globs:
  - "**/*"
alwaysApply: true
---

Use Webcmd for anything on the open web — fetching, authenticated
third-party sites, multi-step automation, workflows worth making reusable:

- Check `webcmd list -f json` for an adapter that covers the task; use it first.
- Otherwise run `webcmd --profile work session create "Work Project"`, then drive its returned readable ID with `webcmd --profile work --session work-project-k7 browser tabs` via the shell tool.
- Run `webcmd doctor` first; use `webcmd --profile work session list` to inspect state and `webcmd --profile work session close work-project-k7` when finished.
- For login walls, use Webcmd's human handoff; never type passwords, OTPs, cookies, or credentials.

Use the native Browser tool only for the app being edited: localhost dev server,
console and network triage, visual checks after a change.

Keep using the Web tool to search. Webcmd reads the pages that search finds.
```

The `alwaysApply: true` rule is injected into every Cursor session.

Note that the rule is guidance, not a block. Cursor's Browser Automation has been reported to enable itself when a prompt mentions "browser", and the user-level switch to turn it off has come and gone across releases — so expect the agent to reach for it occasionally even with the rule in place.

**Full override (opt-in).** If the user never debugs local apps through Cursor's browser, drop the Browser paragraph from the rule and set Browser Automation to **Off** in the agent window. On Team and Enterprise plans an admin can also toggle browser features in the Settings Dashboard under MCP Configuration, or restrict the agent to an origin allowlist.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not surfacing in Cursor | Confirm the `webcmd-*` skill folders are under `.cursor/skills/`, `.agents/skills/`, or `~/.agents/skills/`, then restart Cursor. |
| Cursor uses its Browser tool for external sites | Confirm `.cursor/rules/webcmd-browser.mdc` has `alwaysApply: true`; for a hard block, set Browser Automation to Off. |
| Browser Automation turns itself back on | Known behaviour — a prompt mentioning "browser" can re-enable it. Avoid the word, or turn it off in the agent window. |
| `webcmd` not found in Cursor shell | Confirm `webcmd` is on the PATH the Cursor shell uses; restart Cursor after installing the CLI. |
| Browser Session idles or loses its window | Keep its immutable, Profile-scoped ID; `webcmd --profile work --session work-project-k7 browser tabs` reopens it. Start with `webcmd --profile work session create "Work Project"`; use `webcmd --profile work session list` and `webcmd --profile work session close work-project-k7` for lifecycle. Adapter commands without `--session` reuse `adapter-default`; raw browser commands require an explicit readable selector. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
