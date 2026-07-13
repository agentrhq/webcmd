---
name: smart-search
description: Intelligent search router based on webcmd commands. Use this skill when the user wants to search, query, find, or research information through Webcmd, CLI, or API sources, especially for named websites, social media, technical material, news, shopping, travel, jobs, finance, or multilingual content
---

# Smart Search Router

Route a query to the best webcmd search source based on the topic and context. The goal of this skill is not to memorize command signatures. First choose the data source, then have the agent read live help through `webcmd` so stale documentation does not leak into the answer.

## Mandatory Preflight

Before every use, do both of these steps:

- Run `webcmd list -f json`
- Use the live registry to confirm that candidate sites exist, and inspect `strategy`, `browser`, and `domain`

If the user explicitly names a site/source and it is missing from `webcmd list` or when none of the sites cover the query, check installable plugins before marking it unavailable:

```bash
webcmd plugin search <site-or-source-or-capability> -f json
```

Derive a short plugin query from the missing site or capability. Preserve the user's term when practical: `find flights` becomes `flight`.

If plugin search finds a match, tell the user it is available as a plugin and offer `webcmd plugin install <source>`. If plugin search fails because catalog sources cannot be fetched, report that catalog/search error separately from no plugin match.

After choosing a site, do both of these steps:

- Run `webcmd <site> -h` to see the site's subcommands
- If a subcommand is already selected, run `webcmd <site> <command> -h` to inspect parameters, output columns, and strategy

Do not hard-code parameters or assume command signatures from skill docs. Trust the live output of `webcmd ... -h`.

## Main Routing Rule

Use this single rule instead of maintaining multiple priority lists:

1. If the user explicitly names a website, platform, or data source, use that site directly.
2. If the user does not name a site, prefer exactly one AI source: choose one of `grok`, `chatgpt`, or `gemini`.
3. If the AI answer is thin, lacks raw data, needs authoritative corroboration, or needs vertical results, add 1-2 specialized sources.

## Per-Question Budget And Rate Limits

Treat a "single user question" as one problem-solving chain for the same intent. Follow-ups, clarifications, and added constraints in the same thread still count as the same question when the core problem has not changed.

First create a site-call ledger. After each real search command, update it immediately:

- `site`
- `query`
- `count`
- `status`

Counting rules:

- `webcmd list -f json`, `webcmd plugin search <query> -f json`, `webcmd <site> -h`, and `webcmd <site> <command> -h` are preflight/help commands and do not count as searches.
- One real `webcmd <site> ...` search/query execution counts as 1 call for that site.
- A failed call caused by an error, timeout, CAPTCHA, anti-bot check, or broken login state still counts as 1 call for that site. Do not retry indefinitely.

Rate limits:

- Hard AI-source limit: for the same question, call each AI source at most once.
- The default strategy is still to choose only 1 AI source. Do not chain multiple AI sources as a routine workflow.
- Call additional AI sources only when the user explicitly asks to compare multiple AI sources. Even then, each named AI source may be called at most once.
- Non-AI sites default to at most 2 calls.
- The second call to a non-AI site must have a clear reason, such as narrowing by time, region, category, sorting, or keywords after an overly broad first result.
- Do not make a third call to a non-AI site. If information is still insufficient, stop expanding and state the gap clearly.

When a rate limit is reached:

- Record: `Skipped: <site> reached the rate limit`
- Prefer another site of the same type
- If no suitable alternative source exists, answer from the collected information and explain coverage and gaps

## End-Of-Query Report

At the end of every query, append a short "Search Summary" with at least these three items:

- Which sites were searched
- What query terms were used for each site
- How many times each site was searched

If any site was skipped because of a rate limit, say so explicitly.

Use this fixed format when possible:

```md
Search Summary
- Site: <site1> | Query: <term1> | Calls: <n>
- Site: <site2> | Query: <term2>; <term3> | Calls: <n>
- Skipped: <site3> | Reason: reached the rate limit
```

## AI Source Selection

- `grok`
  Best for real-time discussion, English-language internet sentiment, Twitter/X context, and trending topics.
- `chatgpt`
  Best for broad Q&A, synthesis, planning, coding help, and general-purpose English-language research.
- `gemini`
  Best for global web coverage, English-language sources, general information retrieval, and background summaries.

If the user did not name a site, first judge language and context, then choose exactly one of these three.

After an AI site has run one real query for the same question, do not call that same AI site again with rewritten keywords. If the answer is insufficient, prefer specialized sources instead of repeatedly hitting the same AI site.

## AI Query Guidance

When using an AI source, do not send a very short keyword by itself. Prefer a query shaped as "topic + goal + constraints."

- Topic
  The object, event, product, person, company, or technical term the user really wants to investigate.
- Goal
  The desired result, such as summary, comparison, cause, trend, recommendation, or raw leads.
- Constraints
  Language, region, time range, platform scope, audience, price band, job location, or whether raw sources are required.

Prefer these shapes:

- `<topic> + <question to answer>`
- `<topic> + <time range/region/language>`
- `<topic> + <platform or source scope>`
- `<topic> + <output requirement>`

Avoid sending only:

- A single noun
- A trending question with no time range
- A shopping, jobs, or travel question with no region
- A social-media question with no platform scope

## When To Add Specialized Sources

Add specialized sources when any of these conditions apply:

- The AI provides a summary, but raw posts, raw videos, raw products, or raw job results are needed
- The AI coverage is thin or misses vertical-site information
- Higher authority or stronger domain relevance is needed
- The user explicitly asks to search on a specific platform

Keep a typical query to 1 AI source plus 1-2 specialized sources to avoid result overload.

## Handling Unavailable Sources

When a site is unavailable:

- Do not stop the whole search because one source failed
- For a missing site or capability, run `webcmd plugin search <query> -f json` before recording unavailable
- Record: `Skipped: <site> unavailable`
- Fall back to another site of the same type, or to one AI source
- Always trust the actual output of `webcmd list -f json`, `webcmd plugin search -f json`, and `webcmd <site> -h`

Do not assume any site is always available. Even for public sites, trust live help and execution results in the current environment.

## Reference Files

Read only the files relevant to the current query:

- **`references/sources-ai.md`** - default AI sources
- **`references/sources-tech.md`** - technology and research
- **`references/sources-social.md`** - social media
- **`references/sources-media.md`** - media and entertainment
- **`references/sources-info.md`** - news and knowledge
- **`references/sources-shopping.md`** - shopping
- **`references/sources-travel.md`** - travel
- **`references/sources-other.md`** - other vertical sources

Do not load every reference file unless the query actually needs them.
