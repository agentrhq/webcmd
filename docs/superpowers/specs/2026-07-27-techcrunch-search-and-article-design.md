# TechCrunch Search and Article Design

## Goal

Replace the pre-merge `techcrunch latest` command with a compact read-only
surface that supports both story discovery and reading:

```bash
webcmd techcrunch search "artificial intelligence"
webcmd techcrunch search --latest
webcmd techcrunch article <techcrunch-url>
```

## Command behavior

### `search [query]`

- A query searches TechCrunch posts using the site's public WordPress REST API.
- `--latest` lists the newest posts through the same API.
- A query and `--latest` are mutually exclusive.
- Omitting both is an argument error.
- `--limit` accepts integers from 1 through 50 and defaults to 20.
- Results contain rank, title, author, publication time, description, and URL.

### `article <url>`

- Accepts only an `http` or `https` TechCrunch article URL.
- Derives the article slug from the URL and queries the public WordPress REST
  API.
- Returns title, author, publication time, categories, description, full
  available plain-text content, and canonical URL.
- A missing or content-free article produces a typed empty-result error.

## Implementation

Both commands use `Strategy.PUBLIC`, require no browser or login, and share
small HTML/entity decoding and request helpers under `plugins/techcrunch/lib/`.
No dependency is added. The old RSS-only command is removed because this PR has
not merged and therefore needs no compatibility alias.

## Errors and verification

Invalid modes, limits, and URLs use `ArgumentError`; request and JSON failures
use `CommandExecutionError`; zero readable results use `EmptyResultError`.
Focused Node tests cover mode selection, URL validation, API mapping, and
article text extraction. Final verification runs those tests, community-plugin
sync checks, the repository suite, and live calls for both commands.
