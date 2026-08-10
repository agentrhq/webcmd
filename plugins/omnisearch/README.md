# webcmd-plugin-omnisearch

**OmniSearch** — universal web research from your terminal. One command, every public platform. No login. No browser. No credentials.

Press one command and OmniSearch sweeps across **Hacker News, Stack Overflow, GitHub, Dev.to, arXiv, Bluesky, Lobsters, and more** — then returns clean, structured JSON of what people are saying, asking, and struggling with about any topic.

Built for **developers, founders, researchers, and AI agents** who need "what does the internet think?" answered in seconds, not browser sessions.

---

## Why OmniSearch

- **Universal** — one command aggregates across many platforms, not one silo.
- **No login, ever** — all public APIs. Your credentials never touch it.
- **Structured output** — consistent camelCase JSON, ready to pipe anywhere.
- **Agent-ready** — built to feed AI agents, research pipelines, and scripts.
- **Source-filterable** — query only the platforms you care about.

---

## Install

```bash
webcmd plugin install github:Rishet11/webcmd-plugin-omnisearch
```

## Commands

| Command | Source | What it surfaces |
|---------|--------|------------------|
| `omnisearch research <topic>` | **All sources** | Aggregate everything in one feed |
| `omnisearch hackermind <query>` | Hacker News | Tech opinions & discussions |
| `omnisearch stackoverflow <q>` | Stack Overflow | Real problems developers ask |
| `omnisearch github <q>` | GitHub issues/PRs | Real problems people report |
| `omnisearch devto <tag>` | Dev.to | Developer blog opinions |
| `omnisearch arxiv <q>` | arXiv | Research papers |
| `omnisearch lobsters [--sort]` | Lobste.rs | Developer discussions |
| `omnisearch bluesky-posts <handle>` | Bluesky | What a public account is saying |

## Examples

```bash
# Research a topic across ALL sources in one shot
webcmd omnisearch research "saas pricing" --limit 20 -f json

# Filter to only certain sources
webcmd omnisearch research "rag" --sources github,hn -f json

# Find real problems people are hitting
webcmd omnisearch stackoverflow "billing saas" --limit 10 -f json
webcmd omnisearch github "saas pricing" --limit 10 -f json

# Research papers + tech opinions
webcmd omnisearch arxiv "large language models" --limit 10 -f json
webcmd omnisearch hackermind "ai agents" --limit 10 -f json

# Read what a public Bluesky account is saying
webcmd omnisearch bluesky-posts paulgraham.bsky.social --limit 10 -f json
```

## Output schema

Every command returns the same consistent shape:

```json
{
  "platform": "stackoverflow",
  "title": "Best SaaS recurring billing solution?",
  "author": "user1",
  "score": 143,
  "commentCount": 5,
  "createdAt": "2026-08-10T12:00:00Z",
  "url": "...",
  "text": ""
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `platform` | string | Source platform |
| `title` | string | Title / headline / post text |
| `author` | string | Author or handle |
| `score` | number | Upvotes / points / reactions |
| `commentCount` | number | Number of comments / answers |
| `createdAt` | string | ISO timestamp |
| `url` | string | Absolute link to the source |
| `text` | string | Body / snippet (where available) |

## Universal search is just the start

- **`research`** is the aggregator — add `--sources hn,stackoverflow,arxiv` to control which platforms to hit.
- Every adapter is a **public API** — zero setup, zero login, works in CI and headless agents.
- The shared `sources.js` module makes adding a new platform a ~20-line step.

## Development

```bash
webcmd plugin install file:///Users/rishetmehra/webcmd-omnisearch
webcmd list | grep -A12 omnisearch
webcmd validate omnisearch
```
