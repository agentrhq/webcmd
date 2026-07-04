import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BrowserCommandError,
  fetchDaemonStatus,
  getDaemonHealth,
  requestDaemonShutdown,
  sendCommand,
  setDaemonCommandTimeoutSeconds,
} from './daemon-client.js';
import * as daemonLifecycle from './daemon-lifecycle.js';

describe('daemon-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    if (typeof setDaemonCommandTimeoutSeconds === 'function') {
      setDaemonCommandTimeoutSeconds(null);
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('fetchDaemonStatus sends the shared status request and returns parsed data', async () => {
    const status = {
      ok: true,
      pid: 123,
      uptime: 10,
      runtimeConnected: true,
      runtimeName: 'fake',
      runtimeVersion: '1.2.3',
      pending: 0,
      memoryMB: 32,
      port: 19825,
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(status),
    } as Response);

    await expect(fetchDaemonStatus()).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/status$/),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Webcmd': '1' }),
      }),
    );
  });

  it('fetchDaemonStatus returns null on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fetchDaemonStatus()).resolves.toBeNull();
  });

  it('requestDaemonShutdown POSTs to the shared shutdown endpoint', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true } as Response);

    await expect(requestDaemonShutdown()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/shutdown$/),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Webcmd': '1' }),
      }),
    );
  });

  it('getDaemonHealth returns stopped when daemon is not reachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(getDaemonHealth()).resolves.toEqual({ state: 'stopped', status: null });
  });

  it('getDaemonHealth returns no-runtime when daemon is running but runtime disconnected', async () => {
    const status = {
      ok: true,
      pid: 123,
      uptime: 10,
      runtimeConnected: false,
      runtimeName: 'fake',
      pending: 0,
      memoryMB: 16,
      port: 19825,
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(status),
    } as Response);

    await expect(getDaemonHealth()).resolves.toEqual({ state: 'no-runtime', status });
  });

  it('getDaemonHealth returns ready when daemon and runtime are both connected', async () => {
    const status = {
      ok: true,
      pid: 123,
      uptime: 10,
      runtimeConnected: true,
      runtimeName: 'fake',
      runtimeVersion: '1.2.3',
      pending: 0,
      memoryMB: 32,
      port: 19825,
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(status),
    } as Response);

    await expect(getDaemonHealth()).resolves.toEqual({ state: 'ready', status });
  });

  it('getDaemonHealth returns profile-required when multiple profiles are connected without a selection', async () => {
    const status = {
      ok: true,
      pid: 123,
      uptime: 10,
      runtimeConnected: false,
      runtimeName: 'fake',
      profileRequired: true,
      profiles: [
        { contextId: 'work', runtimeConnected: true, pending: 0 },
        { contextId: 'personal', runtimeConnected: true, pending: 0 },
      ],
      pending: 0,
      memoryMB: 32,
      port: 19825,
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(status),
    } as Response);

    await expect(getDaemonHealth()).resolves.toEqual({ state: 'profile-required', status });
  });

  it('fetchDaemonStatus includes contextId in the status query', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        pid: 1,
        uptime: 0,
        runtimeConnected: true,
        runtimeName: 'fake',
        pending: 0,
        memoryMB: 1,
        port: 19825,
      }),
    } as Response);

    await fetchDaemonStatus({ contextId: 'work' });

    expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/status\?contextId=work$/);
  });

  it('rejects WEBCMD_DAEMON_PORT so CLI and extension cannot split bridge ports', async () => {
    vi.resetModules();
    vi.stubEnv('WEBCMD_DAEMON_PORT', '19999');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        pid: 1,
        uptime: 0,
        runtimeConnected: true,
        runtimeName: 'fake',
        pending: 0,
        memoryMB: 1,
        port: 19825,
      }),
    } as Response);

    const freshClient = await import('./daemon-client.js');
    await expect(freshClient.fetchDaemonStatus()).rejects.toThrow('WEBCMD_DAEMON_PORT is no longer supported');

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('sendCommand includes the current pid in generated command ids', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_000);
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'server', ok: true, data: 'ok' }),
    } as Response);

    await expect(sendCommand('exec', { code: '1 + 1' })).resolves.toBe('ok');
    await expect(sendCommand('exec', { code: '2 + 2' })).resolves.toBe('ok');

    const ids = vi.mocked(fetch).mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      return body.id;
    });

    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(new RegExp(`^cmd_${process.pid}_1763000000000_\\d+$`));
    expect(ids[1]).toMatch(new RegExp(`^cmd_${process.pid}_1763000000000_\\d+$`));
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('sendCommand forwards WEBCMD_PROFILE as command contextId', async () => {
    vi.stubEnv('WEBCMD_PROFILE', 'work');
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_000);
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'server', ok: true, data: 'ok' }),
    } as Response);

    await sendCommand('exec', { code: '1 + 1' });

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as { contextId?: string };
    expect(body.contextId).toBe('work');
  });

  it('sendCommand uses explicit windowMode before WEBCMD_WINDOW env fallback', async () => {
    vi.stubEnv('WEBCMD_WINDOW', 'foreground');
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'server', ok: true, data: 'ok' }),
    } as Response);

    await sendCommand('exec', { code: '1 + 1', windowMode: 'background' });

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as { windowMode?: string };
    expect(body.windowMode).toBe('background');
  });

  it('sendCommand treats duplicate pending ids from an old daemon as unknown instead of minting a new id', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_123);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ ok: false, error: 'Duplicate command id already pending; retry' }),
    } as Response);

    await expect(sendCommand('exec', { code: '6 * 7' })).rejects.toMatchObject({
      name: 'BrowserCommandError',
      code: 'command_result_unknown',
    } satisfies Partial<BrowserCommandError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sendCommand does not retry command_result_unknown even when the message looks transient', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({
        id: 'server',
        ok: false,
        errorCode: 'command_result_unknown',
        error: 'Extension disconnected after command timeout',
        errorHint: 'Inspect state before retrying.',
      }),
    } as Response);

    await expect(sendCommand('exec', { code: 'window.__mutate = true' })).rejects.toMatchObject({
      name: 'BrowserCommandError',
      code: 'command_result_unknown',
      hint: 'Inspect state before retrying.',
    } satisfies Partial<BrowserCommandError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sendCommand runs full bridge ensure on a pre-dispatch failure, then resends with the same id', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_321);
    const ensureSpy = vi.spyOn(daemonLifecycle, 'ensureBrowserBridgeReady').mockResolvedValue({
      health: {
        state: 'ready',
        status: {
          ok: true,
          pid: 1,
          uptime: 1,
          runtimeConnected: true,
          runtimeName: 'fake',
          pending: 0,
          memoryMB: 0,
          port: 19825,
        },
      },
      spawnedProcess: null,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({
          ok: false,
          errorCode: 'extension_not_connected',
          error: 'Extension not connected.',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'server', ok: true, data: 7 }),
      } as Response);

    await expect(sendCommand('exec', { code: '1 + 6', contextId: 'work' })).resolves.toBe(7);

    expect(ensureSpy).toHaveBeenCalledWith(expect.objectContaining({ contextId: 'work', verbose: false }));
    const ids = fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('sendCommand runs full bridge ensure on a pre-connect TypeError before resending', async () => {
    const ensureSpy = vi.spyOn(daemonLifecycle, 'ensureBrowserBridgeReady').mockResolvedValue({
      health: {
        state: 'ready',
        status: {
          ok: true,
          pid: 1,
          uptime: 1,
          runtimeConnected: true,
          runtimeName: 'fake',
          pending: 0,
          memoryMB: 0,
          port: 19825,
        },
      },
      spawnedProcess: null,
    });
    const refused = new TypeError('fetch failed');
    (refused as { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:19825'), { code: 'ECONNREFUSED' });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'server', ok: true, data: 'ok' }),
      } as Response);

    await expect(sendCommand('exec', { code: 'document.title' })).resolves.toBe('ok');

    expect(ensureSpy).toHaveBeenCalledWith(expect.objectContaining({ verbose: false }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sendCommand does not resend a post-connect TypeError because the command may have been dispatched', async () => {
    const ensureSpy = vi.spyOn(daemonLifecycle, 'ensureBrowserBridgeReady').mockResolvedValue({
      health: {
        state: 'ready',
        status: {
          ok: true,
          pid: 1,
          uptime: 1,
          runtimeConnected: true,
          runtimeName: 'fake',
          pending: 0,
          memoryMB: 0,
          port: 19825,
        },
      },
      spawnedProcess: null,
    });
    const reset = new TypeError('fetch failed');
    (reset as { cause?: unknown }).cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    vi.mocked(fetch).mockRejectedValueOnce(reset);

    await expect(sendCommand('navigate', { url: 'https://example.com' })).rejects.toMatchObject({
      name: 'BrowserCommandError',
      code: 'command_result_unknown',
    } satisfies Partial<BrowserCommandError>);

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sendCommand does NOT wait when the bridge reports profile_required', async () => {
    const ensureSpy = vi.spyOn(daemonLifecycle, 'ensureBrowserBridgeReady');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({
        ok: false,
        errorCode: 'profile_required',
        error: 'Multiple browser runtime profiles are connected; choose one with --profile.',
        errorHint: 'Run webcmd profile list, then webcmd profile use <name>.',
      }),
    } as Response);

    await expect(sendCommand('exec', { code: '1' })).rejects.toMatchObject({
      name: 'BrowserCommandError',
      code: 'profile_required',
    } satisfies Partial<BrowserCommandError>);

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sendCommand surfaces an AbortError as command_result_unknown without ensure or resend', async () => {
    const ensureSpy = vi.spyOn(daemonLifecycle, 'ensureBrowserBridgeReady');
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValueOnce(abortErr);

    await expect(sendCommand('exec', { code: 'window.__mutate = true' })).rejects.toMatchObject({
      name: 'BrowserCommandError',
      code: 'command_result_unknown',
    } satisfies Partial<BrowserCommandError>);

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sendCommand plumbs the default command timeout and absolute deadline into the request body', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_000);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'server', ok: true, data: 1 }),
    } as Response);

    await expect(sendCommand('exec', { code: '1' })).resolves.toBe(1);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { timeout?: number; deadlineAt?: number };
    expect(body.timeout).toBe(120);
    expect(body.deadlineAt).toBe(1_763_000_120_000);
  });

  it('sendCommand extends the daemon deadline past a runtime-side timeoutMs', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'server', ok: true, data: { downloaded: true } }),
    } as Response);

    await sendCommand('wait-download', { timeoutMs: 240_000 });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { timeout?: number };
    expect(body.timeout).toBe(255);
  });

  it('setDaemonCommandTimeoutSeconds raises the transport deadline for a user timeout', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'server', ok: true, data: 1 }),
    } as Response);

    setDaemonCommandTimeoutSeconds(300);

    await sendCommand('exec', { code: '1' });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { timeout?: number };
    expect(body.timeout).toBe(300);
  });

  it('client HTTP abort fires only after the daemon timeout margin', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.mocked(fetch);
      let aborted = false;
      fetchMock.mockImplementationOnce((_url, init) => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
        });
      }));

      const pending = sendCommand('exec', { code: '1' }).catch((err) => err);

      await vi.advanceTimersByTimeAsync(120_000 + 9_999);
      expect(aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(aborted).toBe(true);
      await expect(pending).resolves.toMatchObject({
        name: 'BrowserCommandError',
        code: 'command_result_unknown',
      } satisfies Partial<BrowserCommandError>);
    } finally {
      vi.useRealTimers();
    }
  });
});
