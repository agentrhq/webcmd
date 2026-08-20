import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { CommanderError } from 'commander';
import { createProgram, handleProgramParseError, reportCliError } from './cli.js';
import { applyUnknownOptionContract, CommanderStructuralError } from './command-surface.js';
import { CliError, EXIT_CODES } from './errors.js';

describe('reportCliError', () => {
  const previousExitCode = process.exitCode;
  afterEach(() => { process.exitCode = previousExitCode; });

  function capture(err: unknown): string {
    let text = '';
    reportCliError(err, { write: (chunk: string) => { text += chunk; return true; } } as unknown as NodeJS.WritableStream);
    return text;
  }

  it('renders a CliError as the shared envelope and keeps its exit code', () => {
    const text = capture(new CliError('SITE_MEMORY_NOT_FOUND', 'Verify fixture a/b was not found.', undefined, EXIT_CODES.EMPTY_RESULT));

    expect(yaml.load(text)).toEqual({
      ok: false,
      error: { code: 'SITE_MEMORY_NOT_FOUND', message: 'Verify fixture a/b was not found.', exitCode: EXIT_CODES.EMPTY_RESULT },
    });
    expect(process.exitCode).toBe(EXIT_CODES.EMPTY_RESULT);
  });

  it('carries the hint through as help', () => {
    const text = capture(new CliError('X', 'broke', 'try this', EXIT_CODES.USAGE_ERROR));

    expect(yaml.load(text)).toMatchObject({ error: { help: 'try this', exitCode: EXIT_CODES.USAGE_ERROR } });
    expect(process.exitCode).toBe(EXIT_CODES.USAGE_ERROR);
  });

  it('falls back to UNKNOWN and a generic exit code for a plain error', () => {
    const text = capture(new Error('boom'));

    expect(yaml.load(text)).toMatchObject({ error: { code: 'UNKNOWN', message: 'boom', exitCode: EXIT_CODES.GENERIC_ERROR } });
    expect(process.exitCode).toBe(EXIT_CODES.GENERIC_ERROR);
  });

  it('renders JSON when -f json is on argv', () => {
    const previous = process.argv;
    process.argv = ['node', 'webcmd', 'validate', 'nope', '-f', 'json'];
    try {
      expect(JSON.parse(capture(new CliError('ARGUMENT', 'No command matches "nope".', undefined, EXIT_CODES.USAGE_ERROR))))
        .toEqual({
          ok: false,
          error: { code: 'ARGUMENT', message: 'No command matches "nope".', exitCode: EXIT_CODES.USAGE_ERROR },
        });
    } finally {
      process.argv = previous;
    }
  });

  it('omits the stack unless WEBCMD_DEBUG is set', () => {
    expect(yaml.load(capture(new Error('boom'))) as any).not.toHaveProperty('error.stack');
    vi.stubEnv('WEBCMD_DEBUG', '1');
    try {
      expect(String((yaml.load(capture(new Error('boom'))) as any).error.stack)).toContain('Error: boom');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('handleProgramParseError', () => {
  const previousExitCode = process.exitCode;
  afterEach(() => { process.exitCode = previousExitCode; });

  it('keeps Commander help and version as display exits, not envelopes', () => {
    let text = '';
    const stderr = { write: (chunk: string) => { text += chunk; return true; } } as unknown as NodeJS.WritableStream;
    handleProgramParseError(new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)'), stderr);
    expect(text).toBe('');
    expect(process.exitCode).toBe(0);
  });

  it('does not wrap web --help as an unknown error after the unknown-option contract is applied', async () => {
    const program = createProgram('', '');
    applyUnknownOptionContract(program);
    const stdout: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(' ')); });
    let stderr = '';
    try {
      await program.parseAsync(['node', 'webcmd', 'web', '--help']);
      expect.unreachable();
    } catch (err) {
      handleProgramParseError(err, { write: (chunk: string) => { stderr += chunk; return true; } } as unknown as NodeJS.WritableStream);
      expect(err).toBeInstanceOf(CommanderError);
      expect((err as CommanderError).code).toBe('commander.helpDisplayed');
      expect(process.exitCode).toBe(0);
      expect(stderr).toBe('');
    } finally {
      log.mockRestore();
    }
  });

  it('writes unknown-option structural errors to stderr', () => {
    let text = '';
    const stderr = { write: (chunk: string) => { text += chunk; return true; } } as unknown as NodeJS.WritableStream;
    handleProgramParseError(new CommanderStructuralError("error: unknown option '--foo'\nhelp: valid flags for `webcmd list`: -f\n", 2), stderr);
    expect(text).toContain("error: unknown option '--foo'");
    expect(process.exitCode).toBe(2);
  });
});
