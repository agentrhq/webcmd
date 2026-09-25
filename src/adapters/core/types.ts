/**
 * Core interface definitions for the PRAVAAH Adapters middle layer.
 *
 * Sits between Backend (PC1) and Core Browser Automation Engine (PC2A).
 */

export type AdapterName = 'temple' | 'travel' | 'hotel';

export type ExecutionStatus = 'completed' | 'failed' | 'approval_required';

export interface StandardResultMetadata {
  timestamp: string;
  durationMs?: number;
  portal?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface StandardResultError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

/**
 * Mandatory contract returned by every adapter flow.
 * Ensures clean swappability and a uniform response shape for Backend (PC1).
 */
export interface StandardResult<T = unknown> {
  success: boolean;
  status: ExecutionStatus;
  adapter: AdapterName;
  action: string;
  data: T | null;
  metadata: StandardResultMetadata;
  error?: StandardResultError;
}

/**
 * Options for configuring browser session startup.
 */
export interface SessionOptions {
  headless?: boolean;
  proxy?: string;
  timeoutMs?: number;
  [key: string]: unknown;
}

/**
 * Abstract interface for interacting with a browser session.
 * Real PC2A core engine and local mocks both implement this interface.
 */
export interface IBrowserSession {
  readonly id: string;
  readonly isClosed: boolean;
  readonly isPaused: boolean;

  navigate(url: string): Promise<void>;
  getCurrentUrl(): Promise<string>;
  getPageContent(): Promise<string>;
  evaluate<R>(fn: () => R): Promise<R>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Abstract interface for managing browser sessions.
 */
export interface IBrowserManager {
  startSession(options?: SessionOptions): Promise<IBrowserSession>;
  closeSession(sessionId: string): Promise<void>;
}

/**
 * Classified error representation for resilient retry and failure reporting.
 */
export interface ClassifiedError {
  code: string;
  message: string;
  retryable: boolean;
  originalError?: unknown;
}

/**
 * Abstract error classification interface.
 */
export interface IErrorHandler {
  classify(error: unknown): ClassifiedError;
}

/**
 * Human-In-The-Loop (HITL) detection result.
 */
export type HitlReason =
  | 'payment_page'
  | 'otp_verification'
  | 'captcha_challenge'
  | 'final_submit'
  | 'manual_intervention';

export interface HitlCheckResult {
  requiresApproval: boolean;
  reason?: HitlReason;
  details?: string;
}

/**
 * Interface for cross-cutting HITL detectors.
 */
export interface IHitlDetector {
  check(session: IBrowserSession): Promise<HitlCheckResult>;
}
