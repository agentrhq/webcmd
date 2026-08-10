# webcmd-plugin-omnisearch

**OmniSearch — the developer internet, in one command.**

Stop opening seven tabs to ask "what does the community think?" Run one command and OmniSearch sweeps **Hacker News, Lobste.rs, Stack Overflow, GitHub issues, arXiv, Dev.to, and Bluesky** — then returns clean JSON of what people are building, asking, breaking, and debating, **ranked by score**. No login, no browser, no API keys.

Ask "who already hit this wall?" the way you'd ask a search engine — and get a verdict, not a link dump.

---

## Why OmniSearch

- **Community signal, not search noise** — normalized results with `score` + `commentCount` so you rank by real traction.
- **No login, ever** — all public APIs. Zero setup, zero credentials, works in CI and headless agents.
- **Structured, consistent JSON** — same schema across every source.
- **Multi-source in one command** — `research` aggregates everything; filter with `--sources`.
- **Agent-native** — built to be driven by Claude, Codex, GPT, Cursor, or your own agent.

OmniSearch is **not a crawler**. Firecrawl renders a URL you give it; OmniSearch is the "where do I even start" layer — a curated set of trusted platform-native communities, pre-ranked by traction.

---

## Install

```bash
webcmd plugin install github:Rishet11/webcmd-plugin-omnisearch
```

## Commands (Tier 1 — public, no login)

| Command | Source | What it surfaces |
|---------|--------|------------------|
| `omnisearch verdict <topic>` | **All sources** | 🏆 The community's verdict, synthesized |
| `omnisearch research <topic>` | **All sources** | Aggregate everything in one feed |
| `omnisearch hackermind <query>` | Hacker News | Tech opinions & discussions |
| `omnisearch stackoverflow <q>` | Stack Overflow | Real problems developers ask |
| `omnisearch github <q>` | GitHub issues/PRs | Real problems people report |
| `omnisearch devto <tag>` | Dev.to | Developer articles (takes a TAG, not free text) |
| `omnisearch arxiv <q>` | arXiv | Research papers |
| `omnisearch lobsters [--sort]` | Lobste.rs | Developer discussions |
| `omnisearch bluesky-posts <handle>` | Bluesky | What one public account is saying |

### Examples

```bash
# Research a topic across ALL sources in one shot
webcmd omnisearch research "saas pricing" --limit 20 -f json

# Get the community's verdict (signal, not search)
webcmd omnisearch verdict "saas pricing" -f json

# Filter to specific sources
webcmd omnisearch research "rag" --sources github,hn -f json

# Find real problems people are hitting
webcmd omnisearch stackoverflow "billing saas" --limit 10 -f json
webcmd omnisearch github "saas pricing" --limit 10 -f json

# Research papers + tech opinions
webcmd omnisearch arxiv "large language models" --limit 10 -f json
webcmd omnisearch hackermind "ai agents" --limit 10 -f json
```

### Output schema (uniform)

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
| `commentCount` | number | Comments / answers |
| `createdAt` | string | ISO timestamp |
| `url` | string | Absolute link |
| `text` | string | Snippet (may be empty on HN/SO; truncated on GitHub/arXiv) |

---

## Commands (Tier 2 — logged-in social, via webcmd `social` profile)

For the login-walled platforms (X/Twitter, Reddit, LinkedIn, Instagram, YouTube),
install the official webcmd plugins once and sign in once through the `social`
browser profile. Then research those platforms headlessly too.

```bash
webcmd plugin install github:agentrhq/webcmd/twitter
webcmd plugin install github:agentrhq/webcmd/reddit
webcmd plugin install github:agentrhq/webcmd/linkedin
webcmd plugin install github:agentrhq/webcmd/instagram

# One-time sign-in per site (opens a browser; completes in ~1 min)
webcmd --profile social twitter login
webcmd --profile social reddit login

# Headless research on login-walled platforms
webcmd --profile social twitter search "saas pricing" -f json
webcmd --profile social reddit search "saas pricing" -f json
webcmd --profile social reddit subreddit startups -f json
webcmd --profile social linkedin people-search "saas founder" -f json
webcmd --profile social instagram search "saas" -f json
```

> Tier 2 is **optional** and machine-specific — it needs your own logged-in profile.
> Tier 1 (OmniSearch's own commands) works for everyone, everywhere, with no login.

---

## Using OmniSearch with an AI agent (the most important part)

OmniSearch is agent-ready. It runs as a webcmd site: `webcmd omnisearch <command> -f json`.
It is read-only, needs no login, and returns consistent JSON. Give an agent any
prompt below — each names the exact command and the shape of the answer to return.

1. **Competition research** — "Research the market around `{topic}`. Run
   `webcmd omnisearch research "{topic}" --sources hn,lobsters,stackoverflow,github --limit 30 -f json`.
   For each platform return the 5 highest-scored items; summarize who's building in this
   space and the one recurring complaint."

2. **Pain discovery** — "Find real, unsolved problems around `{topic}`. Run
   `webcmd omnisearch github "{topic}" --limit 15 -f json` and
   `webcmd omnisearch stackoverflow "{topic}" --limit 15 -f json`.
   Return the 10 most-referenced pains, each with a source URL."

3. **Technical feasibility** — "Assess whether `{idea}` is viable now. Run
   `webcmd omnisearch arxiv "{idea}" --limit 10 -f json` and
   `webcmd omnisearch hackermind "{idea}" --limit 15 -f json`.
   Return recent techniques from papers and the blockers hackers describe. Say what is
   'proven' vs 'aspirational'."

4. **Market validation** — "Validate demand for `{product}`. Run
   `webcmd omnisearch research "{product}" --limit 20 -f json`.
   Return signal strength = count of high-score items per platform, plus 3 representative
   quotes with URLs."

5. **Product idea pre-mortem** — "Pre-mortem `{idea}`. Run
   `webcmd omnisearch research "{idea}" --limit 30 -f json`.
   Return 3 ways this has been tried before, 3 reasons it might fail, and the strongest
   argument FOR it, each tied to a URL."

---

## Adding a platform (~20 lines)

All sources live in `sources.js` behind one uniform signature
`search(query, limit) -> rows[]`. Add a fetcher, wire it into the `research`
command's source map, and it's searchable everywhere.

## Development

```bash
webcmd plugin install file:///Users/rishetmehra/webcmd-omnisearch
webcmd list | grep -A12 omnisearch
webcmd validate omnisearch
```
