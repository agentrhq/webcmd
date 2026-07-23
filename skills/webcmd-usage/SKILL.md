---
name: webcmd-usage
description: Use at the start of any Webcmd session. This is the top-level map of what `webcmd` can do, how to discover adapters, what flags and output formats are universal, and which specialized skill to load next. Point here when an agent asks "what can webcmd do?" or "how do I find the right command?".
allowed-tools: Bash(webcmd:*), Read
---

# webcmd-usage

Webcmd turns websites, Electron desktop apps, and external CLIs into a uniform `webcmd <site> <command>` surface that agents can drive without screen scraping. This skill is the orientation layer. Once you know the task, load the specialized skill that fits it.

## The Three Pillars

- **Adapter commands:** `webcmd <site> <command> [...]`. Built-in adapters live in `clis/`; community adapters promoted to the main repo live as plugins under `plugins/`; private iteration adapters live in `~/.webcmd/clis/`. Each command has a strategy such as `PUBLIC`, `COOKIE`, `INTERCEPT`, `UI`, or `LOCAL`.
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

## Discover Commands

Run commands instead of reading static docs:

```bash
webcmd
webcmd <site> --help
webcmd <site> <command> --help
```

Run `webcmd` with no arguments to see all available functions and installed site adapters. Do not hard-code adapter lists: `webcmd list -f json` is the source of truth for installed commands and emits one entry per command with fields such as `{site, name, aliases, description, strategy, browser, args, columns}`.

Large registries can exceed an agent or tool output budget. Filter the JSON stream before it is emitted, using broad literal terms derived from the whole requested workflow:

```bash
WORKFLOW_TERMS='["requested action", "output field", "named site"]'
webcmd list -f json | jq --argjson terms "$WORKFLOW_TERMS" '
  [.[] | select(
    ([.site, .name, .description, ((.columns // []) | join(" "))]
      | map(. // "") | join(" ") | ascii_downcase) as $text
    | any($terms[]; . as $term | $text | contains($term | ascii_downcase))
  )]
'
```

Replace `WORKFLOW_TERMS` with terms from the current request: the requested action, entity, output fields, and any explicitly named site. Literal matching avoids regex errors from terms such as `C++` or `[foo]`. Do not maintain a site or category allowlist. Match across `site`, `name`, `description`, and `columns`. If any layer reports truncated output, the inspection is incomplete. Narrow the filter and inspect again. Never treat absence from truncated output as proof that an adapter or plugin is missing, and do not proceed to the next fallback stage from that evidence.

Use this fallback order:

1. Run `webcmd list -f json` through a workflow-derived filter before returning its output to the agent.
2. Check the complete, non-truncated filtered result against the whole requested workflow. If one installed command covers it, use that command and stop discovery. If candidates do not cover the missing capability, refine the capability filter until its complete result is exactly `[]`.
3. Only after that complete filtered result is `[]`, derive a short plugin query from the missing site or capability and run `webcmd plugin search <query> -f json`. Preserve the user's term when practical: `find flights` becomes `flight`.
4. If the complete, non-truncated plugin search returns a match, offer `webcmd plugin install <installSource>`. Only if that complete result returns no match and no error is raw `webcmd browser` allowed. Both plugin search and raw browser fallback require the prior complete filtered registry result to be `[]`. A truncated plugin result is incomplete evidence: refine the query or output before fallback. If plugin search errors, report plugin discovery as unavailable and stop. If `fetch failed` appears in `errors[].message`, report plugin discovery as unavailable due to network/reachability and ask the user whether to rerun with network/escalated permissions. Do not retry unless they approve.

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

## Authentication and Human Handoff

`AUTH_REQUIRED` is not an adapter failure. Run `webcmd <site> login`, return its `action_required` instructions and `verify_command` (normally `webcmd <site> whoami`) to the user, then wait for the user to report done in the visible browser. Run the returned `verify_command`; verification must succeed before retrying the original command. If the site has no login command, ask the user to sign in in the current Webcmd browser; after they report done, take fresh browser state and use an available identity check or verify the intended post-action state before retrying. Their report alone is not verification. Never request, type, echo, store, or automate passwords, OTPs, recovery codes, cookies, or session secrets; CAPTCHA stops automation and follows the same conditional verification rule.

## Report A Webcmd Defect

After a reproducible Webcmd failure has been diagnosed or the `webcmd-autofix`
retry budget is exhausted, load `webcmd-autofix` and follow its Step 6 reporting
flow. Do not report expected authentication, configuration, CAPTCHA, rate-limit,
argument, transient, or unreproduced failures.

## Writing An Adapter

Storage paths:

- Private: `~/.webcmd/clis/<site>/<command>.js`
- Public (official bundle): `clis/<site>/<command>.js`
- Public (community PRs): `plugins/<site>/` plus root `webcmd-plugin.json` registration

The main Webcmd repo is itself a plugin monorepo: promoted community CLIs belong under `plugins/<site>/` and must be registered in the root `webcmd-plugin.json`.

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
webcmd plugin search [query] -f json
webcmd plugin catalog list -f json
webcmd plugin catalog add <source>
webcmd plugin catalog remove <id>
```

Plugins are installable extensions pulled from git or local paths. Use `plugin search` for marketplace discovery and `plugin list` for already-installed plugins. Main-repo community CLIs are exposed through the root plugin catalog manifest, not bundled into npm's `clis/` set.

> **Note:** The repository's `plugins/` directory is not shipped in the npm package. Find the required plugin with `webcmd plugin search`, then install its `installSource` with `webcmd plugin install <installSource>`.

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

- Do not paste static command lists into plans; query `webcmd list -f json` through a workflow-derived filter.
- Do not emit a large unfiltered registry into a bounded output or infer absence from a truncation warning; filter at the source and narrow until the result is complete.
- Do not assume every adapter needs a browser; check `strategy`.
- Do not silently fall back from a failing adapter to hand-rolled `fetch`; use `--trace retain-on-failure` first.
