# Output Design

Design output before writing the final adapter mapping. Good output is stable, scan-friendly, and consistent with neighboring adapters.

## Column Order

Use this order:

1. Identifier columns: `title`, `name`, `symbol`, `id`, `url`.
2. Primary business values: score, price, rank, counts, status, dates.
3. Supporting fields: author, source, category, tags, metadata.
4. Debug or raw fields only when they are user-relevant.

## Naming

- Use `camelCase`.
- Prefer user-facing meaning over source field code.
- Align with existing adapters for the same concept.
- Do not include units in names unless needed to avoid ambiguity.
- Avoid vague names like `value`, `data`, `info`, `num`, or `type` unless the domain makes them precise.

## Types

Use the narrowest honest type:

| Data | Type |
| --- | --- |
| text | `string` |
| count | `number` |
| price | `number` plus `currency` when needed |
| percent | `number` with documented scale |
| date/time | ISO string |
| URL | absolute string |
| optional value | `string|null` or `number|null` only when truly nullable |

Do not hide extraction failure by making every field nullable.

## Percentages And Units

State the scale once in comments or notes:

- `2.5` means 2.5 percent.
- `0.025` means ratio form.

Choose one scale and keep it consistent.

For compact units, normalize when possible:

- `1.2K` -> `1200`
- `3.4M` -> `3400000`
- currency values should include `currency` if the site can mix currencies

## Empty Results

Empty result is valid only when the site clearly returned no rows for the user's query. Otherwise throw a typed error.

Examples:

- Valid empty: search query has no matches and page says no results.
- Error: selector changed, auth expired, endpoint returned HTML, or field path failed.

## Output Verification

Before declaring the adapter ready:

- Check `columns` exactly match row object keys, including order.
- Compare one or more rows against the visible page.
- Verify numeric units and percentage scale.
- Verify dates and timezones.
- Run `webcmd browser verify <site>/<name>`.
- Add or update fixture assertions for `columns`, `types`, `patterns`, `notEmpty`, and `rowCount`.
