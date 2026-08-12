# Testing webcmd

## Core Checks

```bash
npm run typecheck
npm run build
npm run build-plugin-manifest
npm test
```

`npm run build` must run before plugin tests because repository plugins import
the compiled public package exports. The core package contains no site
adapters; `npm test` runs the unit and generic plugin projects.

## Focused Checks

```bash
npx vitest run --project unit src/skills.test.ts
npx vitest run --project unit src/package-exports.test.ts
npx vitest run --project unit src/convention-audit.test.ts src/runtime-copy.test.ts
npm run test:plugin -- --reporter=verbose
```

## Cloak Runtime Smoke

Run:

```bash
npx vitest run --project e2e tests/e2e/cloak-runtime.test.ts
```

The first run may download the CloakBrowser Chromium binary. Browser-backed tests no longer require a Chrome extension.
