import { describe, expect, it } from 'vitest';
import { CommanderStructuralError } from '../command-surface.js';
import { parseHostedAuthCommand } from './auth-command-surface.js';

describe('hosted auth command surface', () => {
  it('rejects a status choice with the native Commander contract', () => {
    expect(() => parseHostedAuthCommand(['auth', 'status', '--only', 'authenticated'], false)).toThrowError(
      expect.objectContaining<Partial<CommanderStructuralError>>({
        exitCode: 2,
        output: [
          "error: option '--only <status>' argument 'authenticated' is invalid. Allowed choices are all, logged-in, not-logged-in, unknown, error.",
          'help: usage: webcmd auth status [options]',
          '',
        ].join('\n'),
      }),
    );
  });

  it('rejects generic trace capture with the native refresh flag list', () => {
    expect(() => parseHostedAuthCommand(['auth', 'refresh', '--trace', 'on'], false)).toThrowError(
      expect.objectContaining<Partial<CommanderStructuralError>>({
        exitCode: 2,
        output: [
          "error: unknown option '--trace'",
          'help: valid flags for `webcmd auth refresh`: --site, --all, --concurrency, --timeout, -v, --verbose, -f, --format, --json',
          '',
        ].join('\n'),
      }),
    );
  });

  it('renders status help from the native options in plain and structured formats', () => {
    const plain = parseHostedAuthCommand(['auth', 'status', '--help'], false);
    const structured = parseHostedAuthCommand(['auth', 'status', '--help', '-f', 'json'], false);

    expect(plain).toMatchObject({ kind: 'help' });
    if (plain.kind !== 'help') throw new Error('Expected help');
    expect(plain.output).toContain('--only <status>');
    expect(plain.output).toContain('"logged-in"');
    expect(plain.output).not.toContain('--trace');

    expect(structured).toMatchObject({ kind: 'help' });
    if (structured.kind !== 'help') throw new Error('Expected help');
    const data = JSON.parse(structured.output) as { command_options: Array<{ name: string; choices?: string[] }> };
    expect(data.command_options.find(option => option.name === 'only')?.choices).toEqual([
      'all', 'logged-in', 'not-logged-in', 'unknown', 'error',
    ]);
    expect(data.command_options.map(option => option.name)).not.toContain('trace');
  });

  it('preserves the existing hosted execute values for valid auth input', () => {
    expect(parseHostedAuthCommand([
      'auth', 'status', '--site', 'github', '--full', '--concurrency', '2', '--timeout', '15',
      '--only', 'logged-in', '-v', '-f', 'json',
    ], false)).toEqual({
      kind: 'run',
      command: 'auth/status',
      args: { site: 'github', full: true, concurrency: 2, timeout: 15, only: 'logged-in' },
      optionSources: {
        site: 'cli', full: 'cli', concurrency: 'cli', timeout: 'cli', only: 'cli',
      },
      format: 'json',
      formatExplicit: true,
      trace: 'off',
      verbose: true,
      help: false,
    });
  });

  it('keeps parsing auth options after a root literal separator', () => {
    expect(parseHostedAuthCommand(['auth', 'status', '--only', 'logged-in'], true)).toMatchObject({
      kind: 'run',
      command: 'auth/status',
      args: { only: 'logged-in' },
    });
  });

  it('keeps native positive-integer validation before hosted execution', () => {
    expect(() => parseHostedAuthCommand(['auth', 'status', '--concurrency', 'many'], false))
      .toThrow('--concurrency must be a positive integer. Received: "many"');
  });
});
