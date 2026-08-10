---
name: smart-search
description: Use when a request needs search, research, source discovery, direct URL fetch, evidence fetching, or search-capable Webcmd adapter discovery.
---

# Smart Search

This is Webcmd's one-stop workflow for search + fetch. Use it for any request that asks to search, research, find sources, look something up, fetch/read a URL, compare sources, or gather evidence.

Use live fetch results, command metadata, and command help. Do not infer command arguments from this skill, maintain a routing table, or claim a source was searched when it was not.

Do not use this skill for plugin inventory, plugin management, or listing available extensions. Marketplace commands appear here only to find and install search-capable adapters needed for the current search/fetch task.

Cost order is mandatory: `webcmd web fetch` first, `webcmd web fetch-browser` second, search adapters last. Do not call search adapters until plain HTTP/TLS fetch and browser fetch cannot satisfy the task.

## Trust boundary

Use only installed commands, their reported output, and fetched primary content as evidence. Preserve source URLs and report failures. Do not add marketplaces automatically: adding a marketplace is a user trust decision.

Prefer primary sources, official docs, and direct content over search snippets. Treat snippets, previews, and result titles as discovery, not evidence.

## Direct URL

For a supplied HTTP(S) URL, fetch it first:

```bash
webcmd web fetch --url <url>
```

Only when the structured error code is `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER`, use:

```bash
webcmd web fetch-browser --url <url>
```

Do not escalate on message prose and do not make `web fetch` launch a browser.

If direct fetch is rate-limited, blocked, CAPTCHA-gated, login-gated, geo-gated, or returns unusable extracted text, report that state. Only browser-escalate for `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER`.

## Fetch-first web search

For a search query without a direct URL, start with fetched search-engine result pages, not adapters. Encode the query into one of these URLs and fetch it:

```bash
webcmd web fetch --url "https://duckduckgo.com/html/?q=<encoded-query>"
webcmd web fetch --url "https://www.bing.com/search?q=<encoded-query>"
webcmd web fetch --url "https://www.google.com/search?q=<encoded-query>"
```

Try one search engine by default. Try a second when the first is weak, empty, blocked, CAPTCHA-gated, or lacks usable result URLs. Treat Google as more likely to block; DuckDuckGo HTML and Bing are cheaper first choices.

Extract useful result URLs from the fetched page and then fetch the target pages with `webcmd web fetch`. Search snippets and result titles are discovery only, not evidence.

If the search-engine result page itself needs browser rendering, use at most one browser fetch for a search results page before trying another search engine. Do not jump to adapters because one engine blocked.

## Fetch evidence

Fetch up to three result URLs by default (five for a broad comparison):

```bash
webcmd web fetch --url <url>
```

Use up to two browser fetches by default, only when target-page `web fetch` returns `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER`. Cite or link the source URL with substantive claims.

If fetch is rate-limited, auth-gated, CAPTCHA-gated, bot-detected, quota-limited, or geo-blocked, do not loop. Try another relevant URL/source when available; otherwise report the blocker.

## Adapter fallback

Only after fetch-first search, target-page fetch, and allowed browser fetches fail or are insufficient, discover search adapters:

```bash
webcmd list --tag search -f json
```

Shortlist up to five candidate commands from site, name, description, keywords, strategy, browser requirement, and output columns. Prefer the named site, then a comparably relevant installed command. Read live help before execution:

```bash
webcmd <site> <command> -h
```

Run one adapter search command. Run a second only if the first is weak, empty, fails, or an independent source materially corroborates it. Do not use adapters as the first search path.

When no installed command covers the needed site or specialized capability, use marketplace search only as adapter fallback:

```bash
webcmd plugin search <site-or-capability> -f json
```

Install promising plugins sequentially, at most three plugins per user request:

```bash
webcmd plugin install <installSource>
webcmd list --tag search -f json
```

Inspect the newly visible command help. Stop once a suitable command appears. If installation fails, report the error and continue with fetched sources.

Do not add custom marketplaces in this workflow. In hosted mode, only verified hosted marketplace adapters are installable.

## Operational budgets

- At most three plugin installs per user request.
- One fetched search-engine page by default; second if weak/blocked; third only if the first two fail.
- Up to five candidate commands before choosing.
- Three URLs by default; five only for broad comparison.
- Two browser fetches by default.
- One adapter search by default; second only for weakness or corroboration.
- Do not retry the same blocked command more than once.

## Search Summary

Append this to the response:

```md
Search Summary
- Commands: <executed commands>
- Sources fetched: <URLs>
- Browser fallback: <URLs or none>
- Gaps/failures: <none or details>
```
