---
name: webcmd-usage
description: Use at the start of any Webcmd session — this is the top-level map of what `webcmd` can do, how to discover adapters, what flags and output formats are universal, and which specialized skill to load next. Point here when an agent asks "what can webcmd do?" or "how do I find the right command?".
allowed-tools: Bash(webcmd:*), Read
---

# webcmd-usage

Webcmd turns any website, Electron desktop app, or external CLI into a uniform `webcmd <site> <command>` surface that agents can drive without screen-scraping. This skill is the orientation layer — once you know what you want to do, load one of the specialized skills below.

## The three pillars

- **Adapter commands** — `webcmd <site> <command> [...]`. Built-in adapters live in `clis/`, user adapters in `~/.webcmd/clis/`. Each is backed by a strategy (`PUBLIC | COOKIE | INTERCEPT | UI | LOCAL`) that tells you whether a Chrome session is needed.
- **Browser driving** — `webcmd browser *` subcommands (`open`, `state`, `click`, `type`, `select`, `find`, `extract`, `network`, …) for ad-hoc interaction and scraping when no adapter covers the task. See `webcmd-browser`.
- **Cloak-tab binding** — `webcmd browser <session> bind --page <page-id>` attaches an existing webcmd-managed Cloak tab to that browser session. Run `webcmd browser <session> tab list` first; follow-up commands use `webcmd browser <session> ...`. See `webcmd-browser` before using it.
- **External CLI passthrough** — `webcmd gh`, `webcmd docker`, `webcmd vercel`, etc. Managed via `webcmd external install <name>` (auto-install from `external-clis.yaml`) or `webcmd external register <name>` (bring your own).

## Install

```bash
# npm global
npm install -g @agentrhq/webcmd          # binary: webcmd, requires Node >= 21
webcmd doctor                              # run before browser-dependent work (see below)

# From source
git clone git@github.com:agentrhq/webcmd.git
cd webcmd && npm install
npx tsx src/main.ts <command>               # same surface, no global install
```

`webcmd doctor` prints a structured `DoctorReport` — daemon status, runtime connection, version checks, and a live browser connectivity probe. Scope is narrow: it diagnoses the **browser runtime** (daemon + CloakBrowser wiring). `PUBLIC` / `LOCAL` adapters, `webcmd list`, `validate`, `verify`, plugin commands, and external-CLI passthrough don't need it to be green — only `COOKIE` / `INTERCEPT` / `UI` adapters and the `webcmd browser *` subcommands do. Flag: `-v` (verbose).

## Prerequisites by command type

| Strategy tag on `webcmd list` | What it needs |
|--------------------------------|---------------|
| `PUBLIC` | Nothing — pure HTTP, no browser. |
| `COOKIE` | Logged into the target site in the webcmd-managed CloakBrowser profile. Existing Chrome logins are not imported, so run the site's login command again. |
| `INTERCEPT` | Same as COOKIE, plus webcmd opens an automation window to capture a signed request. |
| `UI` | Same as COOKIE, full DOM interaction. |
| `LOCAL` | No browser; talks to a local/dev endpoint. |

Electron desktop apps (cursor, codex, chatwise, discord-app, doubao-app, antigravity, chatgpt-app) route through CDP against the running app — same cookie-less flow as a logged-in browser. Make sure the app is running before invoking.

## Discover what's installed — don't read this file, run a command

```bash
webcmd list                    # table, grouped by site
webcmd list -f json            # machine-readable; pipe to jq or your agent
webcmd list | grep -i twitter  # find commands for a specific site
webcmd <site> --help           # see that site's commands + flags
webcmd <site> <command> --help # see positional args and command-specific flags
```

Do not hard-code adapter lists — there are 100+ sites and the count moves every week. `webcmd list -f json` is the source of truth; it emits one entry per command with `{site, name, aliases, description, strategy, browser, args, columns, ...}`. For an agent, that is always better than grepping a doc.

Before falling back to raw `webcmd browser` commands on high-change authenticated sites, check whether a site adapter already exposes the workflow. For example, ChatGPT web has higher-level commands for conversation reads and Deep Research result extraction; discover the current surface with `webcmd chatgpt --help` or `webcmd list -f json`.

## Universal flags (work on every adapter command)

| flag | effect |
|------|--------|
| `-f, --format <fmt>` | `table` (default in TTY) · `yaml` (default in non-TTY) · `json` · `plain` · `md` · `csv`. Pass explicitly when you want a specific shape; agents almost always want `-f json`. |
| `-v, --verbose` | Debug logs + stack traces on failure; also sets `WEBCMD_VERBOSE=1` for the process. |

Command-specific flags (`--limit`, `--tab`, `--filter`, …) are not universal — consult `<site> <command> --help`.

## Output formats

- `json` — pretty-printed, 2-space indent. Default choice for agents.
- `plain` — prints a single primary field for chat-style commands (`response`/`content`/`text`/`value`). Useful for piping to another tool.
- `yaml` — fallback when output is not a TTY and `-f` is not explicit.
- `table` — color-coded, site-grouped; meant for humans.
- `md`, `csv` — straightforward tabular dumps.

