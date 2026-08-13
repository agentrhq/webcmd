---
name: smart-search
description: Use when a request needs search, research, source discovery, direct URL fetch, evidence fetching, or search-capable Webcmd adapter discovery.
---

# Smart Search

This is Webcmd's one-stop workflow for search + fetch. Use it for any request that asks to search, research, find sources, look something up, fetch/read a URL, compare sources, or gather evidence.

Use live fetch results, command metadata, and command help. Do not infer command arguments from this skill, maintain a routing table, or claim a source was searched when it was not.

Do not use this skill for plugin inventory, plugin management, or listing available extensions. Marketplace commands appear here only to find and install search-capable adapters needed for the current search/fetch task.

Cost order is mandatory when the request does not name a site: `webcmd web fetch` first, search adapters last. `web fetch` runs locally in both modes and never opens a browser. Do not call search adapters until it has failed.

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

Try fetch once. Only `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER` permits browser fallback; otherwise report the returned failure rather than retrying the URL.

For browser fallback, create one Session, navigate the failed URL, inspect it, reuse that Session for allowed fallbacks, then close it. Local browser commands use Cloak; hosted browser commands use Webcmd Cloud and Browser Use. `web fetch` remains local in both modes.

```bash
webcmd --profile work session create
# Copy the returned full ID:
# session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45

webcmd --profile work \
  --session session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45 \
  browser run --stdin <<'JS'
await page.goto('https://example.com');
return { url: page.url(), title: await page.title() };
JS

webcmd --profile work \
  --session session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45 \
  browser snapshot --snapshot-mode read

webcmd --profile work session close \
  session_7d8f2c10-4a11-4f3e-9c22-1b6de0a91f45
```

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

If the search-engine result page returns `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER`, use the Session workflow once within the browser Session budget. A recognised block, CAPTCHA, or challenge page retires that engine for this request: do not re-fetch variants of the same engine. Do not jump to adapters because one engine blocked, unless the request names a site.

## Fetch evidence

Fetch up to three result URLs by default (five for a broad comparison):

```bash
webcmd web fetch --url <url>
```

For `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER`, use the Session workflow above if the browser Session budget permits. Cite or link the source URL with substantive claims.

If fetch is rate-limited, auth-gated, CAPTCHA-gated, bot-detected, quota-limited, or geo-blocked, do not loop. Try another relevant URL/source when available; otherwise report the blocker.

## Adapter fallback

On the site-named fast path, discover adapters first. Otherwise, only after fetch-first search, target-page fetch, and allowed browser Session fallbacks fail or are insufficient, discover search adapters:

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
- Two browser Sessions/URLs by default; reuse one Session for allowed browser fallbacks.
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
