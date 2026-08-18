# Browser Run Details

## Sandbox boundaries

`run` evaluates the supplied JavaScript in a fresh sandbox. Browser state in the bound session persists, but JavaScript variables and handles do not. `page`, `context`, `browser`, and `console` are normal Playwright globals; use the vendored Playwright client as the API reference. Return only JSON-compatible data. `page.snapshotForAI()` is not available.

`context.newPage()` is not available inside `run`; create or bind Session tabs through Webcmd commands so page ownership stays deterministic.

## Artifact paths

Artifacts written by Playwright must use a relative logical filename. Webcmd returns an artifact receipt with its locator; it does not grant host-path write access.

## Errors

`BROWSER_RUN_*` errors name invalid input, unsupported Playwright calls, timeouts, output limits, or serialization failures. A timeout can include `BROWSER_RUN_SIDE_EFFECTS_MAY_HAVE_OCCURRED`; inspect the page state before retrying a write.

## Snapshot behavior

Use `webcmd --session <session-id> browser snapshot --snapshot-mode act` to inspect actionable controls, `--snapshot-mode tree` for fuller page structure, or `--snapshot-mode read` for readable article/content text. Successful runs return `snapshotDiff` automatically and support `--snapshot-mode act|tree`. Pass `--no-snapshot-diff` for research or deterministic inspection when the result returns the exact bounded evidence needed, including navigation followed by targeted extraction or response capture. Navigation alone does not require a diff. Keep the automatic diff for exploratory or state-changing interactions whose outcome is not independently verified by the returned result. If a requested diff exceeds the output ceiling, Webcmd omits it and returns a warning; continue when the explicit result is sufficient, otherwise use a targeted snapshot or extraction. A failed post-run snapshot becomes a warning, not a successful result change.

## Timing

Run results include timing fields such as `quickjs_boot_ms`, `client_bundle_init_ms`, `program_ms`, `browser_wait_ms`, and `snapshot_ms`. `--timeout <seconds>` limits the complete run; `--max-output <characters>` bounds returned data and logs.