A few commands override the default via `cmd.defaultFormat` (e.g. chat commands default to `plain`), so don't assume without reading `--help`.

## Environment variables

| variable | default | purpose |
|----------|---------|---------|
| `WEBCMD_BROWSER_CONNECT_TIMEOUT` | `45` | Seconds to wait for the browser bridge. |
| `WEBCMD_BROWSER_COMMAND_TIMEOUT` | `60` | Per-command timeout. |
| `WEBCMD_CDP_ENDPOINT` | — | Manual CDP endpoint override (dev / remote Chrome / Electron). |
| `WEBCMD_CACHE_DIR` | `~/.webcmd/cache` | Network capture + browser-state cache. |
| `WEBCMD_WINDOW` | command-specific | `foreground` or `background` browser window mode. |
| `WEBCMD_VERBOSE` | `false` | Verbose logging (also triggered by `-v`). |

## Self-repair

When an adapter command fails because the site changed (selectors drifted, API rotated, response schema shifted), re-run with `--trace retain-on-failure`. The error envelope includes a `trace` block pointing at `summary.md`; patch only the `adapterSourcePath` from that summary and retry. Max 3 repair rounds. The full flow is in `webcmd-autofix`.

## Writing your own adapter

Two-path storage:

- **Private**: `~/.webcmd/clis/<site>/<command>.js` — no build step, hot-available, not visible in the public package.
- **Public / PR**: `clis/<site>/<command>.js` — for upstream contribution; requires build.

Scaffolding & verification:

```bash
webcmd browser init <site>/<command>   # generates a skeleton
webcmd validate [target]               # semantic checks on the loaded registry (description, domain, pipeline step names, func|pipeline|_lazy presence, arg duplicates) — no network, no browser
webcmd verify [target] [--smoke]       # run the command with synthetic args
webcmd browser verify <site>/<command> # end-to-end smoke inside the bridge
```

Adapters import only `@agentrhq/webcmd/registry` and `@agentrhq/webcmd/errors`. `columns` must align 1:1 (in name and order) with keys of the object returned by `func`. For the full workflow see `webcmd-adapter-author`.

## Plugins

Plugins are third-party extensions pulled from git, separate from the main adapter registry:

```bash
webcmd plugin install github:user/repo    # install
webcmd plugin list [-f json]              # see installed
webcmd plugin update [name] | --all       # keep current
webcmd plugin uninstall <name>
webcmd plugin create <name>               # scaffold a new plugin
```

## External CLI passthrough

Wraps external command-line tools so you can discover + invoke them through the same `webcmd …` entrypoint:

```bash
webcmd external install gh    # auto-install via brew/apt/npm per external-clis.yaml
webcmd external register my-tool \
    --binary my-tool \
    --install "npm i -g my-tool" \
    --desc "My internal CLI"
webcmd external list
webcmd gh pr list --limit 5   # passthrough; stdio is inherited, exit code propagated
webcmd docker ps
```

Built-in entries live in `src/external-clis.yaml`; user overrides and additions in `~/.webcmd/external-clis.yaml`. Commonly shipped: `gh`, `docker`, `vercel`, `lark-cli`, `longbridge`, `dws`, `wecom-cli`, `obsidian`, `ntn`, `tg(tg-cli)`, `discord(discord-cli)`, `wx(wx-cli)`.

Some official CLIs use shell-script installers instead of a shell-free package-manager command. Entries without an `install` config, such as `ntn`, must be installed manually from their homepage before passthrough use.

## Shell completion

```bash
webcmd completion bash   # also: zsh, fish
# -> script on stdout; source or save per your shell's convention
```

## Where to go next

| If you're about to… | Load this skill |
|---------------------|-----------------|
| Drive a live browser ad-hoc (no adapter available, or prototyping) | `webcmd-browser` |
| Write a new adapter, or add a command to an existing site | `webcmd-adapter-author` |
| Fix a broken adapter after a command failure | `webcmd-autofix` |
| Route a search / lookup / research request to the right adapter | `smart-search` |

## Commands that used to exist

The following were removed in the PR #1094 consolidation — don't try to invoke them:

- `webcmd explore <url>` — superseded by `webcmd browser network` + `webcmd browser find` for live API discovery, and by the `webcmd-adapter-author` workflow for capture.
- `webcmd record <url>` — removed; manual capture now lives in `webcmd browser network --detail`.
- `webcmd web read` / `webcmd desktop *` as top-level groups — folded into their respective adapters (`webcmd web read` still exists as the `web` adapter's `read` command, but there is no standalone `web` / `desktop` top-level group command).

## Don't

- Don't paste this skill's command list into your plan; it will rot. Call `webcmd list -f json` at the start of a task instead.
- Don't assume every adapter needs a browser — strategy `PUBLIC` and `LOCAL` don't. Check the `strategy` field.
- Don't silently fall back from a failing adapter to a hand-rolled `fetch` — `--trace retain-on-failure` gives you the browser evidence and adapter source path. Do that first.
