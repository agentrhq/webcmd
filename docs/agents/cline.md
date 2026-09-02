---
title: Cline
sidebarTitle: Cline
---

## Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

## Manual

### Requirements

* Node.js 20.6+
* The `webcmd` npm CLI, installed globally or in the project
* Cline — the [VS Code extension](https://docs.cline.bot/cline-overview), [CLI](https://docs.cline.bot/usage/cli-overview), or JetBrains plugin
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Install Webcmd and its skills into Cline's skill directories:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add --path ~/.cline/skills
```

For a project-scoped setup that travels with the repo:

```bash
webcmd skills add --path .cline/skills --scope project
```

Cline also discovers skills in `~/.cline/skills/`, `.cline/skills/`, and `.claude/skills/`. It loads skill metadata at startup and activates `webcmd-browser` on demand through its `use_skill` tool.

Restart Cline (or start a new task) after installing skills. In the extension, confirm they appear under the Skills tab (scale icon in the Cline panel).

### Override default tools

Cline's web surface depends on which app you are using:

| Surface | Tools | What to do |
| --- | --- | --- |
| ClineCore (CLI, SDK, Kanban) | `fetch_web` | Prefer Webcmd over `fetch_web` for reading pages |
| IDE extension (Cline provider) | `web_fetch`, `web_search`, `browser_action` | Keep `web_search`; prefer Webcmd over `web_fetch` and `browser_action` on the open web |

`fetch_web` and `web_fetch` are lossy fetches — HTTP with HTML-to-markdown conversion, no real browser session. Webcmd returns authenticated, JavaScript-rendered content and supports multi-step automation. **Keep `web_search`.** Webcmd has no search index of its own.

Cline has no per-tool deny list like OpenCode. Steer it with a rule in `.clinerules/webcmd.md`:

```markdown
# Webcmd for the open web

Use Webcmd for anything on the open web — fetching, authenticated third-party sites, multi-step automation, workflows worth making reusable:

- Check `webcmd list -f json` for an adapter that covers the task; use it first.
- Otherwise run `webcmd --profile work session create "Work Project"`, then drive its returned readable ID with `webcmd --profile work --session work-project-k7 browser tabs` via `bash`.
- Run `webcmd doctor` first; use `webcmd --profile work session list` to inspect state and `webcmd --profile work session close work-project-k7` when finished.
- For login walls, use Webcmd's human handoff; never type passwords, OTPs, cookies, or credentials.

Use Cline's `web_search` to find URLs, then Webcmd to read them.

Use `browser_action` only for the app being edited: localhost dev server, console and network triage, visual checks after a change.

Do not use `fetch_web`, `web_fetch`, or `browser_action` for external third-party sites when Webcmd can handle the task.
```

Commit `.clinerules/webcmd.md` so the whole team gets the split. Toggle it on in the Rules panel (scale icon → Rules tab).

**Full override (opt-in).** In the IDE extension, turn off **Web Tools** under Cline Settings → Feature Settings. That removes `web_fetch` and `web_search` for the Cline provider — only do this if search is not needed. For a hard block on browser automation, leave Web Tools enabled but deny approval for **Use the browser** in Auto Approve settings.

Denying web tools does not affect the `bash` tool, which is how `webcmd` is driven.

Check for browser or scraping MCP servers in `.cline/mcp.json` — they overlap with Webcmd the same way native browser tools do. Disable or remove servers the user does not need.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in Cline | Confirm symlinks exist under `~/.cline/skills/` or `.cline/skills/`, then restart Cline or start a new task. |
| Cline still uses `fetch_web` / `web_fetch` | Confirm `.clinerules/webcmd.md` is toggled on in the Rules panel. |
| `web_search` missing | Web Tools require the Cline provider and the Web Tools toggle in Feature Settings. Not a Webcmd problem. |
| `webcmd` not found in Cline shell | Confirm `webcmd` is on the PATH Cline's `bash` tool uses; restart after installing the CLI. |
| Browser Session idles or loses its window | Keep its immutable, Profile-scoped ID; `webcmd --profile work --session work-project-k7 browser tabs` reopens it. Start with `webcmd --profile work session create "Work Project"`; use `webcmd --profile work session list` and `webcmd --profile work session close work-project-k7` for lifecycle. Adapter commands without `--session` reuse `adapter-default`; raw browser commands require an explicit readable selector. |

## See also

* [Cline documentation](https://docs.cline.bot/cline-overview) — installation, providers, and the core workflow.
* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
