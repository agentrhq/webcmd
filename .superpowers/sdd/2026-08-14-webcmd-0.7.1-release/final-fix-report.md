# Final fix wave

## TDD evidence

RED: `npm test -- src/hosted/client.test.ts src/hosted/file-contract.test.ts src/hosted/runner.test.ts plugins/instagram/test/private-publish.test.js` failed as expected for Cloud stale/delete envelopes, missing GeoGebra defaults, hosted adapter group help, and default Instagram preparation guardrails.

GREEN: `npm test -- src/hosted/client.test.ts src/hosted/file-contract.test.ts src/hosted/files.test.ts src/hosted/runner.test.ts plugins/geogebra/test/geogebra.test.js plugins/instagram/test/private-publish.test.js` passed: 279 tests.

## Fixes

- Accept Cloud's successful `{ ok: true, stale: true }` and `{ ok: true, deleted: true }` site-memory deletion envelopes.
- Reserve default hosted GeoGebra screenshot outputs for no-argument triangle and hexagon commands.
- Reject image padding and story video trimming requirements with `INSTAGRAM_MEDIA_CONVERSION_REQUIRED` before upload.
- Route hosted `webcmd adapter --help` to its local command-group help and document truthful local adapter-source semantics.

## Release gate

- `npm test` — 442 files passed; 5,625 passed, 1 skipped.
- `npm run build` — passed.
- `npm pack --dry-run` — passed.
- `git diff --check` — passed.

## Follow-up: local adapter-source semantics

RED: `npm test -- src/cli.test.ts src/skills.test.ts` failed because local adapter-source help still claimed it could read/write source and the authoring guidance told local users to use ignored `get|put` options.

GREEN: `npm test -- src/cli.test.ts src/skills.test.ts src/docs-sync-review.test.ts` passed: 165 tests.

The local CLI and authoritative authoring guidance now say to use `adapter path` and edit the returned file; `adapter source get|put` is explicitly WebCMD Cloud behavior. The mode-neutral autofix skill identifies Cloud without presenting a mode selector.

Follow-up release gate: `npm test` passed (442 files; 5,627 passed, 1 skipped), and `npm run build`, `npm pack --dry-run`, and `git diff --check` passed.
