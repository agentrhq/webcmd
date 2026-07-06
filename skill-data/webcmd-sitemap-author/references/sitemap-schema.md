# Sitemap Schema

This schema defines Webcmd site sitemaps. A sitemap is an agent-facing task graph, not an SEO crawl map.

The sitemap should help an agent answer:

- Where am I?
- What stable page state am I seeing?
- Which adapter should I prefer?
- Which browser actions are available?
- What fallback should I use when an adapter or remembered path fails?
- What memory is stale or risky?

## 1. Storage And Loading

### 1.1 Two-Layer Model

Global seed:

```text
sitemaps/<site>/
```

Local overlay:

```text
~/.webcmd/sites/<site>/sitemap/
```

Local overlay wins by stable id. If both layers define the same page, action, workflow, endpoint, or pitfall id, the local overlay version is used.

Write new discoveries locally first. Promote to global only after review.

### 1.2 Recommended Layout

```text
sitemap/
  SITE.md
  pages/<page-id>.md
  pages/_<partial>.md
  workflows/<task-id>.md
  apis.md
  pitfalls.md
  draft-<topic>.md
```

Drafts must live under the `sitemap/` directory. Do not put drafts at `~/.webcmd/sites/<site>/sitemap.draft.md`; that path is invisible to sitemap availability detection.

### 1.3 Size Target

Target each lazily loaded file at about 800 tokens. This is an optimization target and audit threshold, not a reason to split cohesive tiny docs into unreadable fragments.

Guidance:

| File tokens | Decision |
| --- | --- |
| < 1500 | Usually fine. |
| 1500-3000 | Keep only if cohesive; split mixed topics. |
| > 3000 | Split into page, workflow, partial, or API files. |

## 2. Common Front Matter

Every sitemap file should start with YAML front matter:

```yaml
---
site: github
kind: site | page | partial | workflow | apis | pitfalls | draft
id: stable-id
status: verified | draft | stale
verified_at: YYYY-MM-DD
source: webcmd browser state | trace:<path> | adapter:<site>/<command>
---
```

Field rules:

| Field | Required | Meaning |
| --- | --- | --- |
| `site` | yes | Site id matching `webcmd <site>`. |
| `kind` | yes | File type. |
| `id` | yes | Stable id within kind. |
| `status` | yes | `verified`, `draft`, or `stale`. |
| `verified_at` | yes for verified/stale | Last date reality was checked. |
| `source` | yes | Evidence source. |

Do not describe unverified paths as `verified`.

## 3. `SITE.md`

Purpose: site-level orientation and route index.

Recommended sections:

```md
# <site> Sitemap

## Purpose

What this site memory helps agents do.

## Auth Assumptions

- logged out:
- logged in:
- required profile/session:

## Top-level routes

- /home -> pages/home.md
- /search -> pages/search.md
- /messages -> uncovered in this sitemap; agent must explore live
- /settings -> out of sitemap scope; agent must explore live

## Stable Page IDs

- home
- search
- item

## Adapter Preference

- Prefer `webcmd <site> <command>` for <task> when healthy.
- Fall back to browser workflow <workflow id> when suspect/broken.
```

Top-level routes should include known uncovered routes. This tells agents that the route exists but the sitemap does not provide a path.

## 4. Page Files

Path:

```text
pages/<page-id>.md
```

Purpose: state signatures, actions, linked adapters, linked endpoints, and page-specific pitfalls.

Front matter:

```yaml
---
site: github
kind: page
id: repo
status: verified
verified_at: YYYY-MM-DD
source: webcmd browser state
url_patterns:
  - https://github.com/*/*
state_signature:
  - selector: main
  - text: Code
  - url: /<owner>/<repo>
---
```

Recommended sections:

```md
# Page: repo

## State Signature

- URL matches:
- Stable selectors:
- Required text:
- Auth-dependent variants:

## Actions

### action:<stable-id>
pre: <current page / state / auth requirements>
do: <agent action, adapter command, or semantic browser command>
post: <URL / state / output that proves success>
fail: <failure signal 1> | <failure signal 2>
recover: <fallback instruction>; adapter_health_update: <adapter> -> suspect
evidence: webcmd browser <cmd> or trace:<path>

## Linked APIs

- endpoint:<id> in apis.md

## Pitfalls

- pitfall:<id> in pitfalls.md
```

### 4.1 State Signature Rules

State signatures must be observable and minimal:

- URL pattern
- stable semantic selector
- accessibility label
- visible text that is unlikely to localize away
- known app state marker

Avoid:

- screenshot coordinates
- transient list indices like `[17]`
- exact randomized class names
- private user values

## 5. Partial Page Files

Path:

```text
pages/_<partial>.md
```

Purpose: reusable UI primitives that appear on multiple pages.

Front matter:

```yaml
---
site: twitter
kind: partial
id: post-card
status: verified
verified_at: YYYY-MM-DD
source: webcmd browser state
url_patterns: []
scope_root: article[role="article"]
---
```

Partial files must state the scope root.

```md
## Scope Rule

All selectors in this partial are scoped to `article[role="article"]`.
Do not use page-level first match.
```

Bad:

```yaml
do: click [data-testid="like"]
```

Good:

```yaml
do: click [data-testid="like"] in article[role="article"] (card scope)
```

Other page files may reference:

```text
action:like in pages/_post-card.md
```

## 6. Workflow Files

Path:

```text
workflows/<task-id>.md
```

Purpose: best path and fallback path for a user-facing task.

Front matter:

