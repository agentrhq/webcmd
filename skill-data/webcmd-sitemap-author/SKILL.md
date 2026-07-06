---
name: webcmd-sitemap-author
description: Use when creating or maintaining Webcmd site sitemaps: agent-facing navigation, page-state, action, workflow, API-reference, pitfall, and fallback knowledge for a website. Use after browser exploration discovers durable site context, when a sitemap is stale, or when promoting local site knowledge into the repo.
allowed-tools: Bash(webcmd:*), Read, Edit, Write, Grep
---

# webcmd-sitemap-author

You are authoring a **task execution graph for agents**, not an SEO sitemap. The artifact helps an agent using `webcmd browser` decide where it is, what path to take next, which Webcmd adapter to prefer, and how to recover when the page disagrees with memory.

Keep the sitemap small and verified. Do not crawl a whole site. Capture only task-relevant paths that you actually observed.

## Storage Model

Two layers:

- **Global seed:** `sitemaps/<site>/`
- **Local overlay:** `~/.webcmd/sites/<site>/sitemap/`

Local overlay wins by stable id. Write new discoveries locally first. Promote to global only after review.

Recommended layout:

```text
sitemap/
  SITE.md
  pages/<page-id>.md
  pages/_<partial>.md
  workflows/<task-id>.md
  pitfalls.md
```

### Size Guidance

`references/sitemap-schema.md` defines an 800-token target for lazy loading and audit. In real authoring, small pages with one or two actions may naturally land between 800 and 2000 tokens. Use this table:

| File tokens | Decision |
| --- | --- |
| < 1500 | Natural size; leave it. |
| 1500-3000 | Keep only if cohesive; split mixed content. |
| > 3000 | Split into a sub-file or partial. |

The 800-token target remains the audit threshold. If a file exceeds it, either explain the cohesive reason or split.

## Authoring Loop

1. Load existing memory: local overlay first, then global seed if present.
2. Verify reality with `webcmd browser <session> state`, `find`, `network`, and `analyze`. Browser state is truth.
3. If you just completed `webcmd-adapter-author` for this site, seed from retained browse traces under `~/.webcmd/sites/<site>/traces/` instead of rediscovering from zero.
4. Record durable structure only: page purpose, stable anchors, state signatures, actions, workflows, API references, pitfalls.
5. Use stable ids for pages, actions, and workflows. They should survive URL params, locale text drift, and minor layout changes.
6. Write the local draft under `~/.webcmd/sites/<site>/sitemap/...` unless explicitly promoting to repo.
7. On conflict, trust current browser state and mark stale memory instead of forcing the old path.

## Required Action Schema

Every action edge must include:

```yaml
### action:<stable-id>
pre: <current page / state / auth requirements>
do: <agent action, adapter command, or semantic browser command>
post: <URL / state / output that proves success>
fail: <failure signal 1> | <signal 2>
recover: <fallback instruction>; adapter_health_update: <adapter> -> suspect
evidence: webcmd browser <cmd> or trace:<path>
```

Use this compact form by default. Use the longer Markdown form from `references/sitemap-schema.md` only when an action genuinely needs longer explanation. `verified_at` and `source` are inherited from file front matter; do not repeat them per action.

Do not promote an action without evidence. If a recovery path marks `adapter_health_update`, the browser-sitemap consumer must write that health update to the local overlay so the next agent does not retry a known-suspect adapter.

## Partial Pages

Partial files (`_<name>.md`, `url_patterns: []`) hold cross-page UI primitives, such as a reusable post card with like/reply/share actions. Multiple page files can reference `action:<id> in pages/_<name>.md`.

**Partial scope rule:** every selector inside a partial, whether testid, accessibility, or structural, must be scoped to the partial root. It must not rely on a page-level first match.

Bad:

```yaml
do: click [data-testid="like"]
```

Good:

```yaml
do: click [data-testid="like"] in article[role="article"] (card scope)
```

At the top of the partial file, state the scope root:

```md
## Card Scope Rule

All testid selectors must be scoped to `article[role="article"]`; do not use page-level first match.
```

## Workflow Fields

Each workflow should answer:

- **Goal:** user-facing task this workflow solves.
- **State signature:** minimal observable checkpoint for resume after sleep or compaction.
- **Best path:** prefer existing `webcmd <site> <command>` adapter if it covers the goal.
- **Fallback path:** browser workflow if the adapter is missing or failing.
- **Avoid:** tempting paths that waste turns, trigger modals, or rely on unstable selectors.
- **Stale markers:** last verified date and known layout/API drift signals.

Endpoint/API knowledge should reference ids from `endpoints.json` when available. Do not duplicate full endpoint schemas inside sitemap files.

### `on_adapter_fail:` Fallback Convention

Start fallback paths with trigger condition plus `adapter_health_update`:

```yaml
on_adapter_fail:
  - adapter_health_update: webcmd twitter post -> suspect
  - webcmd browser state (verify current page)
  - if not on /home: goto /home
  - action:open_compose in pages/home.md
```

This tells the consuming skill that fallback was triggered by adapter failure, not by an entry-point choice. The health update comes first, then recovery steps.

## `SITE.md` Top-Level Routes

`SITE.md` should list covered routes and explicitly mark known routes that the sitemap does not navigate. This prevents agents from assuming "not listed" means "does not exist."

```md
## Top-level routes

- /home -> pages/home.md
- /search -> pages/search.md
- /messages -> uncovered in this sitemap; agent must explore live
- /settings -> out of sitemap scope; agent must explore live
```

Writing uncovered markers tells the agent the route exists but sitemap help is limited.

## Red Lines

- Sitemap is a hint; current browser state is truth.
- Do not write secrets, cookies, private ids, private messages, or account-specific values.
- Do not document bypasses for CAPTCHA, WAF, access control, rate limits, or paid gates.
- Do not store brittle snapshot indices like `[17]` as durable targets. Store semantic anchors and recovery instructions.
- Do not describe unverified paths as facts. Use `draft` or `stale` labels.
- Drafts go inside `sitemap/draft-<topic>.md`, not `~/.webcmd/sites/<site>/sitemap.draft.md` at the parent level. The parent-level draft is invisible to sitemap availability detection.

## Detailed Schema

See [`references/sitemap-schema.md`](./references/sitemap-schema.md) for the full field-level spec: `SITE.md`, `pages/<id>.md`, `workflows/<id>.md`, `apis.md`, `pitfalls.md`, action-level state signatures, `adapter_health` enum (`healthy`, `suspect`, `broken`), endpoint references, two-layer overlay semantics, draft placement, and validation rules.
