import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchDaemonStatusMock,
  requestDaemonShutdownMock,
  restartDaemonMock,
} = vi.hoisted(() => ({
  fetchDaemonStatusMock: vi.fn(),
  requestDaemonShutdownMock: vi.fn(),
  restartDaemonMock: vi.fn(),
}));

vi.mock('../browser/daemon-transport.js', () => ({
  fetchDaemonStatus: fetchDaemonStatusMock,
  requestDaemonShutdown: requestDaemonShutdownMock,
}));

vi.mock('../browser/daemon-lifecycle.js', () => ({
  restartDaemon: restartDaemonMock,
}));

import { daemonRestart, daemonStatus, daemonStop } from './daemon.js';
import { PKG_VERSION } from '../version.js';

describe('daemonStatus', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchDaemonStatusMock.mockReset();
    requestDaemonShutdownMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports "not running" when daemon is unreachable', async () => {
    fetchDaemonStatusMock.mockResolvedValue(null);

    await daemonStatus();

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  it('shows daemon info when running', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 12345,
      uptime: 3661,
      daemonVersion: PKG_VERSION,
      runtimeConnected: true,
      runtimeName: 'fake',
      runtimeVersion: '1.6.8',
      pending: 0,
      memoryMB: 64,
      port: 9777,
    });

    await daemonStatus();

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('running'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('PID 12345'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining(`v${PKG_VERSION}`));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('1h 1m'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('connected'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('v1.6.8'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('64 MB'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('9777'));
  });

  it('shows disconnected when runtime is not connected', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 99,
      uptime: 120,
      daemonVersion: PKG_VERSION,
      runtimeConnected: false,
      runtimeName: 'fake',
      pending: 0,
      memoryMB: 32,
      port: 9777,
    });

    await daemonStatus();

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
  });

  it('shows runtime name when the connected runtime does not report a version', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 99,
      uptime: 120,
      daemonVersion: PKG_VERSION,
      runtimeConnected: true,
      runtimeName: 'fake',
      runtimeVersion: undefined,
      pending: 0,
      memoryMB: 32,
      port: 9777,
    });

    await daemonStatus();

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('fake connected'));
  });
});

// ────────────────────────────────────────────────────────────────────
// GH #1575: differentiate the three "no route" states. The pre-fix
// behaviour collapsed multi-profile-no-default + profile-disconnected
// + zero-profile all to "Runtime: disconnected", sending users on
// reinstall-everything debug paths when the actual fix was
// `webcmd profile use <name>`.
// ────────────────────────────────────────────────────────────────────

describe('daemonStatus runtime label states (#1575)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchDaemonStatusMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  async function runtimeLineFor(extra: Record<string, unknown>): Promise<string | undefined> {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 99,
      uptime: 60,
      daemonVersion: PKG_VERSION,
      pending: 0,
      memoryMB: 32,
      port: 9777,
      runtimeName: 'fake',
      ...extra,
    });
    await daemonStatus();
    return stdoutSpy.mock.calls
      .map((c: unknown[]) => c[0])
      .find((line: unknown): line is string =>
        typeof line === 'string' && line.startsWith('Runtime:'));
  }

  it('prints a route hint for 2+ profiles with no default (not bare "disconnected")', async () => {
    const line = await runtimeLineFor({
      runtimeConnected: false,
      profileRequired: true,
      profiles: [
        { contextId: 'work', runtimeConnected: true, pending: 0 },
        { contextId: 'personal', runtimeConnected: true, pending: 0 },
      ],
    });
    expect(line).not.toBe('Runtime: disconnected');
    expect(line).toContain('2 profiles available');
    expect(line).toContain('webcmd profile use');
  });

  it('uses the required profile-available label for a one-profile profile-required payload', async () => {
    const line = await runtimeLineFor({
      runtimeConnected: false,
      profileRequired: true,
      profiles: [{ contextId: 'work', runtimeConnected: true, pending: 0 }],
    });
    expect(line).toContain('1 profile available');
  });

  it('prints a route hint when the requested profile is disconnected', async () => {
    const line = await runtimeLineFor({
      runtimeConnected: false,
      profileDisconnected: true,
    });
    expect(line).not.toBe('Runtime: disconnected');
    expect(line).toContain('webcmd profile use');
  });

  it('keeps the plain "disconnected" label when zero profiles are connected', async () => {
    const line = await runtimeLineFor({ runtimeConnected: false });
    expect(line).toBe('Runtime: disconnected');
  });
});

