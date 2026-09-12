import { ERROR_CODES, type ErrorCode, type StandardError } from './result_schema.js';

export { ERROR_CODES };
export type { ErrorCode };

export class ErrorHandler {
  static classify(rawError: unknown): ErrorCode {
    if (!rawError) return 'UNKNOWN_ERROR';
    if (this.isErrorCode(rawError)) return rawError;

    const text = this.toText(rawError).toLowerCase();

    if (this.matches(text, ['captcha', 'recaptcha', 'hcaptcha'])) return 'CAPTCHA_DETECTED';
    if (this.matches(text, ['rate limit', 'too many requests', '429'])) return 'RATE_LIMITED';
    if (this.matches(text, ['login required', 'sign in', 'log in', 'authentication required', 'unauthorized'])) return 'LOGIN_REQUIRED';
    if (this.matches(text, ['no availability', 'sold out', 'fully booked', 'no slots'])) return 'NO_AVAILABILITY';
    if (this.matches(text, ['timeout', 'timed out', 'deadline exceeded'])) return 'TIMEOUT';
    if (this.matches(text, ['element not found', 'locator', 'no such element', 'strict mode violation'])) return 'ELEMENT_NOT_FOUND';
    if (this.matches(text, ['page changed', 'stale element', 'target closed', 'execution context was destroyed'])) return 'PAGE_CHANGED';
    if (this.matches(text, ['dns', 'econnrefused', 'enotfound', '503', '502', '504', 'service unavailable', 'website unavailable'])) return 'WEBSITE_UNAVAILABLE';
    if (this.matches(text, ['navigation failed', 'navigation error', 'net::err', 'navigation timeout'])) return 'NAVIGATION_FAILED';
    if (this.matches(text, ['invalid input', 'validation failed', 'invalid argument'])) return 'INVALID_INPUT';

    return 'UNKNOWN_ERROR';
  }

  static toStandardError(rawError: unknown, code?: ErrorCode): StandardError {
    const classified = code ?? this.classify(rawError);
    return {
      code: classified,
      message: this.toText(rawError),
      retryable: this.isRetryable(classified),
      details: this.safeDetails(rawError),
    };
  }

  static isRetryable(code: ErrorCode): boolean {
    return new Set<ErrorCode>([
      'NAVIGATION_FAILED',
      'TIMEOUT',
      'PAGE_CHANGED',
      'WEBSITE_UNAVAILABLE',
      'RATE_LIMITED',
    ]).has(code);
  }

  private static isErrorCode(value: unknown): value is ErrorCode {
    return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
  }

  private static matches(text: string, patterns: string[]): boolean {
    return patterns.some((pattern) => text.includes(pattern));
  }

  private static toText(rawError: unknown): string {
    if (rawError instanceof Error) return rawError.message || rawError.name;
    if (typeof rawError === 'string') return rawError;
    try {
      return JSON.stringify(rawError);
    } catch {
      return String(rawError);
    }
  }

  private static safeDetails(rawError: unknown): unknown {
    if (rawError instanceof Error) return { name: rawError.name, stack: rawError.stack };
    return rawError;
  }
}
