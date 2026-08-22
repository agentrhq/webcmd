/**
 * The single place a CLI failure becomes bytes on stderr plus an exit code.
 *
 * Both thrown `CliError`s and Commander's structural failures land here so a
 * usage mistake always reports the same shape: one `error:` line (plus a
 * `help:` line) for humans, or the machine envelope when `-f/--format` or
 * `--json` asked for one.
 *
 * Lives outside cli.ts so the `web fetch` fast path in main.ts can reuse it
 * without importing the full command tree.
 */
import { CommanderError } from 'commander';
import { CommanderStructuralError } from './command-surface.js';
import { toEnvelope } from './errors.js';
import { errorEnvelopeFormat, formatErrorEnvelope, requestedFormatFromArgv, requestedMachineFormat } from './output.js';

const COMMANDER_DISPLAY_CODES = new Set([
  'commander.help',
  'commander.helpDisplayed',
  'commander.version',
]);

export function handleProgramParseError(err: unknown, stderr: NodeJS.WritableStream = process.stderr): void {
  if (err instanceof CommanderStructuralError) {
    const fmt = requestedMachineFormat(process.argv.slice(2));
    stderr.write(fmt && err.envelope ? formatErrorEnvelope(err.envelope, { fmt }) : err.output);
    process.exitCode = err.exitCode;
    return;
  }
  if (err instanceof CommanderError && COMMANDER_DISPLAY_CODES.has(err.code)) {
    process.exitCode = err.exitCode;
    return;
  }
  reportCliError(err, stderr);
}

/** Render a thrown error as the shared envelope and set the exit code it carries. */
export function reportCliError(err: unknown, stderr: NodeJS.WritableStream = process.stderr): void {
  const envelope = toEnvelope(err);
  if (process.env.WEBCMD_DEBUG && err instanceof Error && err.stack) {
    envelope.error.stack = err.stack;
  }
  stderr.write(formatErrorEnvelope(envelope, {
    fmt: errorEnvelopeFormat(requestedFormatFromArgv(process.argv.slice(2))),
  }));
  process.exitCode = envelope.error.exitCode;
}
