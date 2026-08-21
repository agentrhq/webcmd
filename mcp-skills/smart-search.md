# Smart Search through MCP

Use this for research, source discovery, direct URL fetches, and evidence. Every
operation goes through `webcmd_cli_run` with argv data; request JSON whenever the
result will be read programmatically.

Use live fetch results, command metadata, and command help. Do not infer command arguments from this skill, maintain a routing table, or claim a source was searched when it was not.

## Cost order

For a supplied URL, try the first-choice fetch path before browser work:

    { "argv": ["web", "fetch", "--url", "https://example.com", "-f", "json"] }

Only `FETCH_BLOCKED` or `FETCH_REQUIRES_BROWSER` permits browser fallback. For a
topic without a named site, fetch one search-engine result page, extract result
URLs from its JSON/text response, then fetch up to three target pages. Search
snippets discover sources; fetched primary content is evidence.

For a named site, inspect the live command surface first:

    { "argv": ["list", "--tag", "search", "-f", "json"] }
    { "argv": ["github", "search", "--help"] }
    { "argv": ["github", "search", "--query", "agents", "-f", "json"] }

Do not create shell pipelines. Read the JSON response directly, preserve source
URLs, and report failures rather than claiming an unperformed search.

Any truncation warning means adapter discovery is incomplete: narrow the filter and inspect again. Absence from truncated output never proves that no adapter exists.

## Budgets

Try one search engine by default and a second only if the first is weak or
blocked. Fetch three result URLs by default (five for a broad comparison), use
at most two browser sessions, and run one adapter search unless the first is
weak or needs independent corroboration. A rate limit, login gate, CAPTCHA, or
unusable extraction is a reason to move to another source, not to repeat the
same request.

Report the commands run, sources fetched, browser fallback URLs, and gaps.
