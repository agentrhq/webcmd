<img width="2054" height="766" alt="Group 52" src="https://github.com/user-attachments/assets/9080bdf2-55c5-4522-9137-18eeb12f417d" />

# Webcmd

<p align="center">
  <a href="https://www.npmjs.com/package/@agentrhq/webcmd">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@agentrhq/webcmd.svg?style=for-the-badge&color=1E88E5&labelColor=000000">
  </a>

  <a href="https://github.com/agentrhq/webcmd/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/npm/l/@agentrhq/webcmd.svg?style=for-the-badge&color=1E88E5&labelColor=000000">
  </a>

  <a href="https://github.com/agentrhq/webcmd/discussions">
    <img alt="Join the community on GitHub" src="https://img.shields.io/badge/Join%20the%20community-1E88E5.svg?style=for-the-badge&logo=github&labelColor=000000&logoWidth=20">
  </a>
</p>

**Teach a coding agent a website once. Get back a script it can run forever.**

Coding agents are great at driving a browser and terrible at remembering how. Every session they re-learn the same login, the same clicks, the same fragile selectors. Webcmd records a real browser task session, distills it into a durable capability graph for that app, and materializes the result as a deterministic workflow script or a standalone task CLI — so the next run is one command instead of another exploratory crawl.

> **Screen recording / demo goes here.**

```bash
npm install -g @agentrhq/webcmd
webcmd setup
```

---

## How it works

Webcmd turns one messy browser session into reusable, deterministic artifacts through five stages:

1. **Record** — open a browser session with `webcmd open`. Everything is captured to a raw **journal** (DOM snapshots, actions, and redacted network evidence) by default.
2. **Inspect** — read the journal and review captured network calls to understand what the task actually did and which requests had side effects.
3. **Distill** — collapse the journal into the app's **capability graph**: the durable, deduplicated model of what this app can do.
4. **Materialize** — emit a **workflow** (a deterministic `.mjs` replay script) or a **CLI** (a standalone package grounded in graph capabilities, shipped with its own `SKILL.md`).
5. **Run** — replay the workflow or invoke the generated CLI. Deterministic, no live exploration.

### Vocabulary

| Term | What it is |
|------|-----------|
| **Session** | A live browser run, identified by `--session <name>`. Records by default. |
| **Journal** | The raw event log of a session — snapshots, actions, network evidence. |
| **Snapshot** | A semantic capture of page state. Webcmd can diff two snapshots. |
| **Capability graph** | The distilled, durable model of an app's capabilities, built from journals. |
| **Workflow** | A deterministic `.mjs` script that replays a task. No `SKILL.md`. |
| **CLI** | A standalone package generated from graph capabilities. Ships a `SKILL.md`. |
| **Profile** | A workspace identity context under `.webcmd/profiles/<name>` — may hold auth for several apps. |
| **Authoring packet** | A planning step that decides the safe next action when creating, updating, or healing an artifact. |

---

## Quick start (golden path)

From an empty workspace to a runnable CLI:

```bash
# 1. Install skills and prepare runtime
webcmd setup

# 2. Record a task in a headed browser (this shell stays alive until close)
webcmd open "https://news.ycombinator.com" --session hn --headed

# 3. From another shell, drive and inspect the session
webcmd snapshot --session hn
webcmd click --session hn --role link --name "Learn more"
webcmd network summary --session hn

# 4. Let the authoring packet pick the safe next step
webcmd author cli --operation create \
  --task "Collect top Hacker News posts" \
  --app-id hacker-news \
  --url https://news.ycombinator.com

# 5. Materialize the CLI from a plan, then run it
webcmd cli hacker-news --plan <plan.json>
webcmd run top-posts

# 6. Done — close the session
webcmd close --session hn
```

Sessions record by default; pass `--no-record` only for ephemeral sessions.

---

## For AI agents

Webcmd is built to be driven by a coding agent (Claude Code, Cursor, and similar), not typed by hand.

**Install the skills.** `webcmd setup` installs the canonical Webcmd skills so your agent knows how to record, inspect, distill, and materialize.

