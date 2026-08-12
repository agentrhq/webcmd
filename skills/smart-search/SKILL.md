---
name: smart-search
description: Use when a request needs search, research, source discovery, direct URL fetch, evidence fetching, or search-capable Webcmd adapter discovery.
---

# Smart Search

This is Webcmd's one-stop workflow for search + fetch. Use it for any request that asks to search, research, find sources, look something up, fetch/read a URL, compare sources, or gather evidence.

Use live fetch results, command metadata, and command help. Do not infer command arguments from this skill, maintain a routing table, or claim a source was searched when it was not.

Do not use this skill for plugin inventory, plugin management, or listing available extensions. Marketplace commands appear here only to find and install search-capable adapters needed for the current search/fetch task.

Cost order is mandatory when the request does not name a site: `webcmd web fetch` first, search adapters last. `web fetch` walks the HTTP → TLS → browser ladder itself, so one call already covers plain and browser fetching. Do not call search adapters until it has failed.

When the request does name a site or community, take the site-native fast path below instead.

## Site-named fast path

When the request names the site(s) to search (not just a topic), look for a site-native command first:

```bash
webcmd list --tag search -f json
```

If an installed command covers a named site, run it before any search-engine fetch. If none covers it, try `webcmd plugin search <site>` once within the install budget. Only when the named site has no adapter does that site fall back to the cost order above, starting with the site's own search URL.

Do not report a site as blocked or unavailable until you have checked adapter availability this way.

## Trust boundary

Use only installed commands, their reported output, and fetched primary content as evidence. Preserve source URLs and report failures. Do not add marketplaces automatically: adding a marketplace is a user trust decision.

Prefer primary sources, official docs, and direct content over search snippets. Treat snippets, previews, and result titles as discovery, not evidence.

## Direct URL

For a supplied HTTP(S) URL, fetch it:

```bash
webcmd web fetch --url <url>
```

That single call handles browser escalation itself: if the site blocks plain HTTP and TLS impersonation, it renders the page in a browser and returns the content, reporting `Extraction: browser`. Do not chase a `FETCH_BLOCKED` with a second command — if you received that error, the browser tier already ran or was unavailable.

If the fetch is rate-limited, login-gated, geo-gated, or returns unusable extracted text, report that state rather than retrying the same URL.

## Fetch-first web search

For a search query that names no site and has no direct URL, start with fetched search-engine result pages, not adapters. Encode the query into one of these URLs and fetch it:

```bash
webcmd web fetch --url "https://duckduckgo.com/html/?q=<encoded-query>"
webcmd web fetch --url "https://www.bing.com/search?q=<encoded-query>"
webcmd web fetch --url "https://www.google.com/search?q=<encoded-query>"
```

Try one search engine by default. Try a second when the first is weak, empty, blocked, CAPTCHA-gated, or lacks usable result URLs. Treat Google as more likely to block; DuckDuckGo HTML and Bing are cheaper first choices.

Query terms that collide with everyday English (`puppeteer`, `playwright`, `rust`) pull unrelated results. Add a disambiguating term and say so if results still drift.

Extract useful result URLs from the fetched page and then fetch the target pages with `webcmd web fetch`. Search snippets and result titles are discovery only, not evidence. A page that yields zero usable result URLs is a failed search, not a search with no results: move to the next engine.

If the search-engine result page itself needs browser rendering, `web fetch` escalates once on its own; do not re-run it for the same engine. A recognised block, CAPTCHA, or challenge page retires that engine for this request: do not re-fetch variants of the same engine. Do not jump to adapters because one engine blocked, unless the request names a site.

## Fetch evidence

Fetch up to three result URLs by default (five for a broad comparison):

```bash
webcmd web fetch --url <url>
```

Browser escalation happens inside `web fetch`, so a blocked page costs one command, not two. Pass `--browser false` when you want a cheap HTTP-only probe and are willing to skip blocked pages. Cite or link the source URL with substantive claims.

If fetch is rate-limited, auth-gated, CAPTCHA-gated, bot-detected, quota-limited, or geo-blocked, do not loop. Try another relevant URL/source when available; otherwise report the blocker.

## Adapter fallback

On the site-named fast path, discover adapters first. Otherwise, only after fetch-first search, target-page fetch, and allowed browser fetches fail or are insufficient, discover search adapters:

```bash
webcmd list --tag search -f json
```

Shortlist up to five candidate commands from site, name, description, keywords, strategy, browser requirement, and output columns. Prefer the named site, then a comparably relevant installed command. Read live help before execution:

```bash
webcmd <site> <command> -h
```

Run one adapter search command. Run a second only if the first is weak, empty, fails, or an independent source materially corroborates it. Do not use adapters as the first search path unless the request names the site.

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
- Two escalated (browser-tier) fetches by default; use `--browser false` once that budget is spent.
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
