import { createCaptureStream } from './capture-stream.js';
import type { WebcmdConfig } from './config.js';
import { runHostedCli } from './runner.js';
import {
  createVirtualFileMap,
  createVirtualOutputSink,
  type HostedVirtualFile,
} from './virtual-files.js';

export type { HostedVirtualFile } from './virtual-files.js';

/** Matches the MCP inline stdout/stderr bound in the global MCP server design. */
export const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;

export interface HostedProgrammaticOptions {
  /** Excludes the `webcmd` executable name. Never lexed as a shell. */
  argv: readonly string[];
  /** The Webcmd Cloud API origin. For the MCP path this is the in-process loopback. */
  apiBaseUrl: string;
  /** The caller's OAuth access token, presented as a bearer credential. */
  accessToken: string;
  stdin?: string;
  files?: readonly HostedVirtualFile[];
  signal?: AbortSignal;
  stdoutLimitBytes?: number;
  stderrLimitBytes?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Opts into Webcmd's public-network-only hosted web/fetch implementation. */
  enableServerWebFetch?: boolean;
}

export interface HostedProgrammaticResult {
  exitCode: number;
  /** Canonical command resolved from trusted hosted metadata; never copied from argv. */
  resolvedCommand?: string;
  /** Manifest-declared access class paired with `resolvedCommand`. */
  accessClass?: 'read' | 'write';
  stdout: string;
  stderr: string;
  truncated: boolean;
  stdoutByteSize: number;
  stderrByteSize: number;
  /**
   * The complete stream, present only when `truncated` is true. A consumer that
   * must not lose oversized output — Webcmd Cloud writes it to an overflow
   * artifact — uses this rather than the inline `stdout`/`stderr` slice.
   */
  stdoutFull?: Uint8Array;
  stderrFull?: Uint8Array;
  outputFiles: HostedVirtualFile[];
}

/**
 * Runs the hosted CLI with fully injected I/O.
 *
 * Reads no process stdin, no service environment, no OS credential store, no
 * home directory, and no arbitrary filesystem path. Workspace, profile,
 * session, trace, and output format all remain ordinary argv.
 */
export async function runHostedProgrammatic(
  options: HostedProgrammaticOptions,
): Promise<HostedProgrammaticResult> {
  const stdout = createCaptureStream(options.stdoutLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES);
  const stderr = createCaptureStream(options.stderrLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES);
  const files = createVirtualFileMap(options.files ?? []);
  const outputs = createVirtualOutputSink();
  let trustedResolution: { resolvedCommand: string; accessClass: 'read' | 'write' } | undefined;

  // Passing `config` explicitly is what disables credential migration in
  // runHostedCli (`migrate: opts.config === undefined`), so this never writes
  // a config file or touches a credential store.
  const config: WebcmdConfig = {
    mode: 'hosted',
    updatedAt: new Date(0).toISOString(),
    hosted: { apiBaseUrl: options.apiBaseUrl, apiKey: options.accessToken },
  };

  const run = await runHostedCli([...options.argv], {
    config,
    // An empty env, not process.env: the service environment must not leak in.
    env: {},
    homeDir: '/nonexistent',
    stdout: stdout.stream,
    stderr: stderr.stream,
    files,
    outputs,
    ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.enableServerWebFetch === true ? { enableServerWebFetch: true } : {}),
    hasLocalClientCommandHandlers: false,
    onTrustedCommandResolution: resolution => { trustedResolution = resolution; },
  });

  const out = stdout.result();
  const err = stderr.result();

  return {
    exitCode: run.exitCode,
    ...(trustedResolution ?? {}),
    stdout: out.text,
    stderr: err.text,
    truncated: out.truncated || err.truncated,
    stdoutByteSize: out.byteSize,
    stderrByteSize: err.byteSize,
    ...(out.full ? { stdoutFull: out.full } : {}),
    ...(err.full ? { stderrFull: err.full } : {}),
    outputFiles: outputs.files(),
  };
}