```bash
webcmd setup                          # global: ~/.agents/skills/
webcmd setup --scope local            # workspace: .agents/skills/
webcmd setup --skills-root /path/to/.agents/skills
```

**Generated CLIs teach the next agent.** Every CLI Webcmd materializes ships with a `SKILL.md` whose frontmatter records command metadata, graph-capability provenance, and safe smoke tests. Install it alongside the CLI or into a shared skills root:

```bash
webcmd cli <app-id> --plan <plan.json> --install-skill
webcmd cli <app-id> --plan <plan.json> --install-skill /path/to/skills
```

Workflows never get a `SKILL.md`; CLIs always do.

**The primitives your agent drives.** Open a session, then control it from another shell:

```bash
webcmd snapshot --session default
webcmd click --session default --role link --name "Learn more"
webcmd press Enter --session default
webcmd goto "https://example.com" --session default
webcmd wait url_contains "example.com" --session default --timeout-ms 5000
webcmd close --session default
```

---

## Browser runtime

Webcmd opens a **CloakBrowser**-backed session by default:

```bash
webcmd open "https://example.com" --session default
```

Run headed when you need to watch or hand off — the command stays alive until the session closes:

```bash
webcmd open "https://example.com" --session default --headed
```

Use stock Playwright Chromium explicitly when you'd rather not use CloakBrowser (install browsers first):

```bash
npm run browsers:install
webcmd open "https://example.com" --browser chromium
```

### Profiles and identity

Named profiles are workspace identity contexts under `.webcmd/profiles/<name>`. A single profile can carry auth for more than one app. Use `default` for the normal workspace identity:

```bash
webcmd open "https://accounts.google.com" --session login --headed \
  --profile default --browser chromium --channel chrome
```

Or point at a dedicated absolute profile directory:

```bash
webcmd open "https://accounts.google.com" --session google --headed \
  --user-data-dir /absolute/dedicated/profile --browser chromium --channel chrome
```

> **Do not** point `--user-data-dir` at your daily Chrome profile while Chrome is open. Use a dedicated Webcmd profile.

Generated workflows and CLIs that initialize with `auth: true` reuse `.webcmd/profiles/default` unless the caller passes another `profile` or `userDataDir`.

### Auth-aware graphs

Validate profile state and open a headed login flow:

```bash
webcmd auth doctor linkedin --profile default
webcmd auth login linkedin --profile default --browser chromium --channel chrome
webcmd auth bind linkedin --session login
```

### Optional Camofox provider

Use Camofox when a normal Playwright browser is blocked:

```bash
webcmd open https://example.com --browser camofox --camofox-url http://localhost:3000
```

---

## Network inspection

Captured sessions write redacted request evidence to `.webcmd/sessions/<session>/network.jsonl`; reviewer marks live separately in `network.marks.json`.

```bash
webcmd network list --session default --method POST
webcmd network show n1 --session default
webcmd network summary --session default
webcmd network candidates --session default
webcmd network mark n1 --session default --mark side-effect
```

Marking side-effecting requests helps the distill step reason about which calls are safe to replay.

---

## Authoring, distilling & materializing

### Authoring packets

Use an authoring packet when the user asks to **create**, **update**, or **heal** a CLI or workflow and you need to decide whether existing graph evidence is enough.

```bash
webcmd author cli --operation create --task "Create a Hacker News CLI" --app-id hacker-news --url https://news.ycombinator.com
webcmd author cli --operation update --task "Add saved jobs" --app-id linkedin
webcmd author cli --operation heal --task "jobs search fails" --app-id linkedin --target .webcmd/exports/clis/www.linkedin.com

webcmd author workflow --operation create --task "Collect top Hacker News posts" --app-id hacker-news --url https://news.ycombinator.com
webcmd author workflow --operation update --task "Return JSON with title and URL" --app-id hacker-news
webcmd author workflow --operation heal --task "top posts workflow no longer finds titles" --app-id hacker-news --target .webcmd/exports/workflows/news.ycombinator.com/top-posts.mjs
```

The packet tells the agent which phase to run next:

