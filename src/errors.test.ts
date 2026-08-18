import { describe, it, expect } from 'vitest';
import {
  CliError,
  BrowserConnectError,
  adapterLoadError,
  CommandExecutionError,
  ConfigError,
  AuthRequiredError,
  TimeoutError,
  ArgumentError,
  EmptyResultError,
  SlabRequiredError,
  SlabUpdateRequiredError,
  selectorError,
  SessionBusyError,
  attachTraceReceipt,
  toEnvelope,
} from './errors.js';
import type { SessionLeaseHolder } from './session-lease.js';

describe('Error type hierarchy', () => {
  it('all error types extend CliError', () => {
    const errors = [
      new BrowserConnectError('test'),
      adapterLoadError('test'),
      new CommandExecutionError('test'),
      new ConfigError('test'),
      new AuthRequiredError('example.com'),
      new TimeoutError('test', 30),
      new ArgumentError('test'),
      new EmptyResultError('test/cmd'),
      new SlabRequiredError(),
      new SlabUpdateRequiredError('1.0.0', '2.0.0'),
      selectorError('.btn'),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(CliError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('AuthRequiredError has correct code, domain, and auto-generated hint', () => {
    const err = new AuthRequiredError('youtube.com');
    expect(err.code).toBe('AUTH_REQUIRED');
    expect(err.domain).toBe('youtube.com');
    expect(err.message).toBe('Not logged in to youtube.com');
    expect(err.hint).toContain('https://youtube.com');
  });

  it('AuthRequiredError accepts custom message', () => {
    const err = new AuthRequiredError('x.com', 'No ct0 cookie found');
    expect(err.message).toBe('No ct0 cookie found');
    expect(err.hint).toContain('https://x.com');
  });

  it('TimeoutError has correct code and hint', () => {
    const err = new TimeoutError('youtube/search', 60);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toBe('youtube/search timed out after 60s');
    expect(err.hint).toContain('timeout');
  });

  it('ArgumentError has correct code', () => {
    const err = new ArgumentError('Argument "limit" must be a valid number');
    expect(err.code).toBe('ARGUMENT');
  });

  it('EmptyResultError has default hint', () => {
    const err = new EmptyResultError('hackernews/top');
    expect(err.code).toBe('EMPTY_RESULT');
    expect(err.message).toBe('hackernews/top returned no data');
    expect(err.hint).toBeTruthy();
  });

  it('selectorError has default hint about page changes', () => {
    const err = selectorError('.submit-btn');
    expect(err.code).toBe('SELECTOR');
    expect(err.message).toContain('.submit-btn');
    expect(err.hint).toContain('report');
  });

  it('BrowserConnectError has correct code', () => {
    const err = new BrowserConnectError('Cannot connect');
    expect(err.code).toBe('BROWSER_CONNECT');
  });

  it('SLAB errors provide configuration guidance', () => {
    const required = new SlabRequiredError();
    const update = new SlabUpdateRequiredError('1.0.0', '2.0.0');

    expect(required).toMatchObject({
      code: 'SLAB_REQUIRED',
      message: 'SLAB is required for local browser commands.',
      hint: 'Run `webcmd setup`, choose local mode, and install SLAB.',
      exitCode: 78,
    });
    expect(update).toMatchObject({
      code: 'SLAB_UPDATE_REQUIRED',
      message: 'SLAB 1.0.0 is incompatible with this webcmd version.',
      hint: 'Update SLAB to 2.0.0 or newer, then retry.',
      exitCode: 78,
    });
  });
});

describe('toEnvelope', () => {
  it('converts CliError to structured envelope', () => {
    const err = new AuthRequiredError('youtube.com');
    const envelope = toEnvelope(err);
    expect(envelope).toEqual({
      ok: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Not logged in to youtube.com',
        help: expect.stringContaining('https://youtube.com'),
        exitCode: 77,
      },
    });
  });

  it('serializes SessionBusyError with the public code and temporary-failure exit code', () => {
    const err = new SessionBusyError({
      command: 'chatgpt ask',
      pid: 4242,
      acquiredAt: 1_000,
      heartbeatAt: 2_000,
    });

    expect(toEnvelope(err)).toEqual({
      ok: false,
      error: {
        code: 'SESSION_BUSY',
        message: expect.stringContaining('chatgpt ask'),
        help: expect.any(String),
        exitCode: 75,
      },
    });
  });

  it('converts CliError without hint (omits help field)', () => {
    const err = new CommandExecutionError('Something broke');
    const envelope = toEnvelope(err);
    expect(envelope.error.code).toBe('COMMAND_EXEC');
    expect(envelope.error).not.toHaveProperty('help');
  });

  it('keeps Session window conflicts on the structured temporary-failure contract', async () => {
    const { SessionWindowConflictError } = await import('./browser/runtime/local-slab/session-manager.js');

    expect(toEnvelope(new SessionWindowConflictError('page_1', 'session_a', 'session_b')).error)
      .toMatchObject({ code: 'SESSION_WINDOW_CONFLICT', exitCode: 75 });
  });

  it('converts unknown Error to UNKNOWN envelope', () => {
    const envelope = toEnvelope(new Error('random failure'));
    expect(envelope).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'random failure',
        exitCode: 1,
      },
    });
  });

  it('converts non-Error values to UNKNOWN envelope', () => {
    const envelope = toEnvelope('string error');
    expect(envelope.error.code).toBe('UNKNOWN');
    expect(envelope.error.message).toBe('string error');
  });

  it('serializes deep cause chains without stack overflow', () => {
    // Build a 20-level deep cause chain — should truncate at depth 10
    let deepErr: Error = new Error('root');
    for (let i = 0; i < 20; i++) {
      deepErr = new Error(`level-${i}`, { cause: deepErr });
    }
    const topErr = new CommandExecutionError('top');
    (topErr as { cause?: unknown }).cause = deepErr;
    const envelope = toEnvelope(topErr);
    const causeStr = envelope.error.cause ?? '';
    expect(causeStr).toContain('(cause chain truncated)');
    expect(causeStr).not.toContain('root'); // root is beyond depth 10
  });

  it('preserves public hosted trace receipts without inventing local paths', () => {
    const err = new AuthRequiredError('github.com');
    attachTraceReceipt(err, {
      receipt: 'trace_receipt',
      executionId: 'exec_failure',
      artifactsUrl: '/v1/executions/exec_failure/artifacts',
    });

    expect(toEnvelope(err).trace).toEqual({
      receipt: 'trace_receipt',
      executionId: 'exec_failure',
      artifactsUrl: '/v1/executions/exec_failure/artifacts',
    });
  });
});

