# Success-Rate Pitfalls

These are silent failures where `webcmd browser verify` can pass while the data is wrong. Check this file during field decoding and visible-page comparison.

## 1. Wrong Unit Scale

Symptoms:

- Value is 100x, 1,000x, or 10,000x off.
- Percentage appears as `0.025` in source but output claims `0.025%` instead of `2.5%`.

Fix:

- Decide the output scale.
- Document it.
- Compare with a visible page value.

## 2. Seconds Versus Milliseconds

Symptoms:

- Dates land in 1970 or far future.
- Time sorting looks wrong.

Fix:

- Inspect timestamp length.
- Convert seconds with `* 1000`; leave milliseconds as-is.
- Keep timezone clear.

## 3. Page-Level Selector In Repeated Cards

Symptoms:

- Every row has the same author, count, button state, or URL.

Fix:

- Scope selectors to the row/card root.
- Add a JSDOM fixture for repeated-card parsing.

## 4. Hidden Template Content

Symptoms:

- Output includes rows not visible on the page.
- Text contains modal, template, or navigation labels.

Fix:

- Filter hidden elements.
- Prefer semantic row roots over broad text extraction.

## 5. Locale-Dependent Labels

Symptoms:

- Parser works in one locale and fails in another.
- `aria-label` or button text changes.

Fix:

- Prefer stable attributes or structure.
- If text is unavoidable, support known variants and fixture them.

## 6. Analytics Or Recommendation APIs

Symptoms:

- JSON endpoint exists but rows do not match visible results.
- API returns personalized or experiment data.

Fix:

- Verify target data against the visible page.
- Reject `api_candidates` marked `noise`.

## 7. Empty Success

Symptoms:

- Adapter returns `[]` when selectors changed, auth expired, or endpoint returned HTML.

Fix:

- Throw `EmptyResultError` only when the site truly reports no results.
- Throw typed errors for auth, timeout, parse, or shape failures.

## 8. Silent Clamp

Symptoms:

- Invalid `limit`, page number, or date silently changes to a default.

Fix:

- Throw `ArgumentError` for invalid external args.
- Clamp only when the command explicitly documents clamping.

## 9. Column Drift

Symptoms:

- `columns` contains a field that rows do not return.
- Row contains extra fields not documented in `columns`.

Fix:

- Keep `columns` and row keys exactly aligned.
- Add fixture checks for columns and types.

## 10. Auth State Misread

Symptoms:

- Logged-out page returns marketing content but parser treats it as data.
- Endpoint returns login HTML with status 200.

Fix:

- Detect login walls.
- Throw `AuthRequiredError`.
- Check response content type and expected shape.

## 11. Fixture Too Loose

Symptoms:

- Verify passes even after a parser regression.
- Patterns only check that some string exists.

Fix:

- Add `notEmpty` for core fields.
- Add URL/date/ID patterns.
- Tighten `rowCount`.
- Reverse-validate important parser tests.
