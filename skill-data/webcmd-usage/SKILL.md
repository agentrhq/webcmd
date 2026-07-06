---
name: webcmd-usage
description: Use at the start of any Webcmd session. This is the top-level map of what `webcmd` can do, how to discover adapters, what flags and output formats are universal, and which specialized skill to load next. Point here when an agent asks "what can webcmd do?" or "how do I find the right command?".
allowed-tools: Bash(webcmd:*), Read
---

# webcmd-usage

Webcmd turns websites, Electron desktop apps, and external CLIs into a uniform `webcmd <site> <command>` surface that agents can drive without screen scraping. This skill is the orientation layer. Once you know the task, load the specialized skill that fits it.

## The Three Pillars

- **Adapter commands:** `webcmd <site> <command> [...]`. Built-in adapters live in `clis/`; user adapters live in `~/.webcmd/clis/`. Each command has a strategy such as `PUBLIC`, `COOKIE`, `INTERCEPT`, `UI`, or `LOCAL`.
- **Browser driving:** `webcmd browser *` subcommands (`open`, `state`, `click`, `type`, `select`, `find`, `extract`, `network`) for ad-hoc interaction when no adapter covers the task. See `webcmd-browser`.
- **External CLI passthrough:** `webcmd gh`, `webcmd docker`, `webcmd vercel`, and similar wrappers. Manage them with `webcmd external install <name>` or `webcmd external register <name>`.

## Install

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
```

From source:

```bash
git clone git@github.com:agentrhq/webcmd.git
cd webcmd
npm install
npx tsx src/main.ts <command>
```

`webcmd doctor` reports daemon status, runtime connection, version checks, and live browser connectivity. It is required for `COOKIE`, `INTERCEPT`, `UI`, and `webcmd browser *` work. It is not required for `PUBLIC`, `LOCAL`, `webcmd list`, `validate`, `verify`, plugin commands, or external CLI passthrough.

## Prerequisites By Strategy

| Strategy | Needs |
| --- | --- |
| `PUBLIC` | No browser; pure HTTP. |
| `COOKIE` | Logged into the target site in the webcmd-managed browser profile. |
| `INTERCEPT` | Same as `COOKIE`, plus an automation window to capture a signed request. |
| `UI` | Same as `COOKIE`, plus full DOM interaction. |
| `LOCAL` | No browser; talks to a local or development endpoint. |

Electron desktop app adapters route through CDP against the running app. Make sure the app is open before invoking those commands.

## Discover Installed Commands

Run commands instead of reading static docs:

```bash
webcmd list
webcmd list -f json
webcmd list | grep -i github
webcmd <site> --help
webcmd <site> <command> --help
```

Do not hard-code adapter lists. `webcmd list -f json` is the source of truth and emits one entry per command with fields such as `{site, name, aliases, description, strategy, browser, args, columns}`.

Before falling back to raw `webcmd browser` on high-change authenticated sites, check whether a site adapter already exposes the workflow.

## Universal Flags

| Flag | Effect |
| --- | --- |
| `-f, --format <fmt>` | `table` in TTY by default; `yaml` outside TTY by default; also supports `json`, `plain`, `md`, `csv`. Agents usually want `-f json`. |
| `-v, --verbose` | Debug logs and stack traces on failure; also sets `WEBCMD_VERBOSE=1`. |

Command-specific flags such as `--limit`, `--tab`, and `--filter` are not universal. Read `<site> <command> --help`.

## Output Formats

- `json`: pretty-printed, 2-space indent. Best default for agents.
- `plain`: prints the primary text field for chat-style commands.
- `yaml`: default when output is not a TTY and `-f` is not explicit.
- `table`: color-coded and grouped for humans.
- `md`, `csv`: tabular dumps.

Some commands override the default through `cmd.defaultFormat`; read `--help`.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBCMD_BROWSER_CONNECT_TIMEOUT` | `45` | Seconds to wait for the browser bridge. |
| `WEBCMD_BROWSER_COMMAND_TIMEOUT` | `60` | Per-command timeout. |
| `WEBCMD_CDP_ENDPOINT` | unset | Manual CDP endpoint override. |
| `WEBCMD_CACHE_DIR` | `~/.webcmd/cache` | Network capture and browser-state cache. |
| `WEBCMD_WINDOW` | command-specific | `foreground` or `background` browser window mode. |
| `WEBCMD_VERBOSE` | `false` | Verbose logging, also triggered by `-v`. |

## Self-Repair

When an adapter command fails because a site changed, rerun with:

```bash
webcmd <site> <command> [args...] --trace retain-on-failure
```

The error envelope includes a `trace` block pointing at `summary.md`. Patch only `adapterSourcePath` from that summary and retry. Maximum 3 repair rounds. See `webcmd-autofix`.

## Writing An Adapter

Two storage paths:

- Private: `~/.webcmd/clis/<site>/<command>.js`
- Public / PR: `clis/<site>/<command>.js`

Scaffolding and checks:

```bash
webcmd browser init <site>/<command>
webcmd validate [target]
webcmd verify [target] [--smoke]
webcmd browser verify <site>/<command>
```

Adapters import only `@agentrhq/webcmd/registry` and `@agentrhq/webcmd/errors`. `columns` must align one-to-one, in name and order, with returned row object keys. See `webcmd-adapter-author`.

## Plugins

```bash
webcmd plugin install github:user/repo
webcmd plugin list [-f json]
webcmd plugin update [name] | --all
webcmd plugin uninstall <name>
webcmd plugin create <name>
```

Plugins are third-party extensions pulled from git and separate from the main adapter registry.

## External CLI Passthrough

```bash
webcmd external install gh
webcmd external register my-tool \
  --binary my-tool \
  --install "npm i -g my-tool" \
  --desc "My internal CLI"
webcmd external list
webcmd gh pr list --limit 5
webcmd docker ps
```

Built-in entries live in `src/external-clis.yaml`; user overrides live in `~/.webcmd/external-clis.yaml`.

## Shell Completion

```bash
webcmd completion bash
webcmd completion zsh
webcmd completion fish
```

The script prints to stdout; source or save it according to your shell.

## Where To Go Next

| Task | Load |
| --- | --- |
| Drive a live browser ad-hoc | `webcmd-browser` |
| Write a new adapter or command | `webcmd-adapter-author` |
| Fix a broken adapter after failure | `webcmd-autofix` |
| Route a search or research request | `smart-search` |

## Removed Commands

Do not invoke these removed commands:

- `webcmd explore <url>`: use `webcmd browser network` and `webcmd browser find`, or the `webcmd-adapter-author` workflow.
- `webcmd record <url>`: manual capture now lives in `webcmd browser network --detail`.
- Top-level `webcmd web read` / `webcmd desktop *` groups: use their adapters instead.

## Do Not

- Do not paste static command lists into plans; call `webcmd list -f json`.
- Do not assume every adapter needs a browser; check `strategy`.
- Do not silently fall back from a failing adapter to hand-rolled `fetch`; use `--trace retain-on-failure` first.
