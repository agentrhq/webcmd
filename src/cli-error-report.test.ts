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

  it('lets explicit --format win over --json for early errors', () => {
    const previous = process.argv;
    process.argv = ['node', 'webcmd', 'validate', 'nope', '--format', 'yaml', '--json'];
    try {
      expect(capture(new CliError('ARGUMENT', 'No command matches "nope".', undefined, EXIT_CODES.USAGE_ERROR)))
        .toMatch(/^ok: false\n/);
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

/**
 * One envelope, one exit code, one stderr line for every usage mistake.
 * Each case below is a real `webcmd` invocation that used to render
 * differently: see fix/cli-usage-error-envelope.
 */
describe('usage error contract', () => {
  const previousExitCode = process.exitCode;
  const previousArgv = process.argv;
  afterEach(() => {
    process.exitCode = previousExitCode;
    process.argv = previousArgv;
    vi.restoreAllMocks();
  });

  /** Run argv through the local CLI exactly as runCli does, capturing all stderr. */
  async function runLocal(argv: string[]): Promise<{ stderr: string; exitCode: number }> {
    process.argv = ['node', 'webcmd', ...argv];
    process.exitCode = undefined;
    let stderr = '';
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write);
    vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      stderr += `${values.map(String).join(' ')}\n`;
    });
    const program = createProgram('', '');
    applyUnknownOptionContract(program);
    try {
      await program.parseAsync(argv, { from: 'user' });
    } catch (err) {
      handleProgramParseError(err);
    } finally {
      write.mockRestore();
    }
    return { stderr, exitCode: Number(process.exitCode ?? 0) };
  }

  function errorLines(stderr: string): string[] {
    return stderr.split('\n').filter(line => line.startsWith('error: '));
  }

  const usageCases = [
    { name: 'unknown subcommand', argv: ['adapter', 'list', 'rest'], code: 'UNKNOWN_COMMAND', help: /valid subcommands for `webcmd adapter`/ },
    { name: 'unknown option', argv: ['adapter', 'path', 'x/y', '-q'], code: 'UNKNOWN_OPTION', help: undefined },
    { name: 'excess arguments', argv: ['list', 'extra'], code: 'EXCESS_ARGUMENTS', help: /usage: webcmd list/ },
  ];

  it.each(usageCases)('$name exits 2 with one stderr line and no envelope for humans', async ({ argv, help }) => {
    const { stderr, exitCode } = await runLocal(argv);
    expect(exitCode).toBe(EXIT_CODES.USAGE_ERROR);
    expect(errorLines(stderr)).toHaveLength(1);
    expect(stderr).not.toContain('ok: false');
    if (help) expect(stderr).toMatch(help);
  });

  it.each(usageCases)('$name renders a JSON envelope under --json', async ({ argv, code }) => {
    const { stderr, exitCode } = await runLocal([...argv, '--json']);
    expect(exitCode).toBe(EXIT_CODES.USAGE_ERROR);
    expect(JSON.parse(stderr)).toMatchObject({
      ok: false,
      error: { code, exitCode: EXIT_CODES.USAGE_ERROR },
    });
  });

  it('renders a YAML envelope for -f yaml', async () => {
    const { stderr } = await runLocal(['adapter', 'list', 'rest', '-f', 'yaml']);
    expect(yaml.load(stderr)).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND', exitCode: 2 } });
  });

  it('keeps --help a display exit, not a usage error', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { stderr, exitCode } = await runLocal(['adapter', '--help']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });
});

describe('web fetch fast path usage errors', () => {
  const previousExitCode = process.exitCode;
  const previousArgv = process.argv;
  afterEach(() => {
    process.exitCode = previousExitCode;
    process.argv = previousArgv;
    vi.restoreAllMocks();
  });

  async function runFetch(argv: string[]): Promise<{ stderr: string; exitCode: number }> {
    const { runWebFetchCommand } = await import('./fetch/command.js');
    process.argv = ['node', 'webcmd', ...argv];
    process.exitCode = undefined;
    let stderr = '';
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write);
    try {
      await runWebFetchCommand(argv);
    } finally {
      write.mockRestore();
    }
    return { stderr, exitCode: Number(process.exitCode ?? 0) };
  }

  it('reports a missing required option once, as a usage error', async () => {
    const { stderr, exitCode } = await runFetch(['web', 'fetch']);
    expect(exitCode).toBe(EXIT_CODES.USAGE_ERROR);
    expect(stderr.split('\n').filter(line => line.startsWith('error: '))).toHaveLength(1);
    expect(stderr).toContain("error: required option '--url <value>' not specified");
    expect(stderr).toContain('help: usage: webcmd web fetch');
  });

  it('honours --json on a missing required option', async () => {
    const { stderr, exitCode } = await runFetch(['web', 'fetch', '--json']);
    expect(exitCode).toBe(EXIT_CODES.USAGE_ERROR);
    expect(JSON.parse(stderr)).toMatchObject({
      ok: false,
      error: { code: 'MISSING_OPTION', exitCode: EXIT_CODES.USAGE_ERROR },
    });
  });
});
