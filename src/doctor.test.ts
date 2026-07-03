import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetDaemonHealth,
  mockConnect,
  mockClose,
  mockFindShadowedUserAdapters,
  mockSetDaemonCommandTimeoutSeconds,
} = vi.hoisted(() => ({
  mockGetDaemonHealth: vi.fn(),
  mockConnect: vi.fn(),
  mockClose: vi.fn(),
  mockFindShadowedUserAdapters: vi.fn(),
  mockSetDaemonCommandTimeoutSeconds: vi.fn(),
}));

vi.mock('./browser/daemon-transport.js', () => ({
  getDaemonHealth: mockGetDaemonHealth,
}));

vi.mock('./browser/index.js', () => ({
  BrowserBridge: class {
    connect = mockConnect;
    close = mockClose;
  },
}));

vi.mock('./browser/daemon-client.js', () => ({
  setDaemonCommandTimeoutSeconds: mockSetDaemonCommandTimeoutSeconds,
}));

vi.mock('./adapter-shadow.js', async () => {
  const actual = await vi.importActual<typeof import('./adapter-shadow.js')>('./adapter-shadow.js');
  return {
    ...actual,
    findShadowedUserAdapters: mockFindShadowedUserAdapters,
  };
});

import { renderBrowserDoctorReport, runBrowserDoctor } from './doctor.js';

