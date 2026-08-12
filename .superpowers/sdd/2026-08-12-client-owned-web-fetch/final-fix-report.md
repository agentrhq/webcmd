# Final web-fetch isolation fix

- Moved shared argument preparation into `command-surface.ts`; `execution.ts` re-exports it for compatibility.
- `commanderAdapter.ts` now imports the generic executor only for non-client-owned commands. Client-owned non-browser commands call their function directly.
- Added `runWebFetchCommand()` with only root grammar and `web fetch`; `main.ts` uses it instead of loading `cli.ts`.
- The fetch-only runner also accepts hosted `--workspace <id>` structurally and ignores it.
- Removed the unrelated `*.png binary` attribute.

## Verification

- `npx vitest run src/fetch/command.test.ts src/commanderAdapter.test.ts src/execution.test.ts src/root-command-surface.test.ts` — 70 tests passed (the requested root test path is absent and Vitest ignored it).
- `npm run typecheck` — passed.
- `npm run check:package-bin` — passed.
- `npm run build && node dist/src/main.js --workspace test-workspace web fetch --url https://example.com --timeout 3 -f json` — passed.

## Regression coverage

`src/fetch/command.test.ts` mocks `../execution.js` to throw on import and confirms `runWebFetchCommand` fetches successfully with root `--profile` and hosted `--workspace` options.
