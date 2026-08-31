---
title: Hermes Agent
sidebarTitle: Hermes
---

## Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

## Manual

### Requirements

* Node.js 20.6+ on the Hermes host
* The `webcmd` npm CLI, installed globally on the Hermes host
* Hermes `terminal` toolset enabled (needed to run `webcmd`)
* A browser runtime; confirm with `webcmd doctor` before browser work

### Install and configure

Install Webcmd and its skills on the Hermes host:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
webcmd skills add
```

When `webcmd skills add` prompts, choose the `agents` provider (installs into `~/.agents/skills/`). Then make Hermes load those skills by adding the external skills directory to `~/.hermes/config.yaml`:

```yaml
skills:
  external_dirs:
    - ~/.agents/skills
```

Hermes then reads `webcmd-browser` as a skill. Restart Hermes after changing config and confirm the skill is discoverable.

### Override default tools

Hermes' web surface spans three toolsets:

| Toolset | Tools | What to do |
| --- | --- | --- |
| `web` | `web_search`, `web_extract` | Keep enabled for `web_search`; prefer Webcmd over `web_extract` |
| `browser` | `browser_navigate`, `browser_click`, `browser_type`, `browser_scroll`, `browser_press`, `browser_back`, `browser_snapshot`, `browser_vision`, `browser_console`, `browser_get_images`, plus CDP-gated `browser_cdp` and `browser_dialog` | Keep for localhost, route open-web work to Webcmd |
| `x_search` | `x_search` | Keep — it is search, and it auto-enables whenever xAI credentials are present |

`web_search` lives in `web`, not in `browser`, so disabling `browser` leaves search intact.

**Hermes toggles toolsets, not individual tools.** There is no way to drop `web_extract` while keeping `web_search`, so leave the `web` toolset on and steer the agent with instructions instead. Add this to your Hermes system prompt or project instructions:

> Use Webcmd (`webcmd list`, then `webcmd --profile work session create "Work Project"` and `webcmd --profile work --session work-project-k7 browser tabs` via the `terminal` toolset) for anything on the open web: fetching, authenticated third-party sites, multi-step automation. Prefer it over `web_extract`. Use the `browser_*` tools only for the app being edited — localhost dev server, console and network triage, visual checks. Keep using `web_search` and `x_search` to find URLs.

Also check the `computer_use` toolset. It drives the whole desktop rather than a browser, so it overlaps with Webcmd whenever it is aimed at a website. Disable it if the user does not need desktop control.

**Full override (opt-in).** If the user never debugs local apps through Hermes' browser, disable the toolset outright:

```bash
hermes tools disable browser
```

Or in `~/.hermes/config.yaml`:

```yaml
agent:
  disabled_toolsets:
    - browser
```

Recommended: use `hermes tools disable browser` so the terminal toolset stays available.

Do not disable the `terminal` toolset — that is how Hermes runs `webcmd`.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in Hermes | Confirm `skills.external_dirs` includes `~/.agents/skills`, restart Hermes, and check skill discovery. |
| Hermes uses `browser_*` for open-web work | Remind it in the system prompt that Webcmd handles the open web; for a hard block, add `browser` to `agent.disabled_toolsets` and restart Hermes. |
| `web_search` missing after disabling `browser` | Unexpected — `web_search` is in the `web` toolset. Confirm `web` is still enabled with `hermes tools`. |
| Search disappeared after disabling `web` | Expected: `web_search` and `web_extract` share one toolset. Re-enable `web` and steer the agent with instructions instead. |
| `x_search` appeared on its own | Expected: it auto-registers when `XAI_API_KEY` or Grok OAuth is configured. Leave it — it is search. |
| `webcmd` not found in Hermes terminal | Confirm `webcmd` is on the host PATH that Hermes' `terminal` toolset uses; non-interactive shells may skip shell init files. |
| Browser Session idles or loses its window | Keep its immutable, Profile-scoped ID; `webcmd --profile work --session work-project-k7 browser tabs` reopens it. Start with `webcmd --profile work session create "Work Project"`; use `webcmd --profile work session list` and `webcmd --profile work session close work-project-k7` for lifecycle. Adapter commands without `--session` reuse `adapter-default`; raw browser commands require an explicit readable selector. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
