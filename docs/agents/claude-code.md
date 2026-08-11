---
title: Claude Code Agent
sidebarTitle: Claude Code
---

## Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

## Manual

### Requirements

* Node.js 20.6+
* The `webcmd` npm CLI, installed globally or in the project
* Claude Code (`claude`), installed globally or in the project
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Pick one of the two paths below. Do not use both — the plugin already carries the skills, and installing them again leaves duplicates.

#### Plugin (recommended)

Add the marketplace and install the plugin:

```bash
claude plugin marketplace add agentrhq/webcmd
```

```bash
claude plugin install webcmd@webcmd
```

Or from inside a session, with the slash-command equivalents: `/plugin marketplace add agentrhq/webcmd`, then `/plugin install webcmd@webcmd`.

Pin to a branch or tag by appending `@ref` to the source: `claude plugin marketplace add agentrhq/webcmd@v1.0`. Both commands take `--scope user` (default), `project`, or `local`; use `--scope project` to commit the marketplace so the whole team gets it.

The plugin bundles all seven Webcmd skills. Start a new session after installing.

Useful follow-ups: `claude plugin list`, `claude plugin uninstall webcmd`, `claude plugin marketplace update webcmd`.

#### Manual

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add
```

When `webcmd skills add` prompts, choose the `claude` provider. It installs into `~/.claude/skills/` (user) or `.claude/skills/` (project), which Claude Code reads on startup. Claude Code then surfaces `webcmd-usage` and `webcmd-browser` as skills when a task matches their descriptions.

Restart Claude Code (or start a new session) after installing skills.

### Override default tools

Claude Code ships two native web tools — `WebFetch` (fetch a URL) and `WebSearch` (search) — both permission-gated by default.

Deny `WebFetch`. It is lossy by design: a small, fast model runs an extraction prompt against the page and Claude receives that model's answer, not the page. Webcmd returns the real content. Add to the user or project settings file (`.claude/settings.json` in the project, or `~/.claude/settings.json`):

```json
{
  "permissions": {
    "deny": ["WebFetch"]
  }
}
```

Or per invocation:

```bash
claude --disallowedTools WebFetch
```

**Keep `WebSearch`.** It returns result titles and URLs without fetching the pages, which is exactly the step Webcmd does not cover — Webcmd has no search index. Let Claude Code search, then let Webcmd read what it finds.

If the desktop app's Browser pane is in use, its tools are MCP-named (`mcp__Claude_Browser__*`) and can be denied the same way:

```json
{
  "permissions": {
    "deny": ["WebFetch", "mcp__Claude_Browser__*"]
  }
}
```

Only deny those if the user does not use the Browser pane for their own app — it is wired into the local dev loop. There is also a `browserExternalPageTools: "disabled"` setting, but it applies to managed settings only.

Denying these tools does not affect the Bash tool, which is how `webcmd` is driven.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in Claude Code | Run `webcmd skills add` with the `claude` provider, then restart `claude`. |
| Claude Code still uses `WebFetch` | Confirm `permissions.deny` lists it in the active settings file, then restart `claude`. |
| `WebSearch` was denied and search stopped working | Expected. Remove it from `permissions.deny` — Webcmd does not replace search. |
| `claude` requires permission prompts for `webcmd` | The Bash tool still asks before non-approved commands; run `claude --dangerously-skip-permissions` or allow the shell command if you accept the risk. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