describe('daemonStop', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    fetchDaemonStatusMock.mockReset();
    requestDaemonShutdownMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports "not running" when daemon is unreachable', async () => {
    fetchDaemonStatusMock.mockResolvedValue(null);

    await daemonStop();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  it('sends shutdown and reports success', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 12345,
      uptime: 100,
      daemonVersion: PKG_VERSION,
      runtimeConnected: true,
      runtimeName: 'fake',
      pending: 0,
      memoryMB: 50,
      port: 9777,
    });
    requestDaemonShutdownMock.mockResolvedValue(true);

    await daemonStop();

    expect(requestDaemonShutdownMock).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
  });

  it('reports failure when shutdown request fails', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 12345,
      uptime: 100,
      daemonVersion: PKG_VERSION,
      runtimeConnected: true,
      runtimeName: 'fake',
      pending: 0,
      memoryMB: 50,
      port: 9777,
    });
    requestDaemonShutdownMock.mockResolvedValue(false);

    await daemonStop();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to stop daemon'));
  });
});

describe('daemonRestart', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    fetchDaemonStatusMock.mockReset();
    requestDaemonShutdownMock.mockReset();
    restartDaemonMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('restarts a running daemon and reports the new version', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 12345,
      uptime: 100,
      daemonVersion: '1.7.6',
      runtimeConnected: true,
      runtimeName: 'fake',
      profiles: [{ contextId: 'work', runtimeConnected: true, pending: 0 }],
      pending: 0,
      memoryMB: 50,
      port: 9777,
    });
    restartDaemonMock.mockResolvedValue({
      previousStatus: { daemonVersion: '1.7.6' },
      stopped: true,
      spawned: true,
      status: {
        ok: true,
        pid: 12346,
        uptime: 1,
        daemonVersion: PKG_VERSION,
        runtimeConnected: true,
        runtimeName: 'fake',
        profiles: [{ contextId: 'work', runtimeConnected: true, pending: 0 }],
        pending: 0,
        memoryMB: 51,
        port: 9777,
      },
    });

    await daemonRestart();

    expect(restartDaemonMock).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('will disconnect 1 browser profile'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(`Daemon restarted on port 9777 (v${PKG_VERSION})`));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Runtime connected; 1 profile connected'));
  });

  it('starts a new daemon when none was running', async () => {
    fetchDaemonStatusMock.mockResolvedValue(null);
    restartDaemonMock.mockResolvedValue({
      previousStatus: null,
      stopped: true,
      spawned: true,
      status: {
        ok: true,
        pid: 12346,
        uptime: 1,
        daemonVersion: PKG_VERSION,
        runtimeConnected: false,
        runtimeName: 'fake',
        pending: 0,
        memoryMB: 51,
        port: 9777,
      },
    });

    await daemonRestart();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(`Daemon started on port 9777 (v${PKG_VERSION})`));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Cloak runtime has not connected yet'));
  });

  it('reports failure when the daemon cannot stop', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 12345,
      uptime: 100,
      daemonVersion: '1.7.6',
      runtimeConnected: true,
      runtimeName: 'fake',
      pending: 0,
      memoryMB: 50,
      port: 9777,
    });
    restartDaemonMock.mockResolvedValue({
      previousStatus: { daemonVersion: '1.7.6' },
      status: { daemonVersion: '1.7.6' },
      stopped: false,
      spawned: false,
    });

    await daemonRestart();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to stop daemon before restart'));
    expect(process.exitCode).toBe(1);
  });
});
