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
