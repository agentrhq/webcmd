# Direct CDP `waitUntil: 'none'` Design

## Goal

Make `CDPPage.goto(url, { waitUntil: 'none' })` return after `Page.navigate`
instead of waiting up to 30 seconds for `Page.loadEventFired`, matching the
existing `IPage` contract and the Local Cloak fix in PR #107.

## Design

- Keep the existing `load` behavior when `waitUntil` is omitted or is `load`.
- For `waitUntil: 'none'`, send `Page.navigate` and skip the load-event wait.
- Keep existing DOM settling disabled for `none`.
- Add one focused regression test covering both `none` and default behavior.

## Scope

This changes only the direct-CDP runtime used by registered Electron apps.
Normal website adapters use the daemon-backed `Page`; hosted adapters use the
Kernel-backed page. No Zillow adapter exists in this repository, so no Zillow
file needs changing.

## Error Handling

`Page.navigate` errors continue to propagate. The existing load-event timeout
remains best-effort for default navigation and is not created for `none`.

## Non-Goals

- Adding `domcontentloaded` or `networkidle` options.
- Refactoring browser factories or the public page interface.
- Changing hosted Kernel navigation behavior.
