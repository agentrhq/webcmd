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

The verdict never blocks merging. Findings cite changed files and suggest the documentation surface that may need an update. Maintainers can apply the `docs-not-needed` label when a change intentionally requires no documentation or skill update.

The workflow uses GitHub's generated token for pull request data and comments. Semantic review uses the repository Actions secret `GEMINI_API_KEY`; `GEMINI_DOCS_REVIEW_MODEL` can optionally select a different Gemini model through an Actions repository variable. If Gemini is not configured or temporarily unavailable, the comment reports an orange unavailable result instead of failing the workflow.

For fork safety, the privileged workflow runs only the analyzer and locked dependencies from the default branch. It reads contributor diffs through GitHub's API and never checks out or executes code from the pull request branch.
