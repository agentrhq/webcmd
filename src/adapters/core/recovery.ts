export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterRatio: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, nextAttempt: number, delayMs: number) => void | Promise<void>;
  dangerousAction?: boolean;
}

export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitterRatio: 0.2,
  dangerousAction: false,
});

export class DangerousActionError extends Error {
  constructor() {
    super('Dangerous actions must be short-circuited to approval_required before RecoveryManager.retry().');
    this.name = 'DangerousActionError';
  }
}

import { ErrorHandler } from './error_handler';

export class RecoveryManager {
  static async retry<T>(
    fn: (attempt: number) => Promise<T>,
    policy: Partial<RetryPolicy> = {},
  ): Promise<T> {
    const merged: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };
    if (merged.dangerousAction) throw new DangerousActionError();

    if (!Number.isInteger(merged.maxAttempts) || merged.maxAttempts < 1) {
      throw new Error('Retry policy maxAttempts must be >= 1.');
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= merged.maxAttempts; attempt += 1) {
      try {
        return await fn(attempt);
      } catch (error) {
        lastError = error;
        const canRetry = attempt < merged.maxAttempts && (merged.shouldRetry?.(error, attempt) ?? ErrorHandler.isRetryable(ErrorHandler.classify(error)));
        if (!canRetry) throw error;

        const exponential = Math.min(
          merged.maxDelayMs,
          merged.baseDelayMs * Math.pow(merged.backoffMultiplier, attempt - 1),
        );
        const jitter = exponential * merged.jitterRatio * (Math.random() * 2 - 1);
        const delayMs = Math.max(0, Math.round(exponential + jitter));
        await merged.onRetry?.(error, attempt + 1, delayMs);
        await this.sleep(delayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Retry failed.');
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
