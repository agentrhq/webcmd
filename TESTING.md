# Testing webcmd

## Core Checks

```bash
npm run typecheck
npm run build
npm test
```

## Focused Checks

```bash
npx vitest run --project unit src/skills.test.ts
npx vitest run --project unit src/package-exports.test.ts
npx vitest run --project unit src/convention-audit.test.ts src/runtime-copy.test.ts
```

## Cloak Runtime Smoke

Run:

```bash
npx vitest run --project e2e tests/e2e/cloak-runtime.test.ts
```

The first run may download the CloakBrowser Chromium binary. Browser-backed tests no longer require a Chrome extension.

## Rebrand Audit

Run `src/rebrand-metadata.test.ts` before publishing docs or workflow changes.
