<img width="2054" height="766" alt="Webcmd banner" src="https://github.com/user-attachments/assets/3e5b9702-5ffd-43bd-ab1b-2319a8cc0e2a" />

<p align="center">
  <a href="https://www.npmjs.com/package/@agentrhq/webcmd">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@agentrhq/webcmd.svg?style=for-the-badge&color=1E88E5&labelColor=000000">
  </a>
  <a href="https://www.npmjs.com/package/@agentrhq/webcmd">
    <img alt="NPM downloads" src="https://img.shields.io/npm/dt/@agentrhq/webcmd.svg?style=for-the-badge&color=1E88E5&labelColor=000000">
  </a>
  <a href="https://github.com/agentrhq/webcmd/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-1E88E5.svg?style=for-the-badge&labelColor=000000">
  </a>
  <a href="https://discord.gg/9YP2C9tvMp">
    <img alt="Join the community on Discord" src="https://img.shields.io/badge/Join%20the%20community-7C3AED.svg?style=for-the-badge&logo=discord&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
  <a href="https://x.com/agentrhq">
    <img alt="Follow AgentR on X" src="https://img.shields.io/badge/Built%20by%20%40agentrhq-000000.svg?style=for-the-badge&logo=x&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
</p>

# Webcmd

**Self-learning browser infra for AI agents.**

WebCMD learns the navigational context of websites as agents use them, then compiles that knowledge into deterministic commands for faster, cheaper, more reliable browser automation. The goal is simple: stop making agents rediscover the same sites on every run and cut browser-agent token spend by up to 90%.

On top of live browser control, WebCMD adds 3 layers of learnings. Each layer collapses cost and variance for the layer above it.

| Layer | Scenario | What Webcmd Helps With |
| --- | --- | --- |
| 1. Live browser control | The site is unfamiliar. | Use `webcmd browser` to inspect, click, type, extract, capture network calls, and complete the task in a real browser. |
| 2. Sitemap memory | The site is familiar, but the action space is not fully known. | Capture an agent-facing sitemap of observed pages, states, actions, workflows, APIs, pitfalls, and fallback paths. |
| 3. CLI authoring | The action space is known, but the path is still too variable for one fixed sequence. | Explicitly author a reusable `webcmd <site>` adapter with structured output, so future agents spend tokens on the task instead of navigation. |
| 4. Extend existing CLIs | The workflow is deterministic enough to stop browsing. | Extend the `webcmd <site>` adapter with a tailored command so the workflow runs instantly with the least amount of tokens. |


## Quick Start

### 1. Install Webcmd

Webcmd requires **Node.js >= 20**.

```bash
node --version
npm install -g @agentrhq/webcmd
```

### 2. Verify the browser runtime

```bash
webcmd doctor
```

`doctor` checks the Webcmd browser bridge: daemon status, browser runtime installation, profile selection, and a live connectivity probe. Pure public adapters and local passthrough commands do not need a green browser check, but `COOKIE`, `INTERCEPT`, `UI`, and `webcmd browser` workflows do.

### 3. Discover commands

```bash
webcmd list
webcmd list -f json
webcmd reddit --help
webcmd reddit hot --help
```

`webcmd list -f json` is the source of truth for agents. It emits one row per command with the site, command name, arguments, output columns, browser requirement, and strategy.

### 4. Run your first command

```bash
webcmd hackernews top --limit 5
webcmd reddit popular --limit 5
webcmd pubmed search "agentic browser automation" --limit 5 -f json
```

## For Humans

Use Webcmd directly when you want a reliable command instead of a live browser session:

```bash
webcmd list
webcmd <site> --help
webcmd <site> <command> --help
webcmd <site> <command> -f yaml
```

The everyday surface is intentionally small:

- `webcmd list` shows every registered adapter and external command.
- `webcmd <site> <command> ...` runs a built-in, plugin, or private adapter.

For example:

```bash
webcmd hackernews top --limit 10
webcmd reddit subreddit programming --limit 10
webcmd twitter whoami
```

Adapter commands are tagged by strategy:

| Strategy | What it means |
|----------|---------------|
| `PUBLIC` | No browser or login. Webcmd can call a public endpoint or page directly. |
| `COOKIE` | Uses the logged-in Webcmd browser profile for authenticated reads. |
| `INTERCEPT` | Uses the browser to capture a signed or stateful request before replaying it. |
| `UI` | Drives the page UI directly. |
| `LOCAL` | Talks to a local app, service, or CLI surface. |

Output formats are consistent across adapters:

```bash
webcmd hackernews top -f table
webcmd hackernews top -f json
webcmd hackernews top -f yaml
webcmd hackernews top -f md
webcmd hackernews top -f csv
```

