# PC2B Adapter Contract

This document defines the stable contract between PC2A browser infrastructure and PC2B domain adapters. PC2B adapters may use generic browser operations, but must not add domain selectors or automate protected actions.

## BrowserManager

Import the manager and its public types from:

```ts
import {
  BrowserManager,
  type BrowserManagerOptions,
  type BrowserSession,
  type PageState,
} from './browser_manager.js';
```

The exact public method signatures are:

```ts
class BrowserManager {
  constructor(options?: BrowserManagerOptions);

  startSession(name?: string): Promise<BrowserSession>;
  navigate(session: BrowserSession, url: string): Promise<PageState>;
  readPage(session: BrowserSession): Promise<PageState>;
  pauseSession(session: BrowserSession, reason?: string): Promise<void>;
  resumeSession(session: BrowserSession): Promise<void>;
  closeSession(session: BrowserSession): Promise<void>;
  cleanupSession(
    session: BrowserSession,
    outcome?: 'completed' | 'failed' | 'cancelled',
  ): Promise<void>;
  runSmokeTest(url?: string): Promise<StandardResult<PageState>>;
}
```

`BrowserManagerOptions` is:

```ts
interface BrowserManagerOptions {
  client?: IWebcmdClient;
  api?: WebcmdClientApi;
  factory?: IBrowserFactory;
  sessionManager?: WebcmdSessionManager;
  profile?: string;
  sessionTimeoutMs?: number;
}
```

`pauseSession` preserves the live browser session for human handoff. It must not close the page, release the browser lease, or destroy the session. Completed and failed safe runs must call `closeSession` or `cleanupSession` in a `finally` path. A paused session may be closed by PC2B after handoff resolution; it must not be navigated or read until resumed.

`PageState` is safe, bounded visible state:

```ts
interface PageState {
  url: string;
  title: string;
  content: string;
  content_found?: boolean;
  isSensitive: boolean;
  sensitiveReason?: string;
  isPaused: boolean;
}
```

PC2A detects protected page markers and pauses before returning control to PC2B. PC2B must treat `isSensitive` or `isPaused` as a stop condition.

## AdapterBase

Import the base class and result type from:

```ts
import { AdapterBase } from './adapter_base.js';
import type { StandardResult } from './result_schema.js';
```

The adapter entry-point contract is:

```ts
abstract class AdapterBase<TInput = unknown, TOutput = Record<string, unknown>> {
  readonly adapterName?: string;
  abstract run(input: TInput): Promise<StandardResult<TOutput>>;
}
```

Every adapter action must return a `StandardResult`; raw Webcmd errors must not escape the adapter boundary.

## StandardResult

The canonical schema is exported from `./result_schema.js`:

```ts
interface StandardResult<T = Record<string, unknown>> {
  success: boolean;
  status: StandardResultStatus;
  adapter: string;
  action: string;
  data: T | null;
  metadata: {
    source: string;
    timestamp: string;
    [key: string]: unknown;
  };
  error: Record<string, unknown> | null;
}
```

All valid statuses are exactly:

```text
completed | searching | partial | failed | retrying | blocked | approval_required
```

Use `completed` only when the safe action finished. Use `failed` for an unsuccessful safe run, `partial` when only partial data is available, `blocked` when policy or capability prevents progress, `retrying` while reporting an in-progress retry state, `searching` while an adapter is actively searching, and `approval_required` when a human must take over.

The result helpers are also available from `./result_schema.js`:

```ts
createSuccessResult(adapter, action, data, source?, extraMetadata?)
createApprovalRequiredResult(adapter, action, reason, source?, extraMetadata?)
createFailureResult(adapter, action, errorCode, errorMessage, source?, details?, status?)
```

## ErrorCode

Import the enum-like map and type from `./error_handler.js`:

```ts
import { ErrorCode, ErrorHandler } from './error_handler.js';
```

The complete error-code list and meanings are:

