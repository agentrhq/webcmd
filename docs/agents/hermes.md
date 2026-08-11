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

Hermes then reads `webcmd-usage` and `webcmd-browser` as skills. Restart Hermes after changing config and confirm the skills are discoverable.

### Override default tools

Hermes' native browser toolset is `browser` (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, and the rest). It is a full browser stack wired into Hermes' dev loop, so the default is to route rather than disable — see [the routing rule](../../start.md#the-routing-rule).

Add this to your Hermes system prompt or project instructions:

> Use Webcmd (`webcmd list`, `webcmd browser <session> ...` via the `terminal` toolset) for anything on the open web: research, fetching, authenticated third-party sites, multi-step automation. Use the `browser_*` tools only for the app being edited — localhost dev server, console and network triage, visual checks.

**Full override (opt-in).** If you never debug local apps through Hermes' browser, disable the toolset outright:

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

Note: Hermes' `browser` toolset statically bundles `web_search`, so disabling `browser` also removes `web_search` from every session. `web_extract` and the rest of the `web` toolset are unaffected. That is acceptable — Webcmd's `smart-search` skill and adapters cover search.

Do not disable the `terminal` toolset — that is how Hermes runs `webcmd`.

### Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in Hermes | Confirm `skills.external_dirs` includes `~/.agents/skills`, restart Hermes, and check skill discovery. |
| Hermes uses `browser_*` for open-web work | Restate the routing rule in the system prompt; for a hard block, add `browser` to `agent.disabled_toolsets` and restart Hermes. |
| `web_search` missing after disabling `browser` | Expected: Hermes bundles `web_search` inside the `browser` toolset. Use Webcmd's `smart-search` skill or adapters instead. |
| `webcmd` not found in Hermes terminal | Confirm `webcmd` is on the host PATH that Hermes' `terminal` toolset uses; non-interactive shells may skip shell init files. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — common setup, [auth profiles and human handoff](../../start.md#auth-profiles-and-human-handoff), and [security](../../start.md#security).
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