describe('doctor report rendering', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindShadowedUserAdapters.mockReturnValue([]);
    mockSetDaemonCommandTimeoutSeconds.mockClear();
    // Doctor always runs live connectivity. Tests that want connect to fail override.
    mockConnect.mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(2),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    });
    mockClose.mockResolvedValue(undefined);
  });

  it('renders OK-style report when daemon and runtime connected', () => {
    const text = strip(renderBrowserDoctorReport({
      cliVersion: '1.7.9',
      daemonRunning: true,
      daemonVersion: '1.7.9',
      runtimeConnected: true,
      runtimeName: 'Cloak',
      runtimeVersion: '1.6.8',
      issues: [],
    }));

    expect(text).toContain('[OK] Daemon: running on port 19825');
    expect(text).toContain('(v1.7.9)');
    expect(text).toContain('[OK] Runtime: Cloak connected (v1.6.8)');
    expect(text).toContain('Everything looks good!');
    expect(text).not.toContain('webcmd browser analyze <url>');
  });

  it('renders a warning when daemon version is stale', () => {
    const text = strip(renderBrowserDoctorReport({
      cliVersion: '1.7.9',
      daemonRunning: true,
      daemonVersion: '1.7.6',
      daemonStale: true,
      runtimeConnected: true,
      runtimeName: 'Cloak',
      runtimeVersion: '1.0.3',
      issues: ['Stale daemon detected: daemon v1.7.6 != CLI v1.7.9.\n  Run: webcmd daemon restart'],
    }));

    expect(text).toContain('[WARN] Daemon: running on port 19825 (v1.7.6, stale; CLI v1.7.9)');
    expect(text).toContain('Run: webcmd daemon restart');
    expect(text).not.toContain('Everything looks good!');
  });

  it('renders MISSING when daemon not running', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: false,
      runtimeConnected: false,
      issues: ['Daemon is not running.'],
    }));

    expect(text).toContain('[MISSING] Daemon: not running');
    expect(text).toContain('[MISSING] Runtime: Cloak not connected');
    expect(text).toContain('Daemon is not running.');
  });

  it('renders runtime not connected when daemon is running', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: false,
      issues: ['Daemon is running but the Cloak runtime is not connected.'],
    }));

    expect(text).toContain('[OK] Daemon: running on port 19825');
    expect(text).toContain('[MISSING] Runtime: Cloak not connected');
  });

  it('renders OK when the connected Cloak runtime version is unknown', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: true,
      runtimeName: 'Cloak',
      issues: [],
    }));

    expect(text).toContain('[OK] Runtime: Cloak connected (version unknown)');
    expect(text).not.toContain('Cloak runtime is connected but did not report a version.');
    expect(text).toContain('Everything looks good!');
  });

  it('renders connectivity OK when live test succeeds', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: true,
      connectivity: { ok: true, durationMs: 1234 },
      issues: [],
    }));

    expect(text).toContain('[OK] Connectivity: connected in 1.2s');
  });

  it('renders connected profiles when multiple are present', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: false,
      profiles: [
        { contextId: 'work', runtimeConnected: true, runtimeVersion: '1.2.3', pending: 0 },
        { contextId: 'personal', runtimeConnected: true, runtimeVersion: '1.2.3', pending: 0 },
      ],
      issues: [],
    }));

    expect(text).toContain('Profiles:');
    expect(text).toContain('work: connected v1.2.3');
    expect(text).toContain('personal: connected v1.2.3');
  });

  it('renders unstable runtime state when live connectivity and status disagree', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: true,
      runtimeFlaky: true,
      runtimeName: 'Cloak',
      connectivity: { ok: true, durationMs: 1234 },
      issues: ['Cloak runtime connection is unstable.'],
    }));

    expect(text).toContain('[WARN] Runtime: Cloak unstable');
    expect(text).toContain('Cloak runtime connection is unstable.');
  });

  it('renders unstable daemon state when live connectivity and status disagree', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: false,
      daemonFlaky: true,
      runtimeConnected: false,
      connectivity: { ok: true, durationMs: 1234 },
      issues: ['Daemon connectivity is unstable.'],
    }));

    expect(text).toContain('[WARN] Daemon: unstable');
    expect(text).toContain('Daemon connectivity is unstable.');
  });

  it('reports daemon not running when connectivity fails and daemon stays stopped', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Could not start daemon'));
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });

    const report = await runBrowserDoctor();

    expect(report.daemonRunning).toBe(false);
    expect(report.runtimeConnected).toBe(false);
    expect(report.connectivity?.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Daemon is not running'),
    ]));
  });

  it('reports flapping when live check succeeds but final status shows runtime disconnected', async () => {
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'no-runtime', status: { runtimeConnected: false, runtimeName: 'Cloak' } });

    const report = await runBrowserDoctor();

    expect(report.daemonRunning).toBe(true);
    expect(report.runtimeConnected).toBe(false);
    expect(report.runtimeFlaky).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Cloak runtime connection is unstable'),
    ]));
  });

  it('uses runtime-neutral readiness hints when the runtime is disconnected', async () => {
    mockConnect.mockRejectedValueOnce(new Error('runtime unavailable'));
    mockGetDaemonHealth.mockResolvedValueOnce({
      state: 'no-runtime',
      status: { runtimeConnected: false, runtimeName: 'Cloak' },
    });

    const report = await runBrowserDoctor();
    const issues = report.issues.join('\n');

    expect(issues).toContain('Cloak runtime is not connected');
    expect(issues).toContain('Make sure Chrome/Chromium is open and Cloak is enabled');
    expect(issues).not.toContain(`Webcmd Browser ${'Bridge'}`);
    expect(issues).not.toContain(`Load ${'unpacked'}`);
    expect(issues).not.toContain('Download the latest extension');
  });

  it('reports daemon flapping when live check succeeds but daemon disappears afterward', async () => {
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });

    const report = await runBrowserDoctor();

    expect(report.daemonRunning).toBe(false);
    expect(report.daemonFlaky).toBe(true);
    expect(report.runtimeConnected).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Daemon connectivity is unstable'),
    ]));
  });

  it('uses the fast default timeout for live connectivity checks', async () => {
    let timeoutSeen: number | undefined;
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    mockConnect.mockImplementationOnce(async (opts?: { timeout?: number; session?: string; surface?: string }) => {
      timeoutSeen = opts?.timeout;
      expect(opts?.session).toBe('__doctor__');
      expect(opts?.surface).toBe('browser');
      return {
        evaluate: vi.fn().mockResolvedValue(2),
        closeWindow,
      };
    });
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { runtimeConnected: true, runtimeName: 'Cloak' } });

    await runBrowserDoctor();

    expect(timeoutSeen).toBe(8);
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(mockSetDaemonCommandTimeoutSeconds).toHaveBeenNthCalledWith(1, 8);
    expect(mockSetDaemonCommandTimeoutSeconds).toHaveBeenLastCalledWith(null);
  });

  it('does not report an issue when the connected Cloak runtime does not report a version', async () => {
    const status = {
      state: 'ready' as const,
      status: {
        runtimeConnected: true,
        runtimeName: 'Cloak',
        runtimeVersion: undefined,
      },
    };
    mockGetDaemonHealth.mockResolvedValue(status);

    const report = await runBrowserDoctor();

    expect(report.runtimeConnected).toBe(true);
    expect(report.runtimeVersion).toBeUndefined();
    expect(report.issues.join('\n')).not.toContain('did not report a version');
  });

  it('does not compare runtime version to CLI version or cached extension updates', async () => {
    const status = {
      state: 'ready' as const,
      status: {
        daemonVersion: '1.7.9',
        runtimeConnected: true,
        runtimeName: 'Cloak',
        runtimeVersion: '99.0.0',
      },
    };
    mockGetDaemonHealth.mockResolvedValue(status);

    const report = await runBrowserDoctor({ cliVersion: '1.7.9' });

    expect(report.runtimeVersion).toBe('99.0.0');
    expect(report.issues.join('\n')).not.toContain('Extension major version mismatch');
    expect(report.issues.join('\n')).not.toContain('Extension update available');
    expect(report.issues.join('\n')).not.toContain('Download the latest extension');
  });

  it('reports an issue when daemon version differs from CLI version', async () => {
    const status = {
      state: 'ready' as const,
      status: {
        daemonVersion: '1.7.6',
        runtimeConnected: true,
        runtimeName: 'Cloak',
        runtimeVersion: '1.0.3',
      },
    };
    mockGetDaemonHealth.mockResolvedValue(status);

    const report = await runBrowserDoctor({ cliVersion: '1.7.9' });

    expect(report.daemonStale).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Stale daemon detected: daemon v1.7.6 != CLI v1.7.9'),
    ]));
  });

  it('reports local adapter shadows as a warning issue', async () => {
    const status = {
      state: 'ready' as const,
      status: {
        daemonVersion: '1.7.9',
        runtimeConnected: true,
        runtimeName: 'Cloak',
        runtimeVersion: '1.0.3',
      },
    };
    mockGetDaemonHealth.mockResolvedValue(status);
    mockFindShadowedUserAdapters.mockReturnValueOnce([
      {
        name: 'instagram/saved',
        userPath: '/home/me/.webcmd/clis/instagram/saved.js',
        builtinPath: '/pkg/clis/instagram/saved.js',
      },
    ]);

    const report = await runBrowserDoctor({ cliVersion: '1.7.9' });

    expect(report.adapterShadows).toHaveLength(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Local adapter overrides shadow packaged adapters'),
    ]));
  });

  it('reports profile-required when multiple profiles are connected without a selection', async () => {
    const status = {
      state: 'profile-required' as const,
      status: {
        runtimeConnected: false,
        runtimeName: 'Cloak',
        profileRequired: true,
        profiles: [
          { contextId: 'work', runtimeConnected: true, pending: 0 },
          { contextId: 'personal', runtimeConnected: true, pending: 0 },
        ],
      },
    };
    mockGetDaemonHealth.mockResolvedValue(status);
    // Real connectivity would fail in profile-required state; force it here so
    // the test exercises the profile-required issue path, not the flaky path.
    mockConnect.mockRejectedValueOnce(new Error('profile required'));

    const report = await runBrowserDoctor();

    expect(report.profiles).toHaveLength(2);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Multiple Chrome profiles are connected'),
    ]));
  });
});