Agents usually want `-f json`; humans usually want table (default) or yaml.

## For AI Agents

Webcmd is designed to be driven by coding agents such as Codex, Claude Code, Cursor, and similar tools.

## Install skills (also refreshes existing installs)

Install Webcmd skills into your agent environment:

```bash
webcmd skills install
```

The installer asks whether to install globally or locally, then asks for the coding agent (`agents`, `codex`, `claude`) or a custom skills path. For scripts, pass flags such as `--scope project --provider codex` or `--path ./my-skills`.

### Which skill to use

| Skill | When to use |
|-------|-------------|
| [`webcmd-usage`](./skills/webcmd-usage/SKILL.md) | Orient an agent to Webcmd commands, formats, strategies, plugins, and external CLIs. |
| [`webcmd-browser`](./skills/webcmd-browser/SKILL.md) | Drive a real browser ad hoc: inspect, click, type, extract, network, tabs, waits. |
| [`webcmd-adapter-author`](./skills/webcmd-adapter-author/SKILL.md) | Write or extend a reusable site adapter. |
| [`webcmd-autofix`](./skills/webcmd-autofix/SKILL.md) | Repair an adapter after selectors, APIs, or response shapes drift. |
| [`webcmd-browser-sitemap`](./skills/webcmd-browser-sitemap/SKILL.md) | Use recorded site knowledge while driving a browser task. |
| [`webcmd-sitemap-author`](./skills/webcmd-sitemap-author/SKILL.md) | Capture or update reusable sitemap knowledge for future agents. |
| [`smart-search`](./skills/smart-search/SKILL.md) | Route search and research requests to the right adapter. |

The common agent workflow is:

```bash
webcmd list -f json
webcmd <site> <command> -f json
webcmd <site> <command> --trace retain-on-failure -f json
```

Start with adapters. Fall back to `webcmd browser` only when no adapter covers the task or you are teaching Webcmd a new site flow.

## Live Browser Interaction

`webcmd browser` gives agents a stable, structured interface to a real browser. Every command takes a session name immediately after `browser` — the session is required, so `webcmd browser tab list` without one is an error:

```bash
webcmd browser <session> open https://example.com
```

### Tabs and page IDs

`webcmd browser work open <url>` and `webcmd browser work tab new [url]` both return a page ID in the `page` field:

```bash
$ webcmd browser work open https://reddit.com
{
  "url": "https://reddit.com",
  "page": "page-1783484232033-8"
}
```

Use `webcmd browser work tab list` to inspect all tabs — each entry carries its page ID (`id`/`page`), the owning `session` (adapter sessions appear as `site:<name>`), and whether it is the currently `selected` tab. Pass `--tab <pageId>` to route a single command to a specific tab:

```bash
webcmd browser work open https://example.com --tab page-1783484232033-8
```

`tab new` creates a tab without changing the session's default tab; only `tab select <pageId>` promotes a tab to the default for later untargeted commands in the same session.

Useful browser primitives include:

| Area | Commands |
|------|----------|
| Navigation | `open`, `back`, `wait`, `scroll`, `close` |
| Inspection | `state`, `find`, `get`, `frames`, `screenshot`, `extract` |
| Interaction | `click`, `type`, `fill`, `select`, `keys`, `hover`, `focus`, `check`, `uncheck`, `upload`, `drag` |
| Network | `network`, `network --detail <key>`, `network --filter <fields>` |
| Tabs | `tab list`, `tab new`, `tab select`, `tab close`, `bind`, `unbind` |
| Adapter work | `init`, `verify`, `analyze` |

Every interaction command returns structured data: match count, target identity, confidence level, and machine-readable errors. That contract is why agents can recover from mild DOM drift instead of guessing.

### Profiles

Named profiles let Webcmd keep separate browser identities:

```bash
webcmd profile list
webcmd profile rename <context-id> work
webcmd profile use work
webcmd --profile work browser work state
```

If multiple browser profiles are connected and no default is selected, Webcmd asks you to choose rather than guessing.

## Built-in Commands

Webcmd ships a large adapter registry. The list changes over time, so use `webcmd list -f json` for the current surface. Highlights include:

