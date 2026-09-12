/**
 * Policy configuring retry behavior.
 */
export interface RetryPolicy {
  /** Maximum number of attempts. Default is 3. */
  maxAttempts?: number;
  /** Milliseconds delay between retries. */
  backoffMs?: number;
  /** Name or identifier of the action being performed. */
  actionName?: string;
  /** Explicit flag indicating whether the action is protected. */
  isProtected?: boolean;
}

/**
 * Result of executing an operation through RecoveryManager.
 */
export interface RetryResult<T> {
  success: boolean;
  attempts: number;
  result?: T;
  /** True when execution hit a protected boundary and must halt for approval. */
  requiresApproval: boolean;
  approvalReason?: string;
  error?: unknown;
}

/**
 * RecoveryManager implements resilient retry logic with strict safety boundaries.
 * Enforces rule: Never retry dangerous or protected actions (payment, OTP, final submit, checkout, confirmation).
 */
export class RecoveryManager {
  private static readonly PROTECTED_KEYWORDS = [
    'payment',
    'pay',
    'checkout',
    'otp',
    'two-factor',
    '2fa',
    'final-submit',
    'final_submit',
    'final submit',
    'confirm-booking',
    'confirmation',
    'confirm',
    'complete booking',
    'authorize',
  ];

  /**
   * Evaluates if a given string references a dangerous or protected action/state.
   */
  static isProtected(text: string): boolean {
    const lower = text.toLowerCase();
    return this.PROTECTED_KEYWORDS.some((kw) => lower.includes(kw));
  }

  /**
   * Instance method forwarding to static retry.
   */
  async retry<T>(
    fn: (attempt: number) => Promise<T>,
    policy?: RetryPolicy,
  ): Promise<RetryResult<T>> {
    return RecoveryManager.retry(fn, policy);
  }

  /**
   * Executes an operation with retry, respecting safety boundaries.
   *
   * @param fn Function to execute, receiving current attempt count (1-indexed).
   * @param policy Optional retry configuration. Defaults to 3 max attempts.
   */
  static async retry<T>(
    fn: (attempt: number) => Promise<T>,
    policy?: RetryPolicy,
  ): Promise<RetryResult<T>> {
    const maxAttempts = policy?.maxAttempts ?? 3;
    const actionName = policy?.actionName || fn.name || 'operation';

    // 1. Never retry dangerous or protected actions
    if (policy?.isProtected || this.isProtected(actionName)) {
      return {
        success: false,
        attempts: 0,
        requiresApproval: true,
        approvalReason: `Protected action '${actionName}' cannot be automatically executed or retried. Human-In-The-Loop approval is required.`,
        error: {
          code: 'APPROVAL_REQUIRED',
          message: `Protected action '${actionName}' is protected and requires approval.`,
        },
      };
    }

    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const result = await fn(attempt);

        // Check if result object itself signals an approval_required state
        if (
          typeof result === 'object' &&
          result !== null &&
          (('requiresApproval' in result && (result as Record<string, unknown>).requiresApproval === true) ||
            ('status' in result && (result as Record<string, unknown>).status === 'approval_required'))
        ) {
          const resObj = result as Record<string, unknown>;
          return {
            success: false,
            attempts: attempt,
            result,
            requiresApproval: true,
            approvalReason:
              (typeof resObj.approvalReason === 'string' ? resObj.approvalReason : undefined) ||
              (typeof resObj.reason === 'string' ? resObj.reason : undefined) ||
              `Action '${actionName}' reached protected state requiring approval.`,
          };
        }

        return {
          success: true,
          attempts: attempt,
          result,
          requiresApproval: false,
        };
      } catch (err) {
        lastError = err;
        const errMessage = err instanceof Error ? err.message : String(err);
        const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};

        // 2. Check if the error itself signals that a protected page/wall was reached
        const isProtectedErr =
          this.isProtected(errMessage) ||
          errObj.requiresApproval === true ||
          errObj.status === 'approval_required' ||
          errObj.code === 'APPROVAL_REQUIRED';

        if (isProtectedErr) {
          return {
            success: false,
            attempts: attempt,
            requiresApproval: true,
            approvalReason: `Protected checkpoint encountered during '${actionName}': ${errMessage}`,
            error: err,
          };
        }

        // 3. Backoff before next attempt if attempts remain
        if (attempt < maxAttempts) {
          const delay = policy?.backoffMs !== undefined ? policy.backoffMs * attempt : 10 * attempt;
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
    }

    return {
      success: false,
      attempts: attempt,
      requiresApproval: false,
      error: lastError,
    };
  }
}
