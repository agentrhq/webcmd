# Testing webcmd

## Core Checks

```bash
npm run typecheck
npm run build
npm test
```

The core package contains no site adapters; `npm test` runs the unit project.
Public adapter tests live in `agentrhq/webcmd-plugins`.

Local browser coverage stays split on purpose: Cloak remains the default and
bundled runtime, SLAB is the macOS alpha opt-in path, and custom absolute
executables reuse the Cloak-compatible runtime with separate profile data.

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
```

## SLAB Runtime Smoke

Run:

```bash
npx vitest run --project unit src/slab src/browser/runtime/local-slab
```

These tests use the local SLAB control contract and do not download or launch a browser.

## Browser Selection Checks

Run:

```bash
npx vitest run --project unit src/doctor.test.ts src/hosted/setup.test.ts
```

These checks cover bundled Cloak fallback, explicit Cloak, custom absolute
browser paths, `setup --status`, and doctor output for the selected browser.
