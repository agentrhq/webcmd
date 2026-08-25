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

Pi ships seven built-in tools — `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls` — and no web, search, or browser tool at all, so there is nothing built in to turn off. Webcmd works through `bash` as soon as the CLI is on PATH. Do not reach for `--no-builtin-tools`: it strips `read`/`write`/`edit`/`bash`, and `bash` is how Webcmd runs.

Pi is the harness where competing tools are most likely to come from what the user installed, since every web capability it has is an extension or skill. Check for these and ask before removing any:

| Installed | Overlaps | What to do |
| --- | --- | --- |
| [`pi-skills/browser-tools`](https://github.com/badlogic/pi-skills/tree/main/browser-tools) | Browser automation over CDP (Chrome on `:9222`) | Recommend removing, or tell Pi to prefer Webcmd |
| [`pi-agent-browser-native`](https://github.com/fitchmultz/pi-agent-browser-native) | Exposes agent-browser as a native tool | Recommend removing |
| [`pi-web-fetch`](https://github.com/georgebashi/pi-web-fetch) | Headless-Chrome fetch plus trafilatura extraction | Recommend removing |
| [`pi-web-access`](https://github.com/nicobailon/pi-web-access) | Search **and** content extraction | Keep the search half; set `webSearch.enabled: false` only if the user wants search gone too |
| `pi-skills/brave-search` | Brave Search API, plus content extraction | Keep it for search; tell Pi to prefer Webcmd for reading pages |

Extensions that mix search with extraction are the awkward case: the search half is worth keeping, and only some expose a config toggle to split them. When there is no toggle, steer Pi with instructions instead of removing the extension.

To remove one outright, delete its folder — for example `~/.pi/agent/skills/pi-skills/browser-tools` — and restart Pi.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not surfacing in Pi | Confirm links exist under `~/.agents/skills/`, `.agents/skills/`, `~/.pi/agent/skills/`, or `.pi/skills/` (rerun `webcmd skills add`), ensure the project is trusted, then restart Pi. |
| Pi still uses `browser-tools` or a web-fetch extension | Remove the skill folder or prompt Pi to prefer Webcmd, then restart Pi. |
| Search stopped working after removing an extension | Some extensions bundle search with extraction. Reinstall it and steer Pi with instructions instead — Webcmd does not replace search. |
| `webcmd` not found in Pi's shell | Confirm `webcmd` is on the PATH Pi's `bash` tool uses; restart Pi after installing the CLI. |
| Browser Session idles or loses its window | Keep its immutable, Profile-scoped ID; `webcmd --profile work --session work-project-k7 browser tabs` reopens it. Start with `webcmd --profile work session create "Work Project"`; use `webcmd --profile work session list` and `webcmd --profile work session close work-project-k7` for lifecycle. Adapter commands without `--session` reuse `adapter-default`; raw browser commands require an explicit readable selector. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
