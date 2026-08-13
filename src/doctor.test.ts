import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetDaemonHealth,
  mockConnect,
  mockClose,
  mockFindShadowedUserAdapters,
  mockSendCommand,
  mockSetDaemonCommandTimeoutSeconds,
  mockBinaryInfo,
} = vi.hoisted(() => ({
  mockGetDaemonHealth: vi.fn(),
  mockConnect: vi.fn(),
  mockClose: vi.fn(),
  mockFindShadowedUserAdapters: vi.fn(),
  mockSendCommand: vi.fn(),
  mockSetDaemonCommandTimeoutSeconds: vi.fn(),
  mockBinaryInfo: vi.fn(),
}));

vi.mock('./browser/daemon-transport.js', () => ({
  getDaemonHealth: mockGetDaemonHealth,
}));

// Real binaryInfo() reads this machine's actual CloakBrowser cache dir, which
// varies by dev box/CI runner — mock it so doctor tests are hermetic and the
// #239 binary-missing path can be exercised deterministically.
vi.mock('cloakbrowser', () => ({
  binaryInfo: mockBinaryInfo,
}));

vi.mock('./browser/index.js', () => ({
  BrowserBridge: class {
    connect = mockConnect;
    close = mockClose;
  },
}));

vi.mock('./browser/daemon-client.js', () => ({
  sendCommand: mockSendCommand,
  setDaemonCommandTimeoutSeconds: mockSetDaemonCommandTimeoutSeconds,
}));

vi.mock('./adapter-shadow.js', async () => {
  const actual = await vi.importActual<typeof import('./adapter-shadow.js')>('./adapter-shadow.js');
  return {
    ...actual,
    findShadowedUserAdapters: mockFindShadowedUserAdapters,
  };
});

import { checkBrowserBinary, checkConnectivity, renderBrowserDoctorReport, runBrowserDoctor } from './doctor.js';

