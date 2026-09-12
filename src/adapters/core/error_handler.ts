/**
 * Standard Error Codes for PC2A Core.
 * Defined and exported individually and grouped in ErrorCode.
 */
export const NAVIGATION_FAILED = 'NAVIGATION_FAILED' as const;
export const TIMEOUT = 'TIMEOUT' as const;
export const ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND' as const;
export const PAGE_CHANGED = 'PAGE_CHANGED' as const;
export const WEBSITE_UNAVAILABLE = 'WEBSITE_UNAVAILABLE' as const;
export const RATE_LIMITED = 'RATE_LIMITED' as const;
export const LOGIN_REQUIRED = 'LOGIN_REQUIRED' as const;
export const CAPTCHA_DETECTED = 'CAPTCHA_DETECTED' as const;
export const NO_AVAILABILITY = 'NO_AVAILABILITY' as const;
export const INVALID_INPUT = 'INVALID_INPUT' as const;
export const UNKNOWN_ERROR = 'UNKNOWN_ERROR' as const;

export const ErrorCode = {
  NAVIGATION_FAILED,
  TIMEOUT,
  ELEMENT_NOT_FOUND,
  PAGE_CHANGED,
  WEBSITE_UNAVAILABLE,
  RATE_LIMITED,
  LOGIN_REQUIRED,
  CAPTCHA_DETECTED,
  NO_AVAILABILITY,
  INVALID_INPUT,
  UNKNOWN_ERROR,
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * ErrorHandler classifies raw errors from Webcmd, network layers, or portals into standard ErrorCodes.
 */
export class ErrorHandler {
  /**
   * Instance classifier method.
   */
  classify(rawError: unknown): ErrorCode {
    return ErrorHandler.classify(rawError);
  }

  /**
   * Classifies a raw error into one of the 11 exact ErrorCode values.
   */
  static classify(rawError: unknown): ErrorCode {
    if (!rawError) {
      return ErrorCode.UNKNOWN_ERROR;
    }

    const err = (typeof rawError === 'object' && rawError !== null)
      ? (rawError as Record<string, unknown>)
      : {};
    const message = typeof err.message === 'string' ? err.message : String(rawError);
    const code = typeof err.code === 'string' ? err.code : '';
    const name = typeof err.name === 'string' ? err.name : '';
    const status = typeof err.status === 'number' || typeof err.status === 'string' ? String(err.status) : '';
    const statusCode = typeof err.statusCode === 'number' || typeof err.statusCode === 'string' ? String(err.statusCode) : '';
    const combined = `${name} ${code} ${status} ${statusCode} ${message}`.toLowerCase();

    // 1. CAPTCHA_DETECTED
    if (/captcha|recaptcha|hcaptcha|turnstile|bot detection|cf-chl/i.test(combined)) {
      return ErrorCode.CAPTCHA_DETECTED;
    }

    // 2. TIMEOUT
    if (/time(d)?\s*out|etimedout|timeout/i.test(combined)) {
      return ErrorCode.TIMEOUT;
    }

    // 3. RATE_LIMITED
    if (/rate\s*limit|429|too many requests|throttl/i.test(combined)) {
      return ErrorCode.RATE_LIMITED;
    }

    // 4. WEBSITE_UNAVAILABLE
    if (
      /503|502|econnrefused|service unavailable|bad gateway|site is down|under maintenance/i.test(
        combined,
      )
    ) {
      return ErrorCode.WEBSITE_UNAVAILABLE;
    }

    // 5. NAVIGATION_FAILED
    if (
      /navigation failed|net::err|err_name_not_resolved|err_connection|dns probe|cannot navigate/i.test(
        combined,
      )
    ) {
      return ErrorCode.NAVIGATION_FAILED;
    }

    // 6. LOGIN_REQUIRED
    if (
      /login required|please sign in|unauthorized|401|auth(?:entication)? required|session expired/i.test(
        combined,
      )
    ) {
      return ErrorCode.LOGIN_REQUIRED;
    }

    // 7. ELEMENT_NOT_FOUND
    if (
      /element not found|no such element|selector .* not found|target element missing|could not find element/i.test(
        combined,
      )
    ) {
      return ErrorCode.ELEMENT_NOT_FOUND;
    }

    // 8. PAGE_CHANGED
    if (
      /page changed|stale element|unexpected page layout|dom layout altered|schema mismatch/i.test(
        combined,
      )
    ) {
      return ErrorCode.PAGE_CHANGED;
    }

    // 9. NO_AVAILABILITY
    if (
      /no availability|no slots available|all slots booked|sold out|quota exhausted|seats? unavailable|sold_out/i.test(
        combined,
      )
    ) {
      return ErrorCode.NO_AVAILABILITY;
    }

    // 10. INVALID_INPUT
    if (
      /invalid input|validation error|bad request|400|invalid date|missing parameter/i.test(
        combined,
      )
    ) {
      return ErrorCode.INVALID_INPUT;
    }

    return ErrorCode.UNKNOWN_ERROR;
  }
}
