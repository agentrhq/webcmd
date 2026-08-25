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

### Install the plugin

```bash
claude plugin marketplace add agentrhq/webcmd
claude plugin install webcmd@webcmd
```

This installs all seven bundled Webcmd skills. Do not also add those skills with `webcmd skills add`; running both leaves two copies that can sit at different versions.

Plugin updates are version-gated, not commit-gated. Run `claude plugin update webcmd@webcmd` to pick up a new release; it is separate from `webcmd update`, which upgrades only the npm CLI.

### Install and configure without the plugin

Install Webcmd and its skills:

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
| Skills not loading in Claude Code | Run `webcmd skills add` with the `claude` provider, then restart `claude`. With the plugin, run `claude plugin install webcmd@webcmd` and restart. |
| Skill text looks out of date | `webcmd update` upgrades only the CLI. Run `claude plugin update webcmd@webcmd` to refresh plugin skills. |
| Claude Code still uses `WebFetch` / `WebSearch` | Confirm `permissions.deny` lists both in the active settings file, then restart `claude`. |
| `claude` requires permission prompts for `webcmd` | The Bash tool still asks before non-approved commands; run `claude --dangerously-skip-permissions` or allow the shell command if you accept the risk. |
| Browser Session idles or loses its window | Keep its immutable, Profile-scoped ID; `webcmd --profile work --session work-project-k7 browser tabs` reopens it. Start with `webcmd --profile work session create "Work Project"`; use `webcmd --profile work session list` and `webcmd --profile work session close work-project-k7` for lifecycle. Adapter commands without `--session` reuse `adapter-default`; raw browser commands require an explicit readable selector. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
