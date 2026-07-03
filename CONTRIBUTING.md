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
