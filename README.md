<img width="2054" height="766" alt="Webcmd banner" src="https://github.com/user-attachments/assets/3e5b9702-5ffd-43bd-ab1b-2319a8cc0e2a" />

# Webcmd

<p align="center">
  <a href="https://www.npmjs.com/package/@agentrhq/webcmd">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@agentrhq/webcmd.svg?style=for-the-badge&color=1E88E5&labelColor=000000">
  </a>
  <a href="https://github.com/agentrhq/webcmd/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-1E88E5.svg?style=for-the-badge&labelColor=000000">
  </a>
  <a href="https://github.com/agentrhq/webcmd/discussions">
    <img alt="Join the community on GitHub" src="https://img.shields.io/badge/Join%20the%20community-1E88E5.svg?style=for-the-badge&logo=github&labelColor=000000&logoWidth=20">
  </a>
</p>

**Turn websites, browser sessions, desktop apps, and local tools into deterministic command-line surfaces for people and AI agents.**

Webcmd gives you one command surface for three kinds of automation:

- **Use built-in adapters** for sites like Reddit, Hacker News, LinkedIn, Twitter/X, TikTok, Amazon, PubMed, ChatGPT, Claude, Gemini, NotebookLM, and many more.
- **Let AI agents operate a real browser** with `webcmd browser <session> ...` primitives: open pages, inspect DOM snapshots, click, type, select, extract, capture network calls, and verify flows.
- **Wrap local tools and desktop apps** so agents can discover and invoke `gh`, `docker`, `vercel`, Electron apps, and other command surfaces through the same `webcmd ...` entrypoint.

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

`doctor` checks the Webcmd browser bridge: daemon status, runtime wiring, profile selection, and a live connectivity probe. Pure public adapters and local passthrough commands do not need a green browser check, but `COOKIE`, `INTERCEPT`, `UI`, and `webcmd browser` workflows do.

### 3. Discover commands

```bash
webcmd list
webcmd list -f json
webcmd reddit --help
webcmd reddit hot --help
```

`webcmd list -f json` is the source of truth for agents. It emits one row per command with the site, command name, arguments, output columns, browser requirement, and strategy.

### 4. Run your first adapters

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
webcmd <site> <command> -f json
```

The everyday surface is intentionally small:

- `webcmd list` shows every registered adapter and external command.
- `webcmd <site> <command> ...` runs a built-in, plugin, or private adapter.
- `webcmd external register <name>` exposes a local CLI through the same discovery surface.
- `webcmd doctor` diagnoses browser connectivity for authenticated or UI-driven commands.

For example:

```bash
webcmd hackernews top --limit 10
webcmd reddit subreddit programming --limit 10
webcmd github whoami
webcmd gh pr list --limit 5
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

Agents usually want `-f json`; humans usually want the default table.

## For AI Agents

Webcmd is designed to be driven by coding agents such as Codex, Claude Code, Cursor, and similar tools.

Install Webcmd skills into the agent environment with your agent's skill manager:

```bash
npx skills add agentrhq/webcmd
```

Or install/copy only the skills you need from [`skills/`](./skills/) into your agent's skills root. These skills teach agents when to use adapters, when to drive the browser, how to author new adapters, and how to repair failing commands.

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

Start with adapters. Fall back to `webcmd browser` only when no adapter covers the task or you are debugging/building one.

## Browser Automation

`webcmd browser` gives agents a stable, structured interface to a real browser. Commands use a session name immediately after `browser`:

```bash
webcmd browser work open https://example.com
webcmd browser work state
webcmd browser work click --role link --name "Learn more"
webcmd browser work type --role textbox --name Email "you@example.com"
webcmd browser work keys Enter
webcmd browser work extract
webcmd browser work close
```

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

When a site is not covered yet, author a reusable adapter instead of leaving an agent to click through the same browser flow every time.

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
