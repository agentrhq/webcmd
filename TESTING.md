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

## Skill Sources

Bundled skills are generated from `skill-src/` with litprompt. After editing a
`*.src.md` file:

```bash
make build
make verify
```

## Focused Checks

```bash
npx vitest run --project unit src/skills.test.ts
npx vitest run --project unit src/package-exports.test.ts
npx vitest run --project unit src/convention-audit.test.ts src/runtime-copy.test.ts
npm run test:plugin -- --reporter=verbose
```

## SLAB Runtime Smoke

Run:

```bash
npx vitest run --project unit src/slab src/browser/runtime/local-slab
```

These tests use the local SLAB control contract and do not download or launch a browser.
