# Field Decode Playbook

Use this when a response contains unclear field names or numeric codes.

## First Pass

1. Save a response sample in `~/.webcmd/sites/<site>/fixtures/` after removing cookies, tokens, and private user data.
2. Identify which fields are self-explanatory.
3. Check `field-conventions.md` and `~/.webcmd/sites/<site>/field-map.json`.
4. Compare at least one row against the visible page.

Do not guess a field meaning and ship it as a polished column.

## Technique 1 - Sort-Key Comparison

Change the site's sort order in the UI, or change known query params, then compare response fields.

Example workflow:

```bash
webcmd browser open <url>
webcmd browser wait xhr '<endpoint-fragment>'
webcmd browser network --format json
```

Look for fields that move with:

- rank
- date
- score
- price
- volume
- rating
- comment count

If sorting by "newest" changes field `created_at`, that field is likely timestamp-like. If sorting by "comments" changes field `num_comments`, that field is likely a comment count.

## Technique 2 - Visible-Value Matching

Pick a row with distinctive values on the page, then locate matching values in the response.

Use distinctive anchors:

- uncommon title text
- exact count
- exact price
- exact date
- unique username
- canonical URL slug

Avoid common values such as `0`, `1`, `true`, `false`, and repeated category names.

## Technique 3 - Structural Diff

Fetch two similar pages or two different query params, then compare response shapes.

Useful differences:

- same query with different sort
- same endpoint with different page number
- same entity with expanded details
- logged-in versus logged-out state when allowed

Fields that change with the entity are likely content fields. Fields that stay constant across unrelated entities are likely config, experiment, or metadata.

## Technique 4 - Constant Checks

Before mapping a field, check whether it is constant across rows.

- If a field is constant across all rows, it may be source metadata, locale, currency, or feature flag.
- If a field is null for most rows, it may be optional. Use a union type only when that optionality is real.
- If a field changes only with the request, it may be a query echo rather than a row value.

## Technique 5 - Unit Checks

Common silent failures:

- value differs by 100 because the source already uses decimal percentages
- value differs by 1,000 or 10,000 because source units are compacted
- timestamps are seconds versus milliseconds
- money lacks currency
- local time is parsed as UTC

Record unit decisions in `output-design.md` style notes or site memory.

## When Still Unsure

If a field remains unclear:

- Expose it as a clearly named raw field only if users need it.
- Otherwise omit it from final columns.
- Add a note to `~/.webcmd/sites/<site>/notes.md`.
- Keep the fixture so the next decoding pass starts from evidence.

Never silently map an unknown field to a confident business name.
