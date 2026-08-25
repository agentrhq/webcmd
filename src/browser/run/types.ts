import type { SnapshotBaselineStore, SnapshotTreeMode } from '../snapshot/index.js';

export const BROWSER_RUN_PLAYWRIGHT_VERSION = '1.61.1' as const;

export const BROWSER_RUN_DEFAULT_TIMEOUT_MS = 30_000;
export const BROWSER_RUN_MAX_SOURCE_BYTES = 256 * 1024;
export const BROWSER_RUN_DEFAULT_MAX_OUTPUT_CHARS = 65_536;
export const BROWSER_RUN_DEFAULT_MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;

export type BrowserRunErrorCode =
  | 'BROWSER_RUN_INVALID_INPUT'
  | 'BROWSER_RUN_SOURCE_LIMIT'
  | 'BROWSER_RUN_SYNTAX_ERROR'
  | 'BROWSER_RUN_PROTOCOL_MISMATCH'
  | 'BROWSER_RUN_API_UNSUPPORTED'
  | 'BROWSER_RUN_TIMEOUT'
  | 'BROWSER_RUN_MEMORY_LIMIT'
  | 'BROWSER_RUN_CANCELLED'
  | 'BROWSER_RUN_OUTPUT_LIMIT'
  | 'BROWSER_RUN_SERIALIZATION_ERROR';

export interface BrowserRunArtifactReceipt {
  artifactId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  locator: string;
  downloadUrl?: string;
}

export interface BrowserRunArtifactSink {
  write(input: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<BrowserRunArtifactReceipt>;
}

export interface BrowserRunWarning {
  code:
    | 'BROWSER_RUN_SIDE_EFFECTS_MAY_HAVE_OCCURRED'
    | 'BROWSER_RUN_SNAPSHOT_FAILED'
    | 'BROWSER_RUN_CRITICAL_SNAPSHOT_OMITTED'
    | 'BROWSER_RUN_NO_CAPTURE'
    | 'BROWSER_RUN_SNAPSHOT_DIFF_OMITTED';
  message: string;
}

export interface BrowserRunLimits {
  outputTruncated: boolean;
  snapshotTruncated: boolean;
  snapshotDiffOmitted?: boolean;
}

export interface BrowserRunTimings {
  quickjs_boot_ms?: number;
  client_bundle_init_ms?: number;
  program_ms?: number;
  browser_wait_ms?: number;
  snapshot_ms?: number;
}

export interface BrowserRunFailureDetails {
  logs: BrowserRunLogEntry[];
  page: BrowserRunPageMetadata;
  snapshotDiff?: string;
  artifacts: BrowserRunArtifactReceipt[];
  warnings: BrowserRunWarning[];
  limits: BrowserRunLimits;
  timings?: BrowserRunTimings;
}

export class BrowserRunError extends Error {
  constructor(
    readonly code: BrowserRunErrorCode,
    message: string,
    readonly hint?: string,
    readonly details?: BrowserRunFailureDetails,
  ) {
    super(message);
    this.name = 'BrowserRunError';
  }
}

export interface BrowserRunOptions {
  timeoutMs?: number;
  maxOutputChars?: number;
  memoryLimitBytes?: number;
  snapshotDiff?: boolean;
  snapshotMode?: SnapshotTreeMode;
  snapshotBaselineStore?: SnapshotBaselineStore;
  signal?: AbortSignal;
  /**
   * Called when a closed-context signature ("Target page, context or browser
   * has been closed") surfaces somewhere that doesn't itself fail the run —
   * currently, the post-run snapshot capture (webcmd#314). The run still
   * completes with `ok: true` (the program itself may have genuinely
   * succeeded), but the caller should treat the underlying Profile runtime as
   * dead so the next command on this Session isn't handed the same lease.
   */
  onStaleContext?: () => void;
}

/** Matches Playwright's "Target page, context or browser has been closed" error family. */
export function isClosedContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed/i.test(message);
}

export interface BrowserRunLogEntry {
  level: 'log' | 'info' | 'warn' | 'error';
  args: unknown[];
}

export interface BrowserRunPageMetadata {
  id: string;
  url: string;
  title: string;
}

export interface BrowserRunResult {
  ok: true;
  result: unknown;
  logs: BrowserRunLogEntry[];
  page: BrowserRunPageMetadata;
  snapshotDiff?: string;
  artifacts: BrowserRunArtifactReceipt[];
  warnings: BrowserRunWarning[];
  limits: BrowserRunLimits;
  timings: BrowserRunTimings;
}
