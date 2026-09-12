export const RESULT_STATUSES = [
  'completed',
  'searching',
  'partial',
  'failed',
  'retrying',
  'blocked',
  'approval_required',
] as const;

export type ResultStatus = (typeof RESULT_STATUSES)[number];

export interface ResultMetadata {
  source: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface StandardResult<T = unknown> {
  success: boolean;
  status: ResultStatus;
  adapter: string;
  action: string;
  data: T;
  metadata: ResultMetadata;
  error: StandardError | null;
}

export interface StandardError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export const ERROR_CODES = [
  'NAVIGATION_FAILED',
  'TIMEOUT',
  'ELEMENT_NOT_FOUND',
  'PAGE_CHANGED',
  'WEBSITE_UNAVAILABLE',
  'RATE_LIMITED',
  'LOGIN_REQUIRED',
  'CAPTCHA_DETECTED',
  'NO_AVAILABILITY',
  'INVALID_INPUT',
  'UNKNOWN_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function createResult<T>(params: {
  success: boolean;
  status: ResultStatus;
  adapter: string;
  action: string;
  data: T;
  source?: string;
  error?: StandardError | null;
  metadata?: Record<string, unknown>;
}): StandardResult<T> {
  return {
    success: params.success,
    status: params.status,
    adapter: params.adapter,
    action: params.action,
    data: params.data,
    metadata: {
      source: params.source ?? '',
      timestamp: new Date().toISOString(),
      ...(params.metadata ?? {}),
    },
    error: params.error ?? null,
  };
}
