import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CliCommand } from './registry.js';

const { mockReleaseSiteSessionLease, mockSetDaemonCommandTimeoutSeconds } = vi.hoisted(() => ({
  mockReleaseSiteSessionLease: vi.fn().mockResolvedValue(undefined),
  mockSetDaemonCommandTimeoutSeconds: vi.fn(),
}));

vi.mock('./browser/daemon-client.js', async () => {
  const actual = await vi.importActual<typeof import('./browser/daemon-client.js')>('./browser/daemon-client.js');
  return {
    ...actual,
    releaseSiteSessionLease: mockReleaseSiteSessionLease,
    setDaemonCommandTimeoutSeconds: mockSetDaemonCommandTimeoutSeconds,
  };
});

import { executeCommand, prepareCommandArgs } from './execution.js';
import { ArgumentError, TimeoutError, toEnvelope } from './errors.js';
import { cli, Strategy } from './registry.js';
import { withTimeoutMs } from './runtime.js';
import * as runtime from './runtime.js';
import * as capRouting from './capabilityRouting.js';
import { clearDaemonRunContext, getDaemonRunContext } from './session-lease.js';

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('executeCommand — non-browser timeout', () => {
  it('applies the user --timeout arg as the ceiling for non-browser commands', async () => {
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-timeout', access: 'read',
      description: 'test non-browser --timeout enforcement',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(runWithTimeoutSpy).toHaveBeenCalledTimes(1);
    // Ceiling = user-supplied/default timeout + 30s padding (adapter return room).
    expect(runWithTimeoutSpy.mock.calls[0]?.[1]).toMatchObject({
      timeout: 35,
      label: 'test-execution/non-browser-timeout',
    });
    vi.restoreAllMocks();
  });

  it('fires a TimeoutError when the inner adapter exceeds the --timeout ceiling', async () => {
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-timeout-fires', access: 'read',
      description: 'test that the ceiling actually cancels the adapter',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 1, help: 'Max seconds' },
      ],
      func: () => new Promise(() => {}),
    });

    // Spy on runWithTimeout to intercept and pass a tiny ceiling so the test
    // doesn't have to wait the real (1+30)s. We still verify the TimeoutError
    // surface — code, label, hint — that users see.
    vi.spyOn(runtime, 'runWithTimeout').mockImplementation(async (promise, opts) => {
      return runtime.withTimeoutMs(
        promise as Promise<unknown>,
        50,
        () => new TimeoutError(opts.label ?? 'op', opts.timeout, opts.hint),
      ) as never;
    });

    const error = await executeCommand(cmd, {}).catch((err) => err);

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toMatchObject({
      code: 'TIMEOUT',
      hint: 'Pass a higher --timeout value (currently 1s)',
    });
    vi.restoreAllMocks();
  });

  it('runs non-browser commands without a ceiling when no --timeout arg is declared', async () => {
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-no-timeout', access: 'read',
      description: 'test that omitting --timeout means no ceiling',
      browser: false,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(runWithTimeoutSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('rejects invalid --timeout values instead of silently disabling the non-browser ceiling', async () => {
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-invalid-timeout', access: 'read',
      description: 'test invalid --timeout fails upfront',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await expect(executeCommand(cmd, { timeout: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(executeCommand(cmd, { timeout: -1 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(executeCommand(cmd, { timeout: 1.5 })).rejects.toBeInstanceOf(ArgumentError);
    expect(runWithTimeoutSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('applies the user --timeout arg as the ceiling for browser commands (with +30s padding)', async () => {
    mockSetDaemonCommandTimeoutSeconds.mockClear();
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-with-timeout', access: 'read',
      description: 'test browser --timeout enforcement',
      browser: true,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(runWithTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(runWithTimeoutSpy.mock.calls[0]?.[1]).toMatchObject({
      timeout: 35,
      label: 'test-execution/browser-with-timeout',
    });
    expect(mockSetDaemonCommandTimeoutSeconds).toHaveBeenCalledWith(5);
    vi.restoreAllMocks();
  });

  it('falls back to DEFAULT_BROWSER_COMMAND_TIMEOUT for browser commands without a --timeout arg', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-no-timeout', access: 'read',
      description: 'test browser fallback to global default',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(runWithTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(runWithTimeoutSpy.mock.calls[0]?.[1]).toMatchObject({
      timeout: runtime.DEFAULT_BROWSER_COMMAND_TIMEOUT,
      label: 'test-execution/browser-no-timeout',
    });
    vi.restoreAllMocks();
  });

  describe('persistent write run ownership', () => {
    afterEach(() => {
      const activeRun = getDaemonRunContext();
      if (activeRun) clearDaemonRunContext(activeRun.runId);
      mockReleaseSiteSessionLease.mockReset().mockResolvedValue(undefined);
      vi.restoreAllMocks();
    });

    it('binds a run only for browser-backed persistent writes', async () => {
      const seen = new Map<string, ReturnType<typeof getDaemonRunContext>>();
      const mockPage = { closeWindow: vi.fn().mockResolvedValue(undefined) } as any;

      vi.spyOn(capRouting, 'shouldUseBrowserSession').mockImplementation(cmd => cmd.browser !== false);
      vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

      const makeCommand = (
        name: string,
        access: 'read' | 'write',
        browser: boolean,
        siteSession: 'ephemeral' | 'persistent',
      ) => cli({
        site: 'test-execution',
        name,
        access,
        description: 'test logical run eligibility',
        browser,
        strategy: Strategy.PUBLIC,
        siteSession,
        func: async () => {
          seen.set(name, getDaemonRunContext());
          return [{ ok: true }];
        },
      } as Parameters<typeof cli>[0]);

      await executeCommand(makeCommand('run-eligible', 'write', true, 'persistent'), {});
      await executeCommand(makeCommand('run-read', 'read', true, 'persistent'), {});
      await executeCommand(makeCommand('run-ephemeral', 'write', true, 'ephemeral'), {});
      await executeCommand(makeCommand('run-non-browser', 'write', false, 'persistent'), {});

      const eligibleRun = seen.get('run-eligible');
      expect(eligibleRun).toMatchObject({
        runId: expect.stringMatching(/^run_/),
        command: 'test-execution/run-eligible',
        access: 'write',
      });
      expect(seen.get('run-read')).toBeUndefined();
      expect(seen.get('run-ephemeral')).toBeUndefined();
      expect(seen.get('run-non-browser')).toBeUndefined();
      expect(mockReleaseSiteSessionLease).toHaveBeenCalledOnce();
      expect(mockReleaseSiteSessionLease).toHaveBeenCalledWith(eligibleRun?.runId);
    });

    it('binds one canonical run before session setup, pre-navigation, and adapter execution', async () => {
      const seen: Array<{ stage: string; run: ReturnType<typeof getDaemonRunContext> }> = [];
      const capture = (stage: string) => seen.push({ stage, run: getDaemonRunContext() });
      const mockPage = {
        closeWindow: vi.fn().mockResolvedValue(undefined),
        getCurrentUrl: vi.fn().mockImplementation(async () => {
          capture('current-url');
          return 'about:blank';
        }),
        goto: vi.fn().mockImplementation(async () => capture('pre-navigation')),
      } as any;

      vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
      vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => {
        capture('session');
        return fn(mockPage);
      });

      const cmd = cli({
        site: 'test-execution',
        name: 'run-bound-before-operations',
        access: 'write',
        description: 'test one run spans the complete adapter execution',
        browser: true,
        strategy: Strategy.COOKIE,
        domain: 'example.com',
        siteSession: 'persistent',
        func: async () => {
          capture('adapter');
          return [{ ok: true }];
        },
      });

      await expect(executeCommand(cmd, {})).resolves.toEqual([{ ok: true }]);

      expect(seen.map(entry => entry.stage)).toEqual([
        'session',
        'current-url',
        'pre-navigation',
        'adapter',
      ]);
      const runId = seen[0]?.run?.runId;
      expect(runId).toMatch(/^run_/);
      for (const entry of seen) {
        expect(entry.run).toEqual({
          runId,
          command: 'test-execution/run-bound-before-operations',
          access: 'write',
        });
      }
      expect(getDaemonRunContext()).toBeUndefined();
      expect(mockReleaseSiteSessionLease).toHaveBeenCalledOnce();
      expect(mockReleaseSiteSessionLease).toHaveBeenCalledWith(runId);
    });

    it('clears and releases the run once after an ordinary adapter error', async () => {
      let runId: string | undefined;
      const mockPage = { closeWindow: vi.fn().mockResolvedValue(undefined) } as any;
      vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
      vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

      const cmd = cli({
        site: 'test-execution',
        name: 'run-ordinary-error',
        access: 'write',
        description: 'test ordinary errors release run ownership',
        browser: true,
        strategy: Strategy.PUBLIC,
        siteSession: 'persistent',
        func: async () => {
          runId = getDaemonRunContext()?.runId;
          throw new Error('ordinary adapter failure');
        },
      });

      await expect(executeCommand(cmd, {})).rejects.toThrow('ordinary adapter failure');

      expect(runId).toMatch(/^run_/);
      expect(getDaemonRunContext()).toBeUndefined();
      expect(mockReleaseSiteSessionLease).toHaveBeenCalledOnce();
      expect(mockReleaseSiteSessionLease).toHaveBeenCalledWith(runId);
    });

    it('clears but does not release a run when an error cause has unknown outcome', async () => {
      let runId: string | undefined;
      const mockPage = { closeWindow: vi.fn().mockResolvedValue(undefined) } as any;
      vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
      vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

      const unknownOutcome = new Error('wrapped adapter failure') as Error & { cause?: unknown };
      unknownOutcome.cause = { code: 'COMMAND_RESULT_UNKNOWN' };
      const cmd = cli({
        site: 'test-execution',
        name: 'run-unknown-outcome',
        access: 'write',
        description: 'test unknown outcomes retain the daemon lease',
        browser: true,
        strategy: Strategy.PUBLIC,
        siteSession: 'persistent',
        func: async () => {
          runId = getDaemonRunContext()?.runId;
          throw unknownOutcome;
        },
      });

      await expect(executeCommand(cmd, {})).rejects.toBe(unknownOutcome);

      expect(runId).toMatch(/^run_/);
      expect(getDaemonRunContext()).toBeUndefined();
      expect(mockReleaseSiteSessionLease).not.toHaveBeenCalled();
    });

    it('does not release a run when pre-navigation has unknown outcome', async () => {
      let runId: string | undefined;
      const unknownOutcome = new Error('navigation result unknown') as Error & { cause?: unknown };
      unknownOutcome.cause = { errorCode: 'COMMAND_LOST' };
      const mockPage = {
        closeWindow: vi.fn().mockResolvedValue(undefined),
        getCurrentUrl: vi.fn().mockResolvedValue('about:blank'),
        goto: vi.fn().mockImplementation(async () => {
          runId = getDaemonRunContext()?.runId;
          throw unknownOutcome;
        }),
      } as any;
      vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
      vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

      const cmd = cli({
        site: 'test-execution',
        name: 'run-unknown-prenavigation',
        access: 'write',
        description: 'test unknown pre-navigation retains the daemon lease',
        browser: true,
        strategy: Strategy.COOKIE,
        domain: 'example.com',
        siteSession: 'persistent',
        func: async () => [{ ok: true }],
      });

      await expect(executeCommand(cmd, {})).rejects.toThrow('Pre-navigation');

      expect(runId).toMatch(/^run_/);
      expect(getDaemonRunContext()).toBeUndefined();
      expect(mockReleaseSiteSessionLease).not.toHaveBeenCalled();
    });

    it('keeps the run bound after timeout until the underlying adapter settles', async () => {
      const adapter = deferred<void>();
      let runId: string | undefined;
      const mockPage = { closeWindow: vi.fn().mockResolvedValue(undefined) } as any;
      vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
      vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));
      vi.spyOn(runtime, 'runWithTimeout').mockRejectedValueOnce(new TimeoutError('logical run', 1));

      const cmd = cli({
        site: 'test-execution',
        name: 'run-timeout',
        access: 'write',
        description: 'test timeout defers local run cleanup',
        browser: true,
        strategy: Strategy.PUBLIC,
        siteSession: 'persistent',
        func: () => {
          runId = getDaemonRunContext()?.runId;
          return adapter.promise;
        },
      });

      await expect(executeCommand(cmd, {})).rejects.toBeInstanceOf(TimeoutError);

      expect(runId).toMatch(/^run_/);
      expect(getDaemonRunContext()?.runId).toBe(runId);
      expect(mockReleaseSiteSessionLease).not.toHaveBeenCalled();

      adapter.resolve();
      await vi.waitFor(() => expect(getDaemonRunContext()).toBeUndefined());
      expect(mockReleaseSiteSessionLease).not.toHaveBeenCalled();
    });

    it('does not let deferred timeout cleanup clear a later run', async () => {
      const firstAdapter = deferred<void>();
      const secondAdapter = deferred<void>();
      let firstRunId: string | undefined;
      let secondRunId: string | undefined;
      const mockPage = { closeWindow: vi.fn().mockResolvedValue(undefined) } as any;
      vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
      vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));
      vi.spyOn(runtime, 'runWithTimeout')
        .mockRejectedValueOnce(new TimeoutError('first logical run', 1))
        .mockImplementationOnce(async promise => promise);

      const firstCommand = cli({
        site: 'test-execution',
        name: 'run-timeout-first',
        access: 'write',
        description: 'test deferred cleanup for an older run',
        browser: true,
        strategy: Strategy.PUBLIC,
        siteSession: 'persistent',
        func: () => {
          firstRunId = getDaemonRunContext()?.runId;
          return firstAdapter.promise;
        },
      });
      const secondCommand = cli({
        site: 'test-execution',
        name: 'run-timeout-second',
        access: 'write',
        description: 'test a newer run survives old deferred cleanup',
        browser: true,
        strategy: Strategy.PUBLIC,
        siteSession: 'persistent',
        func: () => {
          secondRunId = getDaemonRunContext()?.runId;
          return secondAdapter.promise;
        },
      });

      await expect(executeCommand(firstCommand, {})).rejects.toBeInstanceOf(TimeoutError);
      const secondExecution = executeCommand(secondCommand, {});
      await vi.waitFor(() => expect(secondRunId).toMatch(/^run_/));
      expect(secondRunId).not.toBe(firstRunId);

      firstAdapter.resolve();
      await firstAdapter.promise;
      await vi.waitFor(() => expect(getDaemonRunContext()?.runId).toBe(secondRunId));

      secondAdapter.resolve();
      await expect(secondExecution).resolves.toBeUndefined();
      expect(getDaemonRunContext()).toBeUndefined();
      expect(mockReleaseSiteSessionLease).toHaveBeenCalledOnce();
      expect(mockReleaseSiteSessionLease).toHaveBeenCalledWith(secondRunId);
    });
  });

  it('reuses a persistent site browser session and keeps the tab lease open', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ session?: string; idleTimeout?: number; windowMode?: string; siteSession?: string }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-persistent', access: 'read',
      description: 'test persistent site session',
      browser: true,
      strategy: Strategy.PUBLIC,
      siteSession: 'persistent',
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});
    await executeCommand(cmd, {}, false, { keepTab: 'false' });

    expect(sessionOpts).toHaveLength(2);
    expect(sessionOpts[0]).toMatchObject({ session: 'site:test-execution', windowMode: 'background', siteSession: 'persistent' });
    expect(sessionOpts[1]).toMatchObject({ session: 'site:test-execution', windowMode: 'background', siteSession: 'persistent' });
    expect(sessionOpts[0]?.idleTimeout).toBeUndefined();
    expect(sessionOpts[1]?.idleTimeout).toBeUndefined();
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('keeps default browser commands on one-shot adapter sessions', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ session?: string; idleTimeout?: number; windowMode?: string }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-default', access: 'read',
      description: 'test default one-shot browser session',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});
    await executeCommand(cmd, {});

    expect(sessionOpts).toHaveLength(2);
    expect(sessionOpts[0]?.session).toMatch(/^site:test-execution:/);
    expect(sessionOpts[1]?.session).toMatch(/^site:test-execution:/);
    expect(sessionOpts[0]?.session).not.toBe(sessionOpts[1]?.session);
    expect(sessionOpts[0]?.idleTimeout).toBeUndefined();
    expect(sessionOpts[1]?.idleTimeout).toBeUndefined();
    expect(sessionOpts[0]?.windowMode).toBe('background');
    expect(sessionOpts[1]?.windowMode).toBe('background');
    expect(closeWindow).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('lets user --site-session ephemeral override adapter persistent metadata', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ session?: string; idleTimeout?: number }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'site-session-override-ephemeral', access: 'read',
        description: 'test user site-session override',
        browser: true,
        strategy: Strategy.PUBLIC,
        siteSession: 'persistent',
        func: async () => [{ ok: true }],
      });

      await executeCommand(cmd, {}, false, { siteSession: 'ephemeral' });

      expect(sessionOpts).toHaveLength(1);
      expect(sessionOpts[0]?.session).toMatch(/^site:test-execution:/);
      expect(sessionOpts[0]?.idleTimeout).toBeUndefined();
      expect(closeWindow).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('skips repeated domain pre-navigation for persistent site sessions', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const goto = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      goto,
      getCurrentUrl: vi.fn().mockResolvedValue('https://grok.com/chat/abc'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-skip-prenav', access: 'read',
      description: 'test reused same-domain tabs do not reset conversation state',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'grok.com',
      siteSession: 'persistent',
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(goto).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('keeps explicit path pre-navigation for persistent site sessions', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const goto = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      goto,
      getCurrentUrl: vi.fn().mockResolvedValue('https://example.com/other'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-path-prenav', access: 'read',
      description: 'test explicit path pre-navigation still runs',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'example.com',
      navigateBefore: 'https://example.com/dashboard',
      siteSession: 'persistent',
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(goto).toHaveBeenCalledWith('https://example.com/dashboard');
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('respects navigateBefore=false so adapter range validation fails before browser navigation', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const goto = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      goto,
      getCurrentUrl: vi.fn().mockResolvedValue('about:blank'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-invalid-limit-no-prenav', access: 'read',
      description: 'test adapter range validation can fail before pre-nav',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'www.facebook.com',
      navigateBefore: false,
      args: [
        { name: 'limit', type: 'int', required: false, default: 15, help: 'Limit' },
      ],
      func: async (_page, args) => {
        const limit = Number(args.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new ArgumentError('--limit must be a positive integer in [1, 100]');
        }
        return [{ ok: true }];
      },
    });

    await expect(executeCommand(cmd, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(goto).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('rejects invalid --timeout values instead of falling back to the browser default', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-invalid-timeout', access: 'read',
      description: 'test invalid browser --timeout fails upfront',
      browser: true,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await expect(executeCommand(cmd, { timeout: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(executeCommand(cmd, { timeout: -1 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(executeCommand(cmd, { timeout: 1.5 })).rejects.toBeInstanceOf(ArgumentError);
    expect(runWithTimeoutSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('rejects invalid browser --timeout before opening a session or pre-navigating', async () => {
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    const browserSessionSpy = vi.spyOn(runtime, 'browserSession');

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-invalid-timeout-prenav', access: 'read',
      description: 'test invalid browser --timeout fails before session setup',
      browser: true,
      strategy: Strategy.PUBLIC,
      navigateBefore: 'https://example.com/',
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await expect(executeCommand(cmd, { timeout: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(browserSessionSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('calls closeWindow on browser command failure', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    // Mock shouldUseBrowserSession to return true
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);

    // Mock browserSession to invoke the callback with our mock page
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => {
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-close-on-error', access: 'read',
      description: 'test closeWindow on failure',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => { throw new Error('adapter failure'); },
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow('adapter failure');
    expect(closeWindow).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it('skips closeWindow when --keep-tab=true (success path)', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-keep-tab-success', access: 'read',
        description: 'test closeWindow skipped with --keep-tab on success',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => [{ ok: true }],
      });

      await executeCommand(cmd, {}, false, { keepTab: 'true' });
      expect(closeWindow).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('skips closeWindow when --keep-tab=true (failure path)', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-keep-tab-failure', access: 'read',
        description: 'test closeWindow skipped with --keep-tab on failure',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => { throw new Error('adapter failure'); },
      });

      await expect(executeCommand(cmd, {}, false, { keepTab: 'true' })).rejects.toThrow('adapter failure');
      expect(closeWindow).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('lets browser common options override adapter window and keep-tab defaults', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ windowMode?: string }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-window-options', access: 'read',
      description: 'test browser common options',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {}, false, {
      windowMode: 'foreground',
      keepTab: 'true',
    });

    expect(sessionOpts[0]).toMatchObject({ windowMode: 'foreground' });
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('uses command defaultWindowMode when the user does not pass --window', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ windowMode?: string }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-default-window-mode', access: 'write',
      description: 'test command default window mode',
      browser: true,
      strategy: Strategy.PUBLIC,
      defaultWindowMode: 'foreground',
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(sessionOpts[0]).toMatchObject({ windowMode: 'foreground' });
    vi.restoreAllMocks();
  });

  it('does not re-run custom validation when args are already prepared', async () => {
    const validateArgs = vi.fn();
    const cmd: CliCommand = {
      site: 'test-execution',
      name: 'prepared-validation', access: 'read',
      description: 'test prepared validation path',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [],
      validateArgs,
      func: async () => [],
    };

    const kwargs = prepareCommandArgs(cmd, {});
    await executeCommand(cmd, kwargs, false, { prepared: true });

    expect(validateArgs).toHaveBeenCalledTimes(1);
  });

  it('exports a profile-scoped trace artifact on browser command failure when requested', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-exec-trace-'));
    const prevConfigDir = process.env.WEBCMD_CONFIG_DIR;
    process.env.WEBCMD_CONFIG_DIR = baseDir;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      startNetworkCapture: vi.fn().mockResolvedValue(true),
      readNetworkCapture: vi.fn().mockResolvedValue([
        {
          url: 'https://api.example.com/data?token=secret',
          method: 'GET',
          responseStatus: 500,
          responseContentType: 'application/json',
          responsePreview: JSON.stringify({ password: 'secret', ok: false }),
          requestHeaders: { authorization: 'Bearer secret' },
          timestamp: Date.now(),
        },
      ]),
      consoleMessages: vi.fn().mockResolvedValue([{ type: 'error', text: 'boom password=secret', timestamp: Date.now() }]),
      snapshot: vi.fn().mockResolvedValue({ html: '<input type="password" value="secret">' }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('png').toString('base64')),
      getCurrentUrl: vi.fn().mockResolvedValue('https://api.example.com/app'),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-trace-failure', access: 'read',
        description: 'test trace export',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => { throw new Error('adapter failure'); },
      });

      const thrown = await executeCommand(cmd, {}, false, { trace: 'retain-on-failure' }).catch((err) => err);
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain('adapter failure');

      const tracesRoot = path.join(baseDir, 'profiles', 'default', 'traces');
      const traceId = fs.readdirSync(tracesRoot)[0];
      const traceDir = path.join(tracesRoot, traceId);
      expect(fs.existsSync(path.join(traceDir, 'trace.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(traceDir, 'receipt.json'))).toBe(true);
      const trace = fs.readFileSync(path.join(traceDir, 'trace.jsonl'), 'utf-8');
      expect(trace).toContain('token=[REDACTED]');
      expect(trace).toContain('"authorization":"[REDACTED]"');
      expect(trace).not.toContain('password=secret');
      expect(stderrSpy.mock.calls.flat().join('\n')).not.toContain(['___OPEN', 'CLI_TRACE___'].join(''));

      expect(toEnvelope(thrown).trace).toMatchObject({
        traceId,
        dir: traceDir,
        summaryPath: path.join(traceDir, 'summary.md'),
        receiptPath: path.join(traceDir, 'receipt.json'),
        status: 'failure',
      });
      expect(closeWindow).toHaveBeenCalledTimes(1);
    } finally {
      if (prevConfigDir === undefined) delete process.env.WEBCMD_CONFIG_DIR;
      else process.env.WEBCMD_CONFIG_DIR = prevConfigDir;
      stderrSpy.mockRestore();
      fs.rmSync(baseDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('exports a trace receipt on browser command success when trace is on', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-exec-trace-success-'));
    const prevConfigDir = process.env.WEBCMD_CONFIG_DIR;
    process.env.WEBCMD_CONFIG_DIR = baseDir;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const onTraceExport = vi.fn();
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      startNetworkCapture: vi.fn().mockResolvedValue(true),
      readNetworkCapture: vi.fn().mockResolvedValue([]),
      consoleMessages: vi.fn().mockResolvedValue([]),
      snapshot: vi.fn().mockResolvedValue('snapshot'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('png').toString('base64')),
      getCurrentUrl: vi.fn().mockResolvedValue('https://example.com'),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-trace-success', access: 'read',
        description: 'test trace export on success',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => [{ ok: true }],
      });

      await expect(executeCommand(cmd, {}, false, { trace: 'on', onTraceExport })).resolves.toEqual([{ ok: true }]);

      const stderr = stderrSpy.mock.calls.flat().join('\n');
      expect(stderr).toContain('Webcmd trace artifact:');
      const tracesRoot = path.join(baseDir, 'profiles', 'default', 'traces');
      const traceId = fs.readdirSync(tracesRoot)[0];
      const receipt = JSON.parse(fs.readFileSync(path.join(tracesRoot, traceId, 'receipt.json'), 'utf-8'));
      expect(receipt.status).toBe('success');
      expect(receipt.traceDir).toContain(path.join(baseDir, 'profiles', 'default', 'traces'));
      expect(receipt.scope).toMatchObject({
        site: 'test-execution',
        command: 'test-execution/browser-trace-success',
      });
      expect(receipt.error).toBeUndefined();
      expect(onTraceExport).toHaveBeenCalledWith(expect.objectContaining({
        traceId,
        receipt: expect.objectContaining({ status: 'success' }),
      }));
      expect(closeWindow).toHaveBeenCalledTimes(1);
    } finally {
      if (prevConfigDir === undefined) delete process.env.WEBCMD_CONFIG_DIR;
      else process.env.WEBCMD_CONFIG_DIR = prevConfigDir;
      stderrSpy.mockRestore();
      fs.rmSync(baseDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('keeps the original adapter error when trace export fails', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-exec-trace-fail-'));
    const blockedPath = path.join(baseDir, 'not-a-dir');
    fs.writeFileSync(blockedPath, 'file');
    const prevConfigDir = process.env.WEBCMD_CONFIG_DIR;
    process.env.WEBCMD_CONFIG_DIR = blockedPath;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const mockPage = {
      closeWindow: vi.fn().mockResolvedValue(undefined),
      startNetworkCapture: vi.fn().mockResolvedValue(true),
      readNetworkCapture: vi.fn().mockResolvedValue([]),
      consoleMessages: vi.fn().mockResolvedValue([]),
      snapshot: vi.fn().mockResolvedValue('snapshot'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('png').toString('base64')),
      getCurrentUrl: vi.fn().mockResolvedValue('https://example.com'),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-trace-export-fails', access: 'read',
        description: 'test trace export failure handling',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => { throw new Error('adapter failure'); },
      });

      await expect(executeCommand(cmd, {}, false, { trace: 'retain-on-failure' })).rejects.toThrow('adapter failure');
      expect(stderrSpy.mock.calls.flat().join('\n')).toContain('[trace] Failed to export trace artifact');
    } finally {
      if (prevConfigDir === undefined) delete process.env.WEBCMD_CONFIG_DIR;
      else process.env.WEBCMD_CONFIG_DIR = prevConfigDir;
      stderrSpy.mockRestore();
      fs.rmSync(baseDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});
