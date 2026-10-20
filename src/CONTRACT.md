# PilgrimOS PC 2A Core Contract

This contract is the seam between PC 2A (engine) and PC 2B (Temple / Travel / Hotel adapters).
Do not put domain logic in this package.

## BrowserManager

```ts
BrowserManager.startSession(name?) -> Promise<BrowserSession>
BrowserManager.navigate(session, url) -> Promise<PageState>
BrowserManager.readPage(session) -> Promise<PageState>
BrowserManager.closeSession(session) -> Promise<void>
BrowserManager.pauseSession(session) -> void
```

`pauseSession()` is an in-memory safety boundary. While paused, navigation/read calls throw. It does not close or destroy the Webcmd session, allowing an upstream HITL flow to resume or clean up it safely.

`PageState`:

```ts
{
  url: string;
  title: string;
  content: string;
  content_found: boolean;
}
```

## AdapterBase

```ts
abstract class AdapterBase<TInput extends AdapterInput, TData> {
  readonly adapter: string;
  abstract run(input: TInput): Promise<StandardResult<TData>>;
}
```

A domain adapter should return `StandardResult` for every completed/failed/partial path and never leak raw Webcmd errors to callers.

## StandardResult

```json
{
  "success": true,
  "status": "completed",
  "adapter": "temple",
  "action": "check_availability",
  "data": {},
  "metadata": {
    "source": "",
    "timestamp": ""
  },
  "error": null
}
```

Valid statuses are exactly:

`completed | searching | partial | failed | retrying | blocked | approval_required`

`error` is `null` on success and follows:

```ts
{
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
}
```

## Error codes

- `NAVIGATION_FAILED`
- `TIMEOUT`
- `ELEMENT_NOT_FOUND`
- `PAGE_CHANGED`
- `WEBSITE_UNAVAILABLE`
- `RATE_LIMITED`
- `LOGIN_REQUIRED`
- `CAPTCHA_DETECTED`
- `NO_AVAILABILITY`
- `INVALID_INPUT`
- `UNKNOWN_ERROR`

## Recovery

```ts
RecoveryManager.retry(fn, policy) -> Promise<result>
```

Default policy: 3 attempts, exponential backoff, bounded jitter.

Dangerous actions are never meant to enter recovery. The manager also rejects a policy marked `dangerousAction: true` as a defense in depth check. Payment, OTP, and final submit must be short-circuited upstream to `approval_required`.

## Webcmd boundary

PC 2B should not call the Webcmd CLI directly. Use `BrowserManager` and/or `WebcmdSkills`.
The client follows the current Webcmd CLI lifecycle: create a session, run browser programs against that explicit session, then close it.