```yaml
---
site: github
kind: workflow
id: read-issue
status: verified
verified_at: YYYY-MM-DD
source: trace:<path>
---
```

Recommended sections:

```md
# Workflow: read-issue

## Goal

Read an issue and extract title, author, body, labels, and comments.

## State Signature

- Start:
- Resume checkpoint:
- Success:

## Best Path

1. Prefer `webcmd github issue ...` when adapter health is `healthy`.
2. Verify output contains expected fields.

## Fallback Path

on_adapter_fail:
  - adapter_health_update: webcmd github issue -> suspect
  - webcmd browser state
  - action:open_issue in pages/repo.md
  - action:extract_comments in pages/issue.md

## Avoid

- paths that open modals unnecessarily
- selectors known to drift
- workflows requiring private data not needed for the task

## Stale Markers

- URL changed:
- selector missing:
- endpoint changed:
```

## 7. `apis.md`

Purpose: references to endpoint ids already known in `~/.webcmd/sites/<site>/endpoints.json` or public docs.

Do not duplicate full endpoint schemas inside sitemap files.

Recommended shape:

```md
# APIs

## endpoint:search

- memory: `~/.webcmd/sites/<site>/endpoints.json#search`
- used_by:
  - workflows/search.md
  - pages/search.md action:submit-search
- adapter: `webcmd <site> search`
- health: healthy | suspect | broken
- notes:
```

If an endpoint is stale, mark it:

```md
## endpoint:search

status: stale
reason: response shape no longer contains `items`
next: rerun api discovery section 1
```

## 8. `pitfalls.md`

Purpose: durable failure modes and recovery notes.

Recommended shape:

```md
# Pitfalls

## pitfall:<stable-id>

- symptom:
- cause:
- recovery:
- evidence:
- last_seen: YYYY-MM-DD
```

Examples:

- login page returns HTTP 200
- modal steals focus
- infinite scroll requires specific container scroll
- locale changes visible labels
- old adapter endpoint returns analytics data

Do not record private account values.

## 9. Action Schema

Compact action schema:

```yaml
### action:<stable-id>
pre: <current page / state / auth requirements>
do: <agent action, adapter command, or semantic browser command>
post: <URL / state / output that proves success>
fail: <failure signal 1> | <failure signal 2>
recover: <fallback instruction>; adapter_health_update: <adapter> -> suspect
evidence: webcmd browser <cmd> or trace:<path>
```

Field rules:

| Field | Required | Meaning |
| --- | --- | --- |
| `pre` | yes | What must be true before the action. |
| `do` | yes | The action: adapter command, semantic browser command, or user-level step. |
| `post` | yes | Observable success condition. |
| `fail` | yes | Failure signals that should trigger recovery. |
| `recover` | yes | What to do next. |
| `evidence` | yes | Command or trace proving this action. |

Use stable semantic actions:

- `click "New issue" button`
- `type into search input`
- `webcmd github search ...`
- `action:like in pages/_post-card.md`

Avoid:

- `click 17`
- "maybe click the blue button"
- unverified selectors
- private data

## 10. Adapter Health

Enum:

```text
healthy
suspect
broken
```

Meanings:

| Value | Meaning | Agent behavior |
| --- | --- | --- |
| `healthy` | Adapter recently verified | Prefer adapter. |
| `suspect` | Adapter failed or disagreed with browser state | Try fallback first or verify before use. |
| `broken` | Adapter known unusable | Do not retry until repaired. |

Health updates should be written to local overlay, not global seed, unless reviewed.

Example:

```yaml
adapter_health:
  webcmd github issue: suspect
  reason: selector missing on YYYY-MM-DD
  evidence: trace:/path/to/summary.md
```

## 11. Staleness

Mark stale when:

- current browser state contradicts sitemap
- adapter output disagrees with visible page
- endpoint response shape changed
- selector no longer exists
- route redirects unexpectedly

Do not delete stale evidence immediately. Mark it stale with reason and next step:

```yaml
status: stale
stale_reason: selector `[data-testid=old]` missing
next: rerun `webcmd browser analyze <url>`
```

## 12. Security And Privacy

Never store:

- cookies
- tokens
- authorization headers
- private ids
- private messages
- private account data
- paid content
- instructions to bypass CAPTCHA, WAF, rate limits, access control, or paid gates

If evidence contains private data, summarize the durable structure instead of storing raw content.

## 13. Promotion Rules

Promote local sitemap entries to `sitemaps/<site>/` only when:

- evidence is present
- content is general to the site, not account-specific
- paths are verified
- stale risks are named
- no secrets or private data are present
- file size is within budget or justified

Do not promote drafts as verified.

## 14. Validation Checklist

Before considering a sitemap file ready:

- [ ] Front matter has `site`, `kind`, `id`, `status`, `verified_at`, and `source`.
- [ ] Current browser state was checked.
- [ ] Actions have `pre`, `do`, `post`, `fail`, `recover`, and `evidence`.
- [ ] Adapter fallback updates `adapter_health` when relevant.
- [ ] Selectors are semantic and scoped.
- [ ] Partial selectors are scoped to partial root.
- [ ] Uncovered routes are explicitly marked.
- [ ] No private data or secrets.
- [ ] Stale entries are marked instead of silently removed.
- [ ] Drafts are inside the sitemap directory.

## 15. Consumer Rule

The consuming agent must treat sitemap memory as a hint. Current browser state is truth.

When memory and browser disagree:

1. Trust browser state.
2. Mark memory stale in local overlay.
3. Use fallback path.
4. Record evidence so the next agent does not repeat the failed path.
