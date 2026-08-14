# Task 8: Authoring Skill Documentation

## Changes

- Replaced direct site-memory and adapter-source mutation guidance with `webcmd site`, `webcmd adapter source`, `webcmd adapter path`, and browser scaffold/verify commands.
- Updated the authoring references, autofix skill, and community-plugin guide.
- Added the required hosted-authoring command assertions to `src/skills.test.ts`.

## TDD Evidence

- RED: `npm test -- src/skills.test.ts` failed in `teaches CLI-based hosted adapter authoring` because `webcmd site memory` was absent.
- GREEN: `npm test -- src/skills.test.ts` passed: 14 tests in 1 file.

## Scope

- No runtime dependencies or version changes.
- Pre-existing `docs/readme-hero.png` and `package-lock.json` changes were not touched or staged.
