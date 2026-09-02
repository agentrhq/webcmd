---
title: Aider
sidebarTitle: Aider
---

## Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

## Manual

### Requirements

* Node.js 20.6+
* The `webcmd` npm CLI, installed globally or in the project
* [Aider](https://aider.chat/docs/) (`aider`), installed and configured with an LLM
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Aider has no skills system. Install Webcmd and load its skill instructions as read-only context:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add
```

When `webcmd skills add` prompts, choose the `agents` provider. It installs into `~/.agents/skills/` (user) or `.agents/skills/` (project).

Then add the skill file to Aider's `read` list in `.aider.conf.yml` at your repo root or home directory:

```yaml
read:
  - ~/.agents/skills/webcmd-browser/SKILL.md
```

Aider loads `read` files at startup as read-only reference and caches them when prompt caching is enabled. Restart Aider after changing config.

For a project-scoped setup, use `.agents/skills/` paths relative to the repo:

```yaml
read:
  - .agents/skills/webcmd-browser/SKILL.md
```

### Override default tools

Aider's built-in tools are file editing, git, linting, and shell access through `/run` (alias `!`). It has no search tool and no browser automation tool.

The overlap is `/web`, which scrapes a URL into markdown using `httpx` or Playwright. That is a one-shot fetch — it does not handle JavaScript-heavy pages, authenticated sessions, or multi-step workflows the way Webcmd does. Prefer `/run webcmd ...` instead.

Add this to your conventions file (for example `CONVENTIONS.md`) and include it in the `read` list alongside the Webcmd skills:

```markdown
# Webcmd for the open web

When a task needs web content, authenticated sites, or browser automation:

- Run `webcmd list -f json` first to check for an existing adapter.
- Use `/run webcmd ...` (or `!webcmd ...`) to drive Webcmd from the shell.
- For interactive browser work, create a named session: `webcmd --profile work session create "Work Project"`, then pass its readable ID to later commands.
- For login walls, use Webcmd's human handoff; never type passwords, OTPs, cookies, or credentials.

Do not use `/web` when Webcmd can handle the task. `/web` is a lossy scrape; Webcmd returns real page content and supports sessions.
```

To stop Aider from auto-offering `/web` when it detects URLs in your messages, set in `.aider.conf.yml`:

```yaml
detect-urls: false
```

Aider has no search index. When you need to discover URLs, find them yourself or pipe search results into the chat — Webcmd reads the pages that search finds.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Aider ignores Webcmd instructions | Confirm the skill files are in the `read` list in `.aider.conf.yml`, then restart Aider. |
| Aider still uses `/web` | Add the conventions guidance above; set `detect-urls: false` to stop URL auto-detection. |
| `/web` keeps prompting for Playwright | Expected on JS-heavy sites. Use Webcmd instead, or install Playwright per [Aider's optional setup](https://aider.chat/docs/install/optional.html). |
| `webcmd` not found in `/run` | Confirm `webcmd` is on the PATH in the shell Aider uses; restart the terminal session. |
| Browser Session idles or loses its window | Keep its immutable, Profile-scoped ID; `webcmd --profile work --session work-project-k7 browser tabs` reopens it. Start with `webcmd --profile work session create "Work Project"`; use `webcmd --profile work session list` and `webcmd --profile work session close work-project-k7` for lifecycle. Adapter commands without `--session` reuse `adapter-default`; raw browser commands require an explicit readable selector. |

## See also

* [Aider documentation](https://aider.chat/docs/) — installation, usage, LLM configuration, and in-chat commands.
* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
