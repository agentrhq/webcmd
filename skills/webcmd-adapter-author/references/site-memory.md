# Site Memory

Site memory prevents every adapter run from starting cold. It has two layers:

1. In-repo public seeds under `references/site-memory/<site>.md`, when a seed exists.
2. CLI-managed working memory.

Use `webcmd site memory show <site>` to read contents and `webcmd site memory list <site>` to inspect staleness. Do not write private cookies, tokens, or user data into the repo.

## `endpoints.json`

Short endpoint name as key:

```json
{
  "search": {
    "url": "https://example.com/api/search",
    "method": "GET",
    "params": {
      "required": ["q"],
      "optional": ["page", "sort"]
    },
    "response": {
      "rowsPath": "data.items",
      "sampleFields": ["title", "url", "score"]
    },
    "verified_at": "YYYY-MM-DD",
    "notes": "What was checked and what can drift."
  }
}
```

Rules:

- Re-verify memory hits before using them.
- Treat entries older than 30 days as stale.
- Record verified endpoints with `webcmd site endpoint set <site> <name> --url <url> --method <method>`; mark changes with `webcmd site endpoint stale <site> <name>` instead of deleting evidence silently.
- Never store cookies, bearer tokens, CSRF tokens, or private user data.

## `field-map.json`

Map source codes or unclear keys to meanings:

```json
{
  "num_comments": {
    "meaning": "commentCount",
    "verified_at": "YYYY-MM-DD",
    "source": "visible page comparison"
  }
}
```

Rules:

- Append new mappings with `webcmd site field-map add <site> <key> --meaning <meaning> --source <source>`.
- Do not overwrite existing keys without visible-page proof.
- If a conflict appears, compare against the visible page and record the decision with `webcmd site note add`.

## `notes.md`

Add a dated note for each run with `webcmd site note add <site> --text <markdown>`:

```md
## YYYY-MM-DD by <agent/user>

- What changed:
- New endpoint evidence:
- Field decoding evidence:
- Pitfalls:
- Follow-up:
```

Notes should capture decisions that future agents would otherwise rediscover.

## `verify/<cmd>.json`

This is the `webcmd browser verify` fixture.

It should include:

- args
- rowCount
- columns
- types
- patterns
- notEmpty
- mustNotContain
- mustBeTruthy

Read it with `webcmd site fixture get <site>/<cmd>` and write the tightened file with `webcmd site fixture put <site>/<cmd> <path>` after the first passing run.

Example:

```json
{
  "args": { "limit": 3 },
  "expect": {
    "rowCount": { "min": 1, "max": 3 },
    "columns": ["rank", "tid", "title", "url"],
    "types": {
      "rank": "number",
      "tid": "string|number",
      "title": "string",
      "url": "string"
    },
    "patterns": {
      "url": "^https://www\\.example\\.com/thread-"
    },
    "notEmpty": ["title", "url"],
    "mustNotContain": {
      "title": ["breadcrumb:", "category:"]
    },
    "mustBeTruthy": ["rank"]
  }
}
```

Field rules:

- `args` controls how verify invokes the adapter. Use an object such as `{ "limit": 3 }` for named flags; verify expands it to `--limit 3`.
- Use an array such as `["1234567", "--limit", "3"]` for positional-subject adapters (`<tid>`, `<url>`, `<query>`). The array is appended exactly as written. Do not encode a positional subject as `{ "tid": "1234567", "limit": 3 }`, because that becomes `--tid 1234567 --limit 3`.
- `expect.rowCount.{min,max}` is inclusive. Stable list APIs should use a tight range; dynamic feeds can use a wider range.
- `expect.columns` is strict. Each row must contain every listed key.
- `expect.types` supports `|` unions such as `string|null` and the `any` wildcard for intentionally variable fields.
- `expect.patterns` uses regular expression strings. Remember to escape backslashes as `\\`.
- `expect.notEmpty` trims string values and fails when core business fields are empty.
- `expect.mustNotContain` is `Record<column, string[]>`. It blocks soft contamination such as a `description` that accidentally includes neighboring `address:` or `category:` text.
- `expect.mustBeTruthy` lists columns whose values must be JavaScript truthy. Use it to catch silent `|| 0`, `|| false`, or empty-string fallbacks that `notEmpty` can miss on numeric or boolean business fields.

Fixture workflow:

- Tighten the saved fixture with URL/date/ID patterns, core-field `notEmpty`, contamination guards in `mustNotContain`, truthiness guards in `mustBeTruthy`, and a realistic `rowCount`, then write it back with `webcmd site fixture put`.
- For positional-subject adapters, handwrite or correct `args` as an array because the seed cannot infer the subject shape.
- If a site change makes the fixture stale, compare at least one visible page value before running `--update-fixture`.
- Do not loosen fixtures just to make verify pass. A failed pattern or guard is evidence to check the adapter output first; accepting wrong data by weakening the fixture defeats the fixture.

## `fixtures/<cmd>-<YYYYMMDDHHMM>.json`

Store a sanitized response sample for field decoding and offline replay with `webcmd site sample add <site>/<cmd> <path>`.

Rules:

- Remove cookies, tokens, account identifiers, private messages, emails, and private user data.
- Keep enough response shape to decode fields later.
- Prefer local memory for raw samples; commit repo fixtures only when they are intentional tests.

## In-Repo Seeds

In-repo seeds are public knowledge only. They may contain:

- public domains
- known endpoint shapes
- non-secret header requirements
- field-code conventions
- adapter references
- pitfalls that apply to any user

They must not contain:

- private credentials
- tokens
- cookies
- user-specific IDs
- scraped private content

If `references/site-memory/<site>.md` is absent, proceed with local memory only.
