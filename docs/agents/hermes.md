---
title: Hermes Agent
sidebarTitle: Hermes
---

> Use Webcmd with [Hermes Agent](https://hermes-agent.nousresearch.com/docs) to replace its built-in `browser_*` stack with Webcmd's adapters and `webcmd browser` sessions.

Point Hermes at Webcmd's browser CLI to replace its native browser toolset with Webcmd's adapters and `webcmd browser` sessions. Hermes drives Webcmd through its `terminal` toolset. Adapter-first commands and compact snapshots usually use fewer tokens than Hermes' native browser tools.

## Requirements

* Node.js 20.6+ on the Hermes host
* The `webcmd` npm CLI, installed globally on the Hermes host
* Hermes `terminal` toolset enabled (needed to run `webcmd`)
* A browser runtime; confirm with `webcmd doctor` before browser work

## Install and configure

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

## Disable Hermes' built-in browser

Hermes' native browser toolset is `browser` (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, and the rest). Disable it so Hermes does not keep its native browser tools alongside Webcmd:

```bash
hermes tools disable browser
```

Or in `~/.hermes/config.yaml`:

```yaml
agent:
  disabled_toolsets:
    - browser
```

Note: Hermes' `browser` toolset statically bundles `web_search`, so disabling `browser` also removes `web_search` from every session. `web_extract` and the rest of the `web` toolset are unaffected. That is acceptable here: Webcmd's `smart-search` skill and adapters cover search, so Hermes should rely on Webcmd for browser work and search.

Do not disable the `terminal` toolset — that is how Hermes runs `webcmd`.

## Auth profiles and human handoff

Webcmd browser sessions keep signed-in state in profiles. To sign in once, run the session headed and complete login in the window yourself, then close the session; later headless runs reuse the cookies. Profile changes save only on a clean close.

For login walls or CAPTCHA during a run, stop browser writes and hand off to the user with any `handoff.viewUrl` or `Webcmd browser:` link, then verify the post-action state before retrying. Never ask for or type passwords, OTPs, cookies, credentials, or session secrets.

## Security

`webcmd browser run` executes Playwright and JavaScript in the sandboxed browser runtime. Treat the Hermes host as the trust boundary. Do not share profile directories across untrusted users.

## Troubleshooting

| Symptom | What to try |
| --- | --- |
| `webcmd doctor` is red | Fix the browser runtime first; browser commands depend on it. |
| Skills not loading in Hermes | Confirm `skills.external_dirs` includes `~/.agents/skills`, restart Hermes, and check skill discovery. |
| Hermes still uses `browser_*` tools | Confirm `agent.disabled_toolsets` includes `browser`, then restart Hermes. |
| `web_search` missing after disabling `browser` | Expected: Hermes bundles `web_search` inside the `browser` toolset. Use Webcmd's `smart-search` skill or adapters instead. |
| `webcmd` not found in Hermes terminal | Confirm `webcmd` is on the host PATH that Hermes' `terminal` toolset uses; non-interactive shells may skip shell init files. |
| Browser sessions stop working after idle | Ask the agent to open a fresh session or re-bind with `tabs` and `bind --page`. |

## See also

* [`start.md`](../../start.md) — bootstrap Webcmd end to end.
* [`webcmd-browser`](../../skills/webcmd-browser/SKILL.md) — the raw browser session surface.
* [`webcmd-usage`](../../skills/webcmd-usage/SKILL.md) — adapter-first usage rules.