describe('SessionBusyError platform hints', () => {
  const holder: SessionLeaseHolder = {
    command: 'chatgpt ask',
    pid: 4242,
    acquiredAt: 1_000,
    heartbeatAt: 2_000,
  };

  it('uses PowerShell process guidance on Windows when the holder pid is known', () => {
    const err = new SessionBusyError(holder, 'win32', () => true);
    expect(err.hint).toContain('Stop-Process -Id 4242');
    expect(err.hint).not.toContain('kill 4242');
  });

  it('uses Task Manager guidance on Windows when the holder pid is unavailable', () => {
    const err = new SessionBusyError({ ...holder, pid: undefined }, 'win32');
    expect(err.hint).toMatch(/wait/i);
    expect(err.hint).toContain('Task Manager');
    expect(err.hint).not.toContain('Stop-Process');
  });

  it('uses kill guidance on POSIX when the holder pid is known', () => {
    const err = new SessionBusyError(holder, 'linux', () => true);
    expect(err.hint).toContain('kill 4242');
    expect(err.hint).not.toContain('Stop-Process');
  });

  it('includes local Session and site details when daemon admission reports them', () => {
    const err = new SessionBusyError({ ...holder, sessionId: 'session_a', admissionSite: 'github' }, 'linux', () => true);
    expect(err.hint).toContain('Session session_a');
    expect(err.hint).toContain('site github');
  });

  it('does not suggest killing a holder pid that is no longer alive', () => {
    const err = new SessionBusyError({ ...holder, sessionId: 'session_a' }, 'linux', () => false);
    expect(err.message).toContain('chatgpt ask');
    expect(err.hint).toMatch(/wait/i);
    expect(err.hint).not.toContain('kill 4242');
    expect(err.hint).toContain('webcmd session close --force session_a');
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('does not expose non-actionable pid %s in process guidance', (pid) => {
    const windowsError = new SessionBusyError({ ...holder, pid }, 'win32');
    expect(windowsError.message).not.toContain(`pid ${pid}`);
    expect(windowsError.hint).toContain('Task Manager');
    expect(windowsError.hint).not.toContain('Stop-Process');

    const posixError = new SessionBusyError({ ...holder, pid }, 'linux');
    expect(posixError.message).not.toContain(`pid ${pid}`);
    expect(posixError.hint).not.toContain('kill');
  });
});
