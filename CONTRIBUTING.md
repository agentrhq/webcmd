# Contributing To webcmd

## Setup

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Community adapters

Public site adapters live in [`agentrhq/webcmd-plugins`](https://github.com/agentrhq/webcmd-plugins), not this repository.

## Adapter Imports

Adapters must import public APIs from `@agentrhq/webcmd`:

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
```

## Local State

User adapters, plugins, cache, traces, and site memory live under `~/.webcmd`.

## Documentation

The published docs at [webcmd.dev/docs](https://webcmd.dev/docs) are built by Mintlify from the `docs/` directory in this repo. To change the published docs, edit the `.mdx` pages under `docs/` (and `docs/docs.json` for navigation) — do not edit the site directly.

## Authoring Skills

Edit `skill-src/`, not `skills/`. Author-only notes live in `<!-- @ ... -->` blocks and are stripped by [litprompt](https://github.com/tgvashworth/litprompt) on the way out.

```bash
make install-tool   # once: go install github.com/tgvashworth/litprompt@latest
make build          # skill-src/**/*.src.md -> skills/**/*.md
make verify         # fail if skills/ is stale or orphaned
```

Commit both the source and the generated output. The convention, learnings-log format, and gotchas are in [`skill-src/README.md`](skill-src/README.md).

## Documentation Sync Review

Every pull request receives one advisory comment checking whether user-facing changes are reflected in `README.md`, `docs/`, and bundled `skills/`. The comment is updated after new commits and reports one of three verdicts:

- 🟢 no documentation gap found
- 🟠 maintainer review suggested
- 🔴 documentation update likely missing

The verdict never blocks merging. Maintainers can apply the `docs-not-needed` label when a change intentionally requires no documentation or skill update.