describe('doctor report rendering', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockFindShadowedUserAdapters.mockReturnValue([]);
    mockSetDaemonCommandTimeoutSeconds.mockClear();
    // Installed by default so pre-existing tests exercise the generic
    // connectivity-failure path, not the #239 binary-missing path.
    mockBinaryInfo.mockReturnValue({
      version: '146.0.7680.177.5',
      bundledVersion: '146.0.7680.177.5',
      tier: 'free',
      platform: 'linux-x64',
      binaryPath: '/home/test/.cloakbrowser/chromium-146.0.7680.177.5/chrome',
      installed: true,
      cacheDir: '/home/test/.cloakbrowser/chromium-146.0.7680.177.5',
      downloadUrl: 'https://cloakbrowser.dev/chromium-v146.0.7680.177.5/cloakbrowser-linux-x64.tar.gz',
    });
    // Doctor always runs live connectivity. Tests that want connect to fail override.
    mockConnect.mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(2),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    });
    mockClose.mockResolvedValue(undefined);
    mockSendCommand.mockImplementation(async (action: string) => {
      if (action === 'session-create') return { id: 'session_doctor_11111111' };
      if (action === 'session-close') return { closed: true };
      throw new Error(`Unexpected doctor command: ${action}`);
    });
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

    expect(text).toContain('[OK] Daemon: running on port 9777');
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

    expect(text).toContain('[WARN] Daemon: running on port 9777 (v1.7.6, stale; CLI v1.7.9)');
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

    expect(text).toContain('[OK] Daemon: running on port 9777');
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

  it('renders the browser binary status line when installed', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: true,
      runtimeName: 'Cloak',
      binary: { installed: true, path: '/home/test/.cloakbrowser/chromium-1.0.0/chrome', override: false },
      issues: [],
    }));

    expect(text).toContain('[OK] Browser binary: installed at /home/test/.cloakbrowser/chromium-1.0.0/chrome');
  });

  it('renders the browser binary status line as MISSING when not installed', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: true,
      runtimeName: 'Cloak',
      binary: { installed: false, path: '/home/test/.cloakbrowser/chromium-1.0.0/chrome', override: false },
      issues: ['CloakBrowser Chromium is not installed and could not be downloaded at ...'],
    }));

    expect(text).toContain('[MISSING] Browser binary: not installed (/home/test/.cloakbrowser/chromium-1.0.0/chrome)');
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

  it('reports a stale default Cloak profile when it is not active', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-doctor-profile-'));
    fs.writeFileSync(
      path.join(configDir, 'browser-profiles.json'),
      JSON.stringify({ version: 1, aliases: { work: 'profile-default' }, defaultContextId: 'profile-default' }),
    );
    vi.stubEnv('WEBCMD_CONFIG_DIR', configDir);
    try {
      mockGetDaemonHealth.mockResolvedValueOnce({
        state: 'ready',
        status: {
          runtimeConnected: true,
          runtimeName: 'Cloak',
          profiles: [{ contextId: 'active-profile', runtimeConnected: true, pending: 0 }],
        },
      });

      const report = await runBrowserDoctor();

      expect(report.issues).toEqual(expect.arrayContaining([
        expect.stringContaining('Default Cloak profile is not active: work (profile-default)'),
      ]));
      expect(report.issues.join('\n')).toContain('fall back to the only active profile: active-profile');
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
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

  it('uses a temporary opaque Session for live connectivity checks', async () => {
    let timeoutSeen: number | undefined;
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    mockConnect.mockImplementationOnce(async (opts?: { timeout?: number; session?: string; surface?: string }) => {
      timeoutSeen = opts?.timeout;
      expect(opts?.session).toBe('session_doctor_11111111');
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
    expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'session-create', {});
    expect(mockSendCommand).toHaveBeenLastCalledWith('session-close', {
      session: 'session_doctor_11111111',
      surface: 'browser',
      force: true,
      discard: true,
    });
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
        pluginPath: '/home/me/.webcmd/plugins/instagram/saved.js',
        plugin: 'instagram',
        hasProvenance: false,
      },
    ]);

    const report = await runBrowserDoctor({ cliVersion: '1.7.9' });

    expect(report.adapterShadows).toHaveLength(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Local adapter overrides shadow installed plugin adapters'),
    ]));
  });

  it('reports a diagnostic issue instead of throwing when adapter shadow detection fails', async () => {
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
    mockFindShadowedUserAdapters.mockImplementationOnce(() => {
      throw new Error('Malformed override provenance store at /home/me/.webcmd/override-provenance.json: invalid JSON');
    });

    const report = await runBrowserDoctor({ cliVersion: '1.7.9' });

    expect(report.adapterShadows).toEqual([]);
    expect(report.daemonRunning).toBe(true);
    expect(report.runtimeConnected).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Could not check adapter overrides: Malformed override provenance store'),
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

  describe('#239 — missing browser binary', () => {
    it('reports the binary as installed and does not alter the generic failure message when present', async () => {
      mockConnect.mockRejectedValueOnce(new Error('page.goto: Target page, context or browser has been closed'));
      mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { runtimeConnected: true, runtimeName: 'Cloak' } });

      const report = await runBrowserDoctor();

      expect(report.binary?.installed).toBe(true);
      expect(report.issues).toEqual(expect.arrayContaining([
        expect.stringContaining('Browser connectivity test failed: page.goto: Target page, context or browser has been closed'),
      ]));
    });

    it('distinguishes a missing/undownloaded binary from a generic connectivity failure', async () => {
      mockBinaryInfo.mockReturnValue({
        version: '146.0.7680.177.5',
        bundledVersion: '146.0.7680.177.5',
        tier: 'free',
        platform: 'linux-x64',
        binaryPath: '/home/test/.cloakbrowser/chromium-146.0.7680.177.5/chrome',
        installed: false,
        cacheDir: '/home/test/.cloakbrowser/chromium-146.0.7680.177.5',
        downloadUrl: 'https://cloakbrowser.dev/chromium-v146.0.7680.177.5/cloakbrowser-linux-x64.tar.gz',
      });
      mockConnect.mockRejectedValueOnce(new Error('fetch failed'));
      mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { runtimeConnected: true, runtimeName: 'Cloak' } });

      const report = await runBrowserDoctor();

      expect(report.binary?.installed).toBe(false);
      const issueText = report.issues.join('\n');
      expect(issueText).toContain('CloakBrowser Chromium is not installed and could not be downloaded');
      expect(issueText).toContain('/home/test/.cloakbrowser/chromium-146.0.7680.177.5/chrome');
      expect(issueText).toContain('https://cloakbrowser.dev/chromium-v146.0.7680.177.5/cloakbrowser-linux-x64.tar.gz');
      expect(issueText).toContain('Underlying error: fetch failed');
      expect(issueText).toContain('CLOAKBROWSER_BINARY_PATH');
      // The old generic message must not also appear — one clear diagnostic, not two.
      expect(issueText).not.toContain('Browser connectivity test failed: fetch failed');
    });

    it('treats CLOAKBROWSER_BINARY_PATH as the effective binary check, not the managed cache', async () => {
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');
      const overridePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-binary-override-')), 'chrome');
      fs.writeFileSync(overridePath, '#!/bin/sh\n');
      vi.stubEnv('CLOAKBROWSER_BINARY_PATH', overridePath);
      try {
        // Managed cache would report "not installed" — the override should win.
        mockBinaryInfo.mockReturnValue({
          version: '1.0.0', bundledVersion: '1.0.0', tier: 'free', platform: 'linux-x64',
          binaryPath: '/home/test/.cloakbrowser/chromium-1.0.0/chrome', installed: false,
          cacheDir: '/home/test/.cloakbrowser/chromium-1.0.0', downloadUrl: 'https://example.test/download',
        });

        const binary = checkBrowserBinary();

        expect(binary.installed).toBe(true);
        expect(binary.override).toBe(true);
        expect(binary.path).toBe(overridePath);
      } finally {
        vi.unstubAllEnvs();
        fs.rmSync(path.dirname(overridePath), { recursive: true, force: true });
      }
    });

    it('reports override-specific guidance when CLOAKBROWSER_BINARY_PATH points nowhere', async () => {
      vi.stubEnv('CLOAKBROWSER_BINARY_PATH', '/does/not/exist/chrome');
      try {
        mockConnect.mockRejectedValueOnce(new Error('spawn /does/not/exist/chrome ENOENT'));
        mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { runtimeConnected: true, runtimeName: 'Cloak' } });

        const report = await runBrowserDoctor();

        expect(report.binary?.installed).toBe(false);
        expect(report.binary?.override).toBe(true);
        const issueText = report.issues.join('\n');
        expect(issueText).toContain('CLOAKBROWSER_BINARY_PATH (/does/not/exist/chrome)');
        expect(issueText).toContain('compatible local Chromium executable');
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});

describe('doctor window mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockConnect.mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(2),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    });
    mockClose.mockResolvedValue(undefined);
  });

  // Omitting windowMode leaves it undefined, which skips the darwin `open -g`
  // launcher and trips the explicit bringToFront() in the session manager —
  // doctor steals focus while every other command stays backgrounded.
  it('connects in background by default', async () => {
    await checkConnectivity();
    expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({ windowMode: 'background' }));
  });

  it('honors WEBCMD_WINDOW=foreground', async () => {
    vi.stubEnv('WEBCMD_WINDOW', 'foreground');
    await checkConnectivity();
    expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({ windowMode: 'foreground' }));
    vi.unstubAllEnvs();
  });
});
