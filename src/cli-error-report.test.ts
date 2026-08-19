import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { reportCliError } from './cli.js';
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
