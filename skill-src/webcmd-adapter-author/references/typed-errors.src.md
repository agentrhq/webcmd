# Typed Errors

Read this before writing the adapter `func` or any complex `evaluate` parser. Known failure paths must produce typed errors, not silent success.

## Error Classes

Import from `@agentrhq/webcmd/errors`:

```js
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@agentrhq/webcmd/errors';
```

## Which Error To Throw

| Failure | Error |
| --- | --- |
| Invalid user argument | `ArgumentError` |
| Login required, session expired, paywall for required data | `AuthRequiredError` |
| Valid query but site reports no results | `EmptyResultError` |
| Page or endpoint did not settle in time | `TimeoutError` |
| Unexpected response shape, parse failure, selector drift, endpoint returned HTML, unsupported state | `CommandExecutionError` |

## `ArgumentError`

Use for invalid external parameters:

- negative `limit`
- unknown sort key
- malformed date
- unsupported region
- missing required argument

Do not silently replace invalid values with defaults.

## `AuthRequiredError`

Use when the command cannot proceed without user auth:

- login wall
- expired session
- endpoint returns auth-required code
- public page hides required data until login

Tell the user what to do, such as logging in through the browser session.

## `EmptyResultError`

Use only for a true no-results state:

- site displays "no results"
- endpoint returns a valid empty result for the query
- pagination reaches a real end

Do not use `EmptyResultError` for selector drift, auth, or parse failure.

## `TimeoutError`

Use when waiting fails:

- XHR never arrives
- selector never appears
- streaming response does not produce data in time

Include what was being waited for.

## `CommandExecutionError`

Use for all other command failures:

- response is HTML instead of JSON
- JSON shape changed
- parser cannot find required fields
- field decoding proves inconsistent
- page structure changed
- unsupported site state

Include enough context for the next agent to reproduce.

## Silent Anti-Patterns

### Silent Clamp

Bad:

```js
const limit = Math.min(Math.max(Number(args.limit || 20), 1), 100);
```

Good:

```js
const limit = Number(args.limit ?? 20);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new ArgumentError('limit must be an integer from 1 to 100');
}
```

### Sentinel Row

Bad:

```js
return [{ title: 'No results', url: '' }];
```

Good:

```js
throw new EmptyResultError('No results for the query');
```

### Generic `CliError`

Bad:

```js
throw new CliError('failed');
```

Good:

```js
throw new CommandExecutionError('Expected JSON response but received HTML login page');
```

## Final Checklist

Before verify:

- [ ] Invalid args throw `ArgumentError`.
- [ ] Login walls throw `AuthRequiredError`.
- [ ] Real no-results state throws `EmptyResultError` or returns `[]` only if that is the adapter convention and clearly valid.
- [ ] Timeouts throw `TimeoutError`.
- [ ] Shape, parse, and selector failures throw `CommandExecutionError`.
- [ ] No silent clamp.
- [ ] No sentinel row.
- [ ] No generic catch that hides the original failure.
