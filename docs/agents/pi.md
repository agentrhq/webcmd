---
title: Pi Agent
sidebarTitle: Pi
---

## Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

## Manual

### Requirements

* Node.js 20.6+
* The `webcmd` npm CLI, installed globally or in the project
* Pi (`@earendil-works/pi-coding-agent`), running in a terminal session
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Install Webcmd and its skills:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add
```

When `webcmd skills add` prompts, choose the `agents` provider. It links skills into `~/.agents/skills/` (user) or `.agents/skills/` (project), both of which Pi scans for skills on startup alongside its own `~/.pi/agent/skills/` and `.pi/skills/` directories. Pi then surfaces `webcmd-usage` and `webcmd-browser` as skills.

To install into Pi's own skill directories instead, pass a custom path:

```bash
webcmd skills add --path ~/.pi/agent/skills   # user level
webcmd skills add --path .pi/skills           # project level
```

Project skills under `.pi/skills` and `.agents/skills` load only after the project is trusted. Accept Pi's trust prompt on first run in the project, or set `defaultProjectTrust` to `always` in `~/.pi/agent/settings.json`. Restart Pi after installing skills so the new skill descriptions are picked up at startup.

### Override default tools

Pi has no built-in web, search, or browser tools, so there is nothing to turn off. Webcmd works through the default `bash` tool as soon as the CLI is on PATH.

If you also installed the official [pi-skills](https://github.com/badlogic/pi-skills) collection, two skills overlap with Webcmd:

* `brave-search` — web search and content extraction via the Brave Search API
* `browser-tools` — browser automation via the Chrome DevTools Protocol (Chrome on `:9222`)

If both are present, tell Pi to prefer Webcmd, or remove the competing folders (for example `~/.pi/agent/skills/pi-skills/browser-tools`) so the model does not fall back to them.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not surfacing in Pi | Confirm links exist under `~/.agents/skills/`, `.agents/skills/`, `~/.pi/agent/skills/`, or `.pi/skills/` (rerun `webcmd skills add`), ensure the project is trusted, then restart Pi. |
| Pi still uses `brave-search` / `browser-tools` | Remove those skill folders or prompt Pi to prefer Webcmd. |
| `webcmd` not found in Pi's shell | Confirm `webcmd` is on the PATH Pi's `bash` tool uses; restart Pi after installing the CLI. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
