---
name: omnisearch
description: Read-only, no-login web research across Hacker News, Lobste.rs, Stack
  Overflow, GitHub issues, Dev.to, arXiv, and Bluesky. Use to answer "what does the
  internet think / ask / struggle with" about any topic. Returns JSON via webcmd.
---

# OmniSearch skill

1. Invoke every query as `webcmd omnisearch <command> -f json`. The site name is
   `omnisearch` — never call `webcmd research` or omit the site prefix.
2. Choose the command by intent:
   - `research "<topic>"` — whole-space scan across all sources. Add
     `--sources hn,lobsters,stackoverflow,github,arxiv` to narrow.
   - `github` / `stackoverflow` — real problems people report/ask.
   - `hackermind "<query>"` — HN opinions and discussions.
   - `arxiv "<query>"` — research papers.
   - `devto <tag>` — Dev.to articles. **Takes a TAG, not free text** (e.g. `saas`).
   - `lobsters --sort active|newest|hot` — live discussion (no free query).
   - `bluesky-posts <handle>` — one public account's feed.
3. `research` distributes `--limit` across sources, so use `--limit` >= 24 for
   coverage. `title` and `url` are always populated; `text` may be empty (HN,
   StackOverflow) or truncated (GitHub 300 chars, arXiv 200). Never fabricate a
   summary from an empty `text` — cite `url` and rank by `score`.
4. GitHub search is rate-limited (~10 req/min). Space out parallel calls; do not
   fan out 6 GitHub calls at once.