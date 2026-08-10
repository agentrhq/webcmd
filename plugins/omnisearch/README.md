<h1 align="center">
  🔎 OmniSearch
</h1>

<p align="center">
  <strong>The internet's opinion — in one command.</strong><br/>
  Scrape & research <strong>X, Reddit, LinkedIn, Instagram, YouTube, Hacker News, Stack Overflow, GitHub, arXiv, Dev.to, Lobsters, Bluesky</strong> — no login, one clean JSON response.
</p>

---

## 🌐 12 platforms, ordered by reach

OmniSearch sweeps every big place people talk online. The social giants (via your logged-in profile) plus the developer & research communities (no login at all).

| # | Platform | Access | What it surfaces |
|---|----------|--------|------------------|
| 1 | **X / Twitter** 🐦 | profile | Real-time public opinion |
| 2 | **Reddit** 🧑‍🤝‍🧑 | profile | The front page of the internet, thread-level |
| 3 | **LinkedIn** 💼 | profile | Professional voices, people search |
| 4 | **Instagram** 📸 | profile | Visual & DM culture |
| 5 | **YouTube** ▶️ | profile | Video + comments |
| 6 | **Hacker News** 🟠 | no login | Tech opinions & discussions |
| 7 | **Stack Overflow** 📚 | no login | Real problems developers ask |
| 8 | **GitHub** 🐙 | no login | Real problems people report (issues/PRs) |
| 9 | **Dev.to** 💜 | no login | Developer articles |
| 10 | **arXiv** 📄 | no login | Research papers |
| 11 | **Lobsters** 🦞 | no login | Developer discussions |
| 12 | **Bluesky** 🦋 | no login | Public posts by account |

---

## ⚡ Quick start

```bash
webcmd plugin install github:Rishet11/webcmd-plugin-omnisearch

# 🔓 No login — instant, works for everyone
webcmd omnisearch verdict "saas pricing" -f json          # 🏆 the community's verdict
webcmd omnisearch research "saas pricing" -f json         # aggregate all sources
webcmd omnisearch stackoverflow "billing saas" -f json   # real problems

# 🔑 Logged-in social — one-time setup, then headless
webcmd --profile social twitter search "saas pricing" -f json
webcmd --profile social reddit search "saas pricing" -f json
webcmd --profile social linkedin people-search "saas founder" -f json
webcmd --profile social instagram search "saas" -f json
```

---

## 🎯 Commands (Tier 1 — no login)

| Command | Source(s) | What it does |
|---------|-----------|--------------|
| `omnisearch verdict <topic>` | all | 🏆 Synthesizes the community verdict, ranked by traction |
| `omnisearch research <topic>` | all | Aggregates everything in one feed; filter with `--sources` |
| `omnisearch hackermind <q>` | Hacker News | Tech opinions & discussions |
| `omnisearch stackoverflow <q>` | Stack Overflow | Real problems developers ask |
| `omnisearch github <q>` | GitHub | Real problems people report (issues/PRs) |
| `omnisearch devto <tag>` | Dev.to | Developer articles (takes a TAG) |
| `omnisearch arxiv <q>` | arXiv | Research papers |
| `omnisearch lobsters [--sort]` | Lobsters | Developer discussions |
| `omnisearch bluesky-posts <handle>` | Bluesky | One public account's posts |

## 🔑 Commands (Tier 2 — logged-in social)

Install the official plugins once, sign in once, then research headlessly:

```bash
webcmd plugin install github:agentrhq/webcmd/twitter
webcmd plugin install github:agentrhq/webcmd/reddit
webcmd plugin install github:agentrhq/webcmd/linkedin
webcmd plugin install github:agentrhq/webcmd/instagram

# One-time sign-in per site (~1 min each)
webcmd --profile social twitter login
webcmd --profile social reddit login

# Then headless research on the social giants
webcmd --profile social twitter search "<query>" -f json
webcmd --profile social reddit subreddit startups -f json
webcmd --profile social linkedin people-search "<job>" -f json
webcmd --profile social instagram search "<tag>" -f json
```

> Tier 2 is **optional & machine-specific** (needs your own profile). Tier 1 works for everyone, everywhere, no login.

---

## 🤖 Driving it with an AI agent

Give any agent a prompt below — each names the exact command and the answer shape.

1. **Competition research** — "Run `webcmd omnisearch research \"{topic}\" --sources hn,lobsters,stackoverflow,github --limit 30 -f json`. For each platform return the 5 highest-scored items; summarize who's building here and the one recurring complaint."
2. **Pain discovery** — "Run `webcmd omnisearch github \"{topic}\" --limit 15 -f json` and `webcmd omnisearch stackoverflow \"{topic}\" --limit 15 -f json`. Return the 10 most-referenced pains, each with a source URL."
3. **Technical feasibility** — "Run `webcmd omnisearch arxiv \"{idea}\" --limit 10 -f json` and `webcmd omnisearch hackermind \"{idea}\" --limit 15 -f json`. Return recent techniques and blockers; say what's proven vs aspirational."
4. **Market validation** — "Run `webcmd omnisearch research \"{product}\" --limit 20 -f json`. Return signal strength per platform plus 3 representative quotes with URLs."
5. **Product pre-mortem** — "Run `webcmd omnisearch research \"{idea}\" --limit 30 -f json`. Return 3 ways this failed before, 3 reasons it might fail, the strongest argument for it, each with a URL."

Also ships **`SKILL.md`** so agent harnesses auto-discover OmniSearch.

---

## 📦 Output schema (uniform)

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

`score` + `commentCount` let you rank by **real traction**, not search order.

## ➕ Adding a platform (~20 lines)

All sources live in `sources.js` behind one signature `search(query, limit) -> rows[]`.
Add a fetcher, wire it into `research`, and it's searchable everywhere.

## 🛠 Development

```bash
webcmd plugin install file:///Users/rishetmehra/webcmd-omnisearch
webcmd list | grep -A12 omnisearch
webcmd validate omnisearch
```
