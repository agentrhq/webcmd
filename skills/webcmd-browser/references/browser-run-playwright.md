# Browser Run Details

## Sandbox boundaries

`run` evaluates the supplied JavaScript in a fresh sandbox. Browser state in the bound session persists, but JavaScript variables and handles do not. `page`, `context`, `browser`, and `console` are normal Playwright globals; use the vendored Playwright client as the API reference. Return only JSON-compatible data. `page.snapshotForAI()` is not available.

`context.newPage()` is not available inside `run`; create or bind Session tabs through Webcmd commands so page ownership stays deterministic.

## Artifacts: getting bytes out of the sandbox

There is no host filesystem. The only way to get a file out of a run is to write it as an
artifact, using a **relative logical filename** — absolute paths and `..` are rejected with
`BROWSER_RUN_INVALID_INPUT`.

### Writing one

```js
const receipt = await writeArtifact('report.csv', new TextEncoder().encode(csv), 'text/csv');
return receipt;
```

`writeArtifact(filename, bytes, contentType?)` takes a `Uint8Array` and resolves to the
receipt. `contentType` is optional and defaults to `application/octet-stream` for anything
that is not `.png`/`.jpg` — pass it explicitly when it matters. `__webcmdWriteArtifact` is a
legacy alias for the same function.

Two other calls write artifacts for you: `page.screenshot({ path: 'shot.png' })` and
`download.saveAs('out.csv')`. Both take the same relative logical filename.

### Capturing a download

`download.createReadStream()` throws — Readable streams do not exist in the sandbox. Use
`saveAs` with a relative name instead; it routes through the artifact sink:

```js
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Convert' }).click(),
]);
await download.saveAs(download.suggestedFilename());
return { saved: download.suggestedFilename() };
```

Do not scrape an on-page preview as a substitute for the downloaded bytes — it will not match.

### Redeeming a receipt

Every artifact written during a run appears in the run result's `artifacts` array, whether it
came from `writeArtifact`, `saveAs`, or `screenshot`:

```json
{
  "artifactId": "artifact_9d1f6368490aa37a22a18426",
  "filename": "downloads/out.csv",
  "contentType": "application/octet-stream",
  "byteSize": 12,
  "locator": "browser-run://artifact_9d1f6368490aa37a22a18426/downloads%2Fout.csv"
}
```

Locally the bytes land at `~/.webcmd/cache/browser-run/<artifactId>/<filename>` (under
`$WEBCMD_CACHE_DIR/browser-run` when that is set), readable once `run` has returned. Hosted
runs use the same receipt shape with a `cloud-artifact://` locator backed by the execution's
trace artifact store. The receipt never carries the bytes themselves, so return the receipt —
or just read it off `artifacts` — rather than trying to return file contents through `result`.

## Errors

`BROWSER_RUN_*` errors name invalid input, unsupported Playwright calls, timeouts, output limits, or serialization failures. A timeout can include `BROWSER_RUN_SIDE_EFFECTS_MAY_HAVE_OCCURRED`; inspect the page state before retrying a write.

## Snapshot behavior

Use `webcmd --session <session-id> browser snapshot --snapshot-mode act` to inspect actionable controls, `--snapshot-mode tree` for fuller page structure, or `--snapshot-mode read` for readable article/content text. Successful runs return `snapshotDiff` automatically and support `--snapshot-mode act|tree`; pass `--no-snapshot-diff` only for pure read-only code when its result already contains the needed state. A failed post-run snapshot becomes a warning, not a successful result change.

## Timing

Run results include timing fields such as `quickjs_boot_ms`, `client_bundle_init_ms`, `program_ms`, `browser_wait_ms`, and `snapshot_ms`. `--timeout <seconds>` limits the complete run; `--max-output <characters>` bounds returned data and logs.