| Site/App | Example commands |
|----------|------------------|
| `hackernews` | `top`, `new`, `best`, `ask`, `show`, `jobs`, `search`, `read`, `user` |
| `reddit` | `hot`, `popular`, `search`, `subreddit`, `read`, `user`, `comment`, `save`, `upvote`, `subscribe` |
| `linkedin` | `search`, `people-search`, `jobs-preferences`, `job-detail`, `profile-read`, `posts`, `inbox`, `safe-send` |
| `twitter` | `trending`, `search`, `timeline`, `tweets`, `post`, `profile`, `bookmarks`, `notifications`, `follow`, `unfollow` |
| `tiktok` | `search`, `explore`, `user`, `creator-videos`, `notifications`, `follow`, `comment`, `like`, `save` |
| `amazon` | `search`, `product`, `offer`, `bestsellers`, `new-releases`, `movers-shakers`, `discussion` |
| `pubmed` | `search`, `article`, `author`, `citations`, `clinical-trial`, `journal`, `mesh`, `related`, `review` |
| `chatgpt` | `ask`, `send`, `new`, `read`, `history`, `detail`, `image`, `deep-research-result`, `model` |
| `claude` | `ask`, `send`, `new`, `read`, `history`, `detail`, `status` |
| `gemini` | `ask`, `new`, `image`, `deep-research`, `deep-research-result`, `models` |
| `notebooklm` | `list`, `open`, `summary`, `source-list`, `source-get`, `source-fulltext`, `generate-audio`, `generate-slides` |

Current registry size is generated from [`cli-manifest.json`](./cli-manifest.json); this README intentionally lists highlights, not a frozen catalog.

## External CLI Hub

Webcmd can expose existing command-line tools through the same discovery and invocation surface:

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

Built-in external entries include common tools such as `gh`, `docker`, `vercel`, `wrangler`, `obsidian`, `longbridge`, `ntn`, `tg`, `discord`, and `wx`. User overrides live in `~/.webcmd/external-clis.yaml`.

## Plugins

Plugins let you install third-party adapter packs without patching the core registry:

```bash
webcmd plugin install github:user/repo
webcmd plugin list -f json
webcmd plugin update --all
webcmd plugin uninstall <name>
webcmd plugin create <name>
```

Use plugins for private company workflows, community adapters, or experiments that are not ready for the built-in registry.

## Writing Adapters

When a site is not covered yet, author a reusable adapter instead of leaving an agent to spend tokens clicking through the same browser flow every time.

```bash
webcmd browser init <site>/<command>
webcmd validate <site>/<command>
webcmd verify <site>/<command> --smoke
webcmd browser work verify <site>/<command>
```

Adapter files import the public Webcmd registry/error APIs:

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
```

Private adapters can live in `~/.webcmd/clis/<site>/<command>.js`; upstream adapters live in [`clis/`](./clis/). For the full authoring workflow, install and use [`webcmd-adapter-author`](./skills/webcmd-adapter-author/SKILL.md).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBCMD_PROFILE` | none | Browser runtime profile alias/context ID to use when multiple profiles are available. |
| `WEBCMD_WINDOW` | command-specific | `foreground` or `background` browser window mode. |
| `WEBCMD_BROWSER_CONNECT_TIMEOUT` | `45` | Seconds to wait for the browser bridge. |
| `WEBCMD_BROWSER_COMMAND_TIMEOUT` | `60` | Seconds to wait for one browser command. |
| `WEBCMD_CDP_ENDPOINT` | none | Manual CDP endpoint for remote browsers or Electron apps. |
| `WEBCMD_CDP_TARGET` | none | Filter CDP targets by URL substring. |
| `WEBCMD_CACHE_DIR` | `~/.webcmd/cache` | Browser state and network capture cache. |
| `WEBCMD_VERBOSE` | `false` | Enable verbose logs. Also enabled by `-v`. |

Common paths:

| Path | Purpose |
|------|---------|
| `~/.webcmd/` | User-level Webcmd state. |
| `~/.webcmd/clis/` | Private adapters. |
| `~/.webcmd/cache/browser-network/` | Cached browser network captures. |
| `~/.webcmd/external-clis.yaml` | User external CLI registry entries. |
| `~/.agents/skills/` | Common global skills install target for agent skill managers. |
| `.agents/skills/` | Common workspace-local skills install target. |

## Troubleshooting

- **Browser bridge is unavailable**: run `webcmd doctor -v` and follow the daemon/profile/runtime hint it prints.
- **Multiple profiles are connected**: run `webcmd profile list`, then `webcmd profile use <name>` or pass `--profile <name>`.
- **Authenticated adapter returns empty or unauthorized**: log into the target site in the Webcmd-managed browser profile, then retry.
- **A site changed and an adapter fails**: rerun with `--trace retain-on-failure -f json`, inspect the trace summary, and use `webcmd-autofix`.
- **A browser target is stale**: run `webcmd browser <session> state` again and use the fresh numeric ref or locator.
- **Node errors on startup**: Webcmd requires Node.js >= 20. Check `node --version`.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Release engineering, Conventional Commits, CI, and npm publishing notes live in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Released under the terms in [`LICENSE`](./LICENSE).
