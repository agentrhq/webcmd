# Field Conventions

Use this file when response fields are coded, abbreviated, or inconsistent across adapters.

## Naming Rules

- Output column names use `camelCase`.
- Prefer clear domain names over source field codes.
- Keep units out of names unless the unit is part of the semantic contract.
- Use the same names as neighboring adapters when the same concept appears.
- Do not expose raw source codes as output columns unless the raw code is itself useful to users.

## Common Column Names

| Concept | Preferred column |
| --- | --- |
| Display title | `title` |
| URL | `url` |
| Author or owner | `author` |
| Username or handle | `handle` |
| Description or snippet | `description` or `snippet` |
| Published date/time | `publishedAt` |
| Updated date/time | `updatedAt` |
| Score/rank | `score` or `rank` |
| Comment count | `commentCount` |
| Star count | `starCount` |
| Fork count | `forkCount` |
| Like count | `likeCount` |
| View count | `viewCount` |
| Duration | `duration` |
| Price | `price` |
| Currency | `currency` |
| Rating | `rating` |
| Location | `location` |
| Source site | `source` |

## Financial Columns

Use finance names only for finance adapters:

| Concept | Preferred column |
| --- | --- |
| Symbol | `symbol` |
| Company name | `name` |
| Current price | `price` |
| Price change | `change` |
| Percentage change | `changePercent` |
| Open price | `open` |
| High price | `high` |
| Low price | `low` |
| Previous close | `previousClose` |
| Volume | `volume` |
| Market cap | `marketCap` |

Percentages should be documented in output design. If the source gives `0.025`, decide whether the output should be `0.025` or `2.5` and keep it consistent across the adapter.

## Date And Time

- Prefer ISO 8601 strings for exact timestamps.
- Use date-only strings for date-only source fields.
- Include timezone in docs or notes when the source uses a local timezone.
- Do not silently parse unknown date formats into wrong dates.

## IDs And URLs

- Keep stable source IDs when they help users join data.
- Normalize absolute URLs when the source returns relative paths.
- Do not manufacture IDs from row position unless the docs say the ID is synthetic.

## Raw Field Codes

When a field code is already known, map it here or in `~/.webcmd/sites/<site>/field-map.json`:

```json
{
  "fieldCode": {
    "meaning": "human readable meaning",
    "verified_at": "YYYY-MM-DD",
    "source": "visible page comparison or official docs"
  }
}
```

Rules:

- Append new field-code meanings.
- Do not overwrite an existing meaning without visible-page proof.
- If two sources disagree, trust the visible page and record the conflict in `notes.md`.
- When a code is unknown, use `field-decode-playbook.md`.
