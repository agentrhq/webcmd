---
title: OpenCode
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

When `webcmd skills add` prompts, choose the `agents` provider (installs into `~/.agents/skills/`, which OpenCode auto-loads). OpenCode then reads `webcmd-browser` as a skill.

Restart OpenCode after changing config. Confirm the skill loads with `/skills` and the permissions are active before starting browser work.

### Override default tools

OpenCode's native web tools are `webfetch` (fetch a URL) and `websearch` (search). OpenCode has no browser tool.

Deny `webfetch` so OpenCode cannot fall back to it while Webcmd is its browser surface. Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "webfetch": "deny"
  }
}
```

**Keep `websearch`.** Webcmd has no search index of its own, so search stays useful — it turns a question into URLs that Webcmd then reads. Note that `websearch` only registers when the OpenCode provider is in use or `OPENCODE_ENABLE_EXA=1` is set, so it may already be absent.

`permission` values are `allow`, `deny`, and `ask`, and wildcards work (`"mymcp_*": "deny"`) — useful if the user has a browser or scraping MCP that overlaps with Webcmd. Do not add a legacy `tools` block as well; `permission` is the supported field. Denying tools does not turn off the Bash tool, which is how `webcmd browser` is driven.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in OpenCode | Run `webcmd skills add` with the `agents` provider, restart OpenCode, and check `/skills`. |
| OpenCode still uses `webfetch` | Confirm `permission.webfetch` is `deny` in the active config, then restart OpenCode. |
| `websearch` is missing entirely | It registers only with the OpenCode provider or `OPENCODE_ENABLE_EXA=1`. Not a Webcmd problem. |
| `webcmd browser` errors | Read `webcmd-browser`; create a named Session and pass its readable ID as root `--session`. |
| Browser Session idles or loses its window | Keep its immutable, Profile-scoped ID; `webcmd --profile work --session work-project-k7 browser tabs` reopens it. Start with `webcmd --profile work session create "Work Project"`; use `webcmd --profile work session list` and `webcmd --profile work session close work-project-k7` for lifecycle. Adapter commands without `--session` reuse `adapter-default`; raw browser commands require an explicit readable selector. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
