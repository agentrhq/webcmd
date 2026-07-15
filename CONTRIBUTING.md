# Contributing To webcmd

## Setup

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Adapter Imports

Adapters must import public APIs from `@agentrhq/webcmd`:

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
```

## Local State

User adapters, plugins, cache, traces, and site memory live under `~/.webcmd`.

## Documentation Sync Review

Every pull request receives one advisory comment checking whether user-facing changes are reflected in `README.md`, `docs/`, and bundled `skills/`. The comment is updated after new commits and reports one of three verdicts:

- 🟢 no documentation gap found
- 🟠 maintainer review suggested
- 🔴 documentation update likely missing

The verdict never blocks merging. Maintainers can apply the `docs-not-needed` label when a change intentionally requires no documentation or skill update.