| Phase | What to do |
|-------|-----------|
| `discovery` | Record browser and network evidence within the discovery budget. |
| `distill` | Distill existing recorded sessions into the graph. |
| `build` | Prepare a CLI or workflow materialization packet. |
| `repair` | Reproduce and classify the failure before patching. |

The packet only chooses the safe next step — the actual artifact always comes from `webcmd cli`, `webcmd workflow`, and `webcmd verify`.

### Materialization exports

```bash
webcmd workflow <app-id> --plan <plan.json>
webcmd workflow list
webcmd run <workflow_name>
webcmd run <domain>/<workflow_name>
webcmd run <workflow_name> --help

webcmd cli <app-id> --plan <plan.json>
webcmd cli <app-id> --plan <plan.json> --install-skill
```

- Workflows export to `~/.webcmd/exports/workflows/<domain>/<workflow-name>.mjs`.
- CLIs export to `~/.webcmd/exports/clis/<domain>/` as standalone packages grounded in graph capabilities.

---

## User handoff

Pause for a human to demonstrate a step, then resume from the user-authored journal events:

```bash
webcmd handoff --session default
# user demonstrates the workflow in the headed browser
webcmd resume --session default
```

---

## Reading a session

```bash
webcmd journal        # read an existing recorded session
webcmd run <name>     # execute an exported workflow .mjs
```

---

## Configuration reference

| Path | Purpose |
|------|---------|
| `~/.agents/skills/` | Global skills install target (`webcmd setup`). |
| `.agents/skills/` | Local/workspace skills (`webcmd setup --scope local`). |
| `.webcmd/` | Runtime state — created automatically when needed. |
| `.webcmd/profiles/<name>` | Named identity profiles (auth, storage). |
| `.webcmd/sessions/<session>/network.jsonl` | Redacted request evidence. |
| `.webcmd/sessions/<session>/network.marks.json` | Reviewer marks. |
| `~/.webcmd/exports/workflows/<domain>/` | Exported workflow `.mjs` scripts. |
| `~/.webcmd/exports/clis/<domain>/` | Exported standalone CLI packages. |

Common flags: `--session <name>`, `--profile <name>`, `--browser <cloak\|chromium\|camofox>`, `--channel chrome`, `--headed`, `--no-record`, `--user-data-dir <path>`, `--timeout-ms <n>`.

---

## Troubleshooting

- **`--user-data-dir` conflict / profile locked** — Chrome is likely open on that profile. Close Chrome or use a dedicated Webcmd profile under `.webcmd/profiles/<name>`.
- **Auth check fails** — run `webcmd auth doctor <app> --profile default`, then `webcmd auth login <app> ...` and re-bind with `webcmd auth bind <app> --session login`.
- **Browser is blocked / bot-walled** — retry with the Camofox provider: `--browser camofox --camofox-url http://localhost:3000`.
- **Stock Chromium missing** — run `npm run browsers:install` before using `--browser chromium`.
- **Session not found** — confirm the `--session` name matches the one used with `webcmd open`; headed sessions must still be alive.
- **Node errors on startup** — Webcmd requires Node >= 20. Check `node --version` and upgrade.

<!-- TODO: document output formats and exit codes here once finalized —
     both are high-value for agents/CI branching on results. -->

---

## Installation

Webcmd requires **Node >= 20**.

```bash
npm install -g @agentrhq/webcmd
webcmd --help
```

One-off usage without a global install:

```bash
npx @agentrhq/webcmd --help
```

---

## Development

```bash
npm install
npm test
npm run check
npm run build
```

---

## Contributing & releases

Release engineering (Release Please, Conventional Commits, npm Trusted Publishing, and first-publish bootstrap) is documented separately in [`CONTRIBUTING.md`](./CONTRIBUTING.md) .

In short: `fix:` → patch, `feat:` → minor, `!` or `BREAKING CHANGE:` → major. CI runs `npm ci && npm run check && npm test && npm run build && npm pack --dry-run` on every push and PR; merging the Release Please PR cuts the GitHub release and publishes to npm.

---

## License

Released under the terms in [`LICENSE`](./LICENSE).
