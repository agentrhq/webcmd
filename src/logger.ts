/**
 * Unified logging for webcmd.
 *
 * All framework output (warnings, debug info, errors) should go through
 * this module so that verbosity levels are respected consistently.
 */

export function isVerbose(): boolean {
  const value = (process.env.WEBCMD_VERBOSE ?? '').trim().toLowerCase();
  return value !== '' && value !== '0' && value !== 'false' && value !== 'no' && value !== 'off';
}

/**
 * Turn on verbose diagnostics for the rest of the process.
 *
 * `-v` is parsed at several independent entry points — local Commander actions,
 * hosted dispatch, raw browser leaves, auth probes — while every consumer reads
 * the single `WEBCMD_VERBOSE` environment contract that `isVerbose()` defines.
 * Routing each entry point through this helper keeps them from drifting, and
 * lets child processes (adapter subprocesses, `browser verify`) inherit the mode.
 *
 * Passing `false` leaves the environment untouched rather than clearing it, so
 * an explicit `WEBCMD_VERBOSE=1` in the environment still wins when the flag is
 * simply absent from the command line.
 */
export function enableVerbose(enabled: boolean = true): void {
  if (enabled) process.env.WEBCMD_VERBOSE = '1';
}

export const log = {
  /** Informational message (always shown) */
  info(msg: string): void {
    process.stderr.write(`ℹ  ${msg}\n`);
  },

  /** Lightweight status line for adapter progress updates */
  status(msg: string): void {
    process.stderr.write(`${msg}\n`);
  },

  /** Positive completion/status line without the heavier info prefix */
  success(msg: string): void {
    process.stderr.write(`${msg}\n`);
  },

  /** Warning (always shown) */
  warn(msg: string): void {
    process.stderr.write(`⚠  ${msg}\n`);
  },

  /** Error (always shown) */
  error(msg: string): void {
    process.stderr.write(`✖  ${msg}\n`);
  },

  /** Verbose output (shown when -v flag or WEBCMD_VERBOSE is set) */
  verbose(msg: string): void {
    if (isVerbose()) {
      process.stderr.write(`[verbose] ${msg}\n`);
    }
  },

  /** Alias for verbose output. */
  debug(msg: string): void {
    this.verbose(msg);
  },

  /** Step-style debug (for pipeline steps, etc.) */
  step(stepNum: number, total: number, op: string, preview: string = ''): void {
    process.stderr.write(`  [${stepNum}/${total}] ${op}${preview}\n`);
  },

  /** Step result summary */
  stepResult(summary: string): void {
    process.stderr.write(`       → ${summary}\n`);
  },
};