| ErrorCode | Meaning |
| --- | --- |
| `NAVIGATION_FAILED` | The browser could not navigate to the requested URL. |
| `TIMEOUT` | An operation exceeded its allowed time. |
| `ELEMENT_NOT_FOUND` | A requested page element was not found. |
| `PAGE_CHANGED` | The page changed in a way that invalidated the expected state. |
| `WEBSITE_UNAVAILABLE` | The target site or service is unavailable. |
| `RATE_LIMITED` | The target service rejected or throttled the request rate. |
| `LOGIN_REQUIRED` | The page requires authentication that the adapter must not automate. |
| `CAPTCHA_DETECTED` | A CAPTCHA or bot-verification challenge was detected. |
| `NO_AVAILABILITY` | The requested safe availability data is not available. |
| `INVALID_INPUT` | Adapter input failed validation. |
| `UNKNOWN_ERROR` | The error does not match another standard category. |

`ErrorHandler.classify(error)` returns one of these exact values.

## Recovery policy

Import recovery from `./recovery.js`:

```ts
import { RecoveryManager, type RetryPolicy } from './recovery.js';
```

When no policy is supplied, `RecoveryManager.retry` uses:

```text
maxAttempts: 3
backoffMs: 10 milliseconds per attempt
```

The actual delay before attempt `n + 1` is `10 * n` milliseconds. A caller may override `maxAttempts`, `backoffMs`, or `actionName`.

Recovery is non-retryable and approval-gated for protected actions. The protected action keywords are:

```text
payment, pay, checkout, otp, two-factor, 2fa,
final-submit, final_submit, final submit,
confirm-booking, confirmation, confirm,
complete booking, authorize
```

Set `isProtected: true` for an action that reaches a protected boundary even if its name does not contain one of these keywords. CAPTCHA, login, credential, payment, OTP, checkout, final-submit, and booking-confirmation work must never be retried as automation.

## Protected-action rule

PC2B adapters must return `approval_required` before performing or attempting any OTP, payment, checkout, final-submit, or booking-confirmation action. They must also stop for CAPTCHA or login/authentication walls. No adapter may type credentials, enter OTPs, solve CAPTCHA, submit payment, confirm a booking, or perform an irreversible final submission.

A protected page may remain available for a human handoff through `pauseSession`. It must not be closed automatically until the handoff flow is finished or explicitly abandoned; safe completed and failed runs must always clean up.

## Future TempleAdapter example

This example demonstrates the contract only. The selector and extraction logic are intentionally left to the future PC2B implementation.

```ts
import { AdapterBase } from './adapter_base.js';
import {
  createApprovalRequiredResult,
  createFailureResult,
  createSuccessResult,
  type StandardResult,
} from './result_schema.js';
import { BrowserManager } from './browser_manager.js';
import { ErrorHandler } from './error_handler.js';

interface TempleInput {
  destination: string;
  date: string;
  portalUrl: string;
}

interface TempleData {
  destination: string;
  date: string;
  slots: unknown[];
}

export class TempleAdapter extends AdapterBase<TempleInput, TempleData> {
  readonly adapterName = 'temple';

  constructor(
    private readonly browser: BrowserManager,
    private readonly errors = new ErrorHandler(),
  ) {
    super();
  }

  async run(input: TempleInput): Promise<StandardResult<TempleData>> {
    const startedAt = Date.now();
    let session: Awaited<ReturnType<BrowserManager['startSession']>> | undefined;

    try {
      session = await this.browser.startSession('temple-safe-run');
      const page = await this.browser.navigate(session, input.portalUrl);

      if (page.isSensitive || page.isPaused) {
        await this.browser.pauseSession(session, page.sensitiveReason);
        return createApprovalRequiredResult(
          'temple',
          'check_availability',
          page.sensitiveReason ?? 'Protected page reached',
          'webcmd',
          { sessionId: session.id, durationMs: Date.now() - startedAt },
        ) as StandardResult<TempleData>;
      }

      const data: TempleData = {
        destination: input.destination,
        date: input.date,
        slots: [],
      };
      return createSuccessResult('temple', 'check_availability', data, 'webcmd', {
        sessionId: session.id,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const code = this.errors.classify(error);
      return createFailureResult(
        'temple',
        'check_availability',
        code,
        error instanceof Error ? error.message : String(error),
        'webcmd',
        error,
      ) as StandardResult<TempleData>;
    } finally {
      if (session && !session.isPaused) {
        await this.browser.cleanupSession(session, 'completed').catch(() => {});
      }
    }
  }
}
```

The example deliberately does not continue after a protected page is detected. PC2B owns domain interpretation; PC2A owns browser lifecycle and safety boundaries.
