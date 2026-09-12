/**
 * StandardResult Contract for PilgrimOS Adapters (PC2A Core).
 *
 * All adapters return this exact shape to guarantee uniform responses to PC1.
 */

export type StandardResultStatus =
  | 'completed'
  | 'searching'
  | 'partial'
  | 'failed'
  | 'retrying'
  | 'blocked'
  | 'approval_required';

export interface StandardResultMetadata {
  source: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface StandardResult<T = Record<string, unknown>> {
  success: boolean;
  status: StandardResultStatus;
  adapter: string;
  action: string;
  data: T | null;
  metadata: StandardResultMetadata;
  error: Record<string, unknown> | null;
}

/**
 * Factory helpers to generate StandardResult instances with strict typing.
 */
export function createSuccessResult<T>(
  adapter: string,
  action: string,
  data: T,
  source = 'webcmd',
  extraMetadata?: Record<string, unknown>,
): StandardResult<T> {
  return {
    success: true,
    status: 'completed',
    adapter,
    action,
    data,
    metadata: {
      source,
      timestamp: new Date().toISOString(),
      ...extraMetadata,
    },
    error: null,
  };
}

export function createApprovalRequiredResult(
  adapter: string,
  action: string,
  reason: string,
  source = 'webcmd',
  extraMetadata?: Record<string, unknown>,
): StandardResult<null> {
  return {
    success: false,
    status: 'approval_required',
    adapter,
    action,
    data: null,
    metadata: {
      source,
      timestamp: new Date().toISOString(),
      approvalReason: reason,
      ...extraMetadata,
    },
    error: {
      code: 'APPROVAL_REQUIRED',
      message: `Action '${action}' reached protected state: ${reason}`,
    },
  };
}

export function createFailureResult(
  adapter: string,
  action: string,
  errorCode: string,
  errorMessage: string,
  source = 'webcmd',
  details?: unknown,
  status: StandardResultStatus = 'failed',
): StandardResult<null> {
  return {
    success: false,
    status,
    adapter,
    action,
    data: null,
    metadata: {
      source,
      timestamp: new Date().toISOString(),
    },
    error: {
      code: errorCode,
      message: errorMessage,
      details: details ?? null,
    },
  };
}
