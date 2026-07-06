# Site Memory

Site memory prevents every adapter run from starting cold. It has two layers:

1. In-repo public seeds under `references/site-memory/<site>.md`, when a seed exists.
2. Local working memory under `~/.webcmd/sites/<site>/`.

Local memory is the main write target. Do not write private cookies, tokens, or user data into the repo.

## Directory Layout

```text
~/.webcmd/sites/<site>/
  endpoints.json
  field-map.json
  notes.md
  verify/
    <cmd>.json
  fixtures/
    <cmd>-<YYYYMMDDHHMM>.json
```

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
- Mark changed endpoints stale instead of deleting evidence silently.
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

- Append new mappings.
- Do not overwrite existing keys without visible-page proof.
- If a conflict appears, compare against the visible page and record the decision in `notes.md`.

## `notes.md`

Prepend a dated note for each run:

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

Write it after the first passing run, then tighten it manually and verify again.

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

- `--write-fixture` is only a seed. It usually writes `rowCount.min=1`, `columns`, and `types`; it does not know the business-specific `patterns`, `notEmpty`, `mustNotContain`, or `mustBeTruthy` checks.
- After generating the seed, tighten it manually with URL/date/ID patterns, core-field `notEmpty`, contamination guards in `mustNotContain`, truthiness guards in `mustBeTruthy`, and a realistic `rowCount`.
- For positional-subject adapters, handwrite or correct `args` as an array because the seed cannot infer the subject shape.
- If a site change makes the fixture stale, compare at least one visible page value before running `--update-fixture`.
- Do not loosen fixtures just to make verify pass. A failed pattern or guard is evidence to check the adapter output first; accepting wrong data by weakening the fixture defeats the fixture.

## `fixtures/<cmd>-<YYYYMMDDHHMM>.json`

Store a sanitized response sample for field decoding and offline replay.

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
