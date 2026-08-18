# Browser Run Details

## The runtime is QuickJS, not Node and not the page

`browser run` executes your program in a QuickJS sandbox. `page`, `context`, and `browser`
are Playwright handles that drive a browser running somewhere else — they are not evidence
that you are inside that browser, and not evidence that you are inside Node.

Two consequences produce almost every `browser run` failure:

- **Anything DOM-shaped must go inside `page.evaluate()`.** `document`, `window`, and
  `localStorage` are not in your scope. `document.querySelector(...)` at the top level
  throws `'document' is not defined`; `await page.evaluate(() => document.querySelector(...))`
  works, because that callback is serialized and run in the page.
- **Anything Node-shaped does not exist.** No `require`, no `import` of host modules, no
  `fs`, no `Buffer`, no `process`.

Browser state in the bound session persists between runs. JavaScript variables and handles
do not — each run starts with a fresh scope.

## What is available

| Need | Use |
|---|---|
| Drive the page | `page`, `context`, `browser` (Playwright) |
| Read or manipulate the DOM | `page.evaluate(() => …)` |
| Find elements | `page.locator(selector)`, `page.getByRole(...)`, and the other `getBy*` locators |
| Log | `console` |
| Return data | `return` any JSON-compatible value |

`page.$` and `page.$$` work, but prefer `page.locator()` — it retries and auto-waits.

`context.newPage()` works and creates a tab the Webcmd session tracks. You cannot close it
from inside `run` (see below); list tabs with `webcmd --session <session-id> browser tabs`.

`page.snapshotForAI()` is not available; use `webcmd browser snapshot` instead.

## What is blocked, and what to use instead

These throw `BROWSER_RUN_API_UNSUPPORTED` because page and context ownership belongs to the
Webcmd session, not to your program:

| Blocked | Instead |
|---|---|
| `page.close()` | Leave the tab open, or `webcmd session close <session-id>` |
| `context.close()`, `browser.close()` | `webcmd session close <session-id>` |
| `browser.newContext()` | `webcmd session create` — one run is scoped to one context |
| `browser.newBrowserCDPSession()`, `context.newCDPSession()` | Not exposed inside `run` |
| `playwright.request` (`newRequest`) | `page.request` for calls in the page's context |

## Files and binary data

There is no host filesystem. Passing a host path to `setInputFiles` fails with
`File paths are unavailable in the QuickJS sandbox; use in-memory file payloads` — supply
`{ name, mimeType, buffer }` with a `Uint8Array` instead.

## Artifacts: getting bytes out of the sandbox

The only way to get a file out of a run is to write it as an artifact, using a **relative
logical filename** — absolute paths and `..` are rejected with `BROWSER_RUN_INVALID_INPUT`.

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

`BROWSER_RUN_*` errors name invalid input, unsupported Playwright calls, timeouts, output
limits, or serialization failures. A timeout can include
`BROWSER_RUN_SIDE_EFFECTS_MAY_HAVE_OCCURRED`; inspect the page state before retrying a write.

A rejection phrased `QuickJS promise rejected: 'X' is not defined` means `X` is a Node or DOM
global that the sandbox does not provide — check the two tables above before retrying.

## Snapshot behavior

Use `webcmd --session <session-id> browser snapshot --snapshot-mode act` to inspect actionable controls, `--snapshot-mode tree` for fuller page structure, or `--snapshot-mode read` for readable article/content text. Successful runs return `snapshotDiff` automatically and support `--snapshot-mode act|tree`. Pass `--no-snapshot-diff` for research or deterministic inspection when the result returns the exact bounded evidence needed, including navigation followed by targeted extraction or response capture. Navigation alone does not require a diff. Keep the automatic diff for exploratory or state-changing interactions whose outcome is not independently verified by the returned result. If a requested diff exceeds the output ceiling, Webcmd omits it and returns a warning; continue when the explicit result is sufficient, otherwise use a targeted snapshot or extraction. A failed post-run snapshot becomes a warning, not a successful result change.

## Timing

Run results include timing fields such as `quickjs_boot_ms`, `client_bundle_init_ms`, `program_ms`, `browser_wait_ms`, and `snapshot_ms`. `--timeout <seconds>` limits the complete run; `--max-output <characters>` bounds returned data and logs.

## Hosted mode

Hosted `browser run` uses the same QuickJS sandbox and the same rules. Only the browser on
the far end differs — hosted runs drive a Browser Use browser over CDP rather than local
Cloak. Programs that work locally work hosted; the tables above apply in both modes.
