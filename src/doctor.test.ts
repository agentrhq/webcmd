import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CODES } from './errors.js';
import { getConfigPath, makeLocalConfig, saveWebcmdConfig } from './hosted/config.js';

const {
  mockGetDaemonHealth,
  mockConnect,
  mockClose,
  mockFindShadowedUserAdapters,
  mockSendCommand,
  mockSetDaemonCommandTimeoutSeconds,
  mockBinaryInfo,
  mockEnsureBinary,
} = vi.hoisted(() => ({
  mockGetDaemonHealth: vi.fn(),
  mockConnect: vi.fn(),
  mockClose: vi.fn(),
  mockFindShadowedUserAdapters: vi.fn(),
  mockSendCommand: vi.fn(),
  mockSetDaemonCommandTimeoutSeconds: vi.fn(),
  mockBinaryInfo: vi.fn(),
  mockEnsureBinary: vi.fn(),
}));

vi.mock('./browser/daemon-transport.js', async () => {
  const actual = await vi.importActual<typeof import('./browser/daemon-transport.js')>('./browser/daemon-transport.js');
  return {
    ...actual,
    getDaemonHealth: mockGetDaemonHealth,
  };
});

vi.mock('cloakbrowser', () => ({
  binaryInfo: mockBinaryInfo,
  ensureBinary: mockEnsureBinary,
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

import { checkBrowserBinary, checkConnectivity, doctorRequiredChecksFailed, renderBrowserDoctorReport, runBrowserDoctor, type DoctorReport } from './doctor.js';
import { createProgram } from './cli.js';

const managedBinaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-managed-binary-'));
const managedBinaryPath = path.join(managedBinaryDir, process.platform === 'win32' ? 'chrome.exe' : 'chrome');
fs.writeFileSync(managedBinaryPath, '#!/bin/sh\n');
if (process.platform !== 'win32') fs.chmodSync(managedBinaryPath, 0o755);
afterAll(() => fs.rmSync(managedBinaryDir, { recursive: true, force: true }));

function writeLocalConfig(browser?: Parameters<typeof makeLocalConfig>[1]): string {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-doctor-config-'));
  vi.stubEnv('WEBCMD_CONFIG_DIR', configDir);
  saveWebcmdConfig(makeLocalConfig(new Date('2026-08-31T00:00:00.000Z'), browser), { env: { WEBCMD_CONFIG_DIR: configDir } });
  return configDir;
}

describe('doctor report rendering', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const isolatedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-doctor-render-'));
  afterAll(() => fs.rmSync(isolatedConfigDir, { recursive: true, force: true }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('WEBCMD_CONFIG_DIR', isolatedConfigDir);
    mockFindShadowedUserAdapters.mockReturnValue([]);
    mockSetDaemonCommandTimeoutSeconds.mockClear();
    mockBinaryInfo.mockReturnValue({
      version: '1.0.0',
      bundledVersion: '1.0.0',
      tier: 'free',
      platform: 'linux-x64',
      binaryPath: managedBinaryPath,
      installed: true,
      cacheDir: managedBinaryDir,
      downloadUrl: 'https://example.test/download',
    });
    // Doctor always runs live connectivity. Tests that want connect to fail override.
    mockConnect.mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(2),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    });
    mockClose.mockResolvedValue(undefined);
    mockSendCommand.mockImplementation(async (action: string) => {
      if (action === 'session-create') return { id: 'doctor-probe-k7' };
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
      binary: { installed: true, path: '/Applications/Cloak Chromium.app' },
      issues: [],
    }));

    expect(text).toContain('[OK] Browser binary: installed at /Applications/Cloak Chromium.app');
  });

  it('renders the browser binary status line as MISSING when not installed', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: true,
      runtimeName: 'Cloak',
      binary: { installed: false, path: '/Applications/Cloak Chromium.app' },
      issues: ['CloakBrowser Chromium is not installed.'],
    }));

    expect(text).toContain('[MISSING] Browser binary: not installed (/Applications/Cloak Chromium.app)');
  });

  it('renders the selected browser as bundled Cloak by default', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: true,
      runtimeName: 'Cloak',
      selectedBrowser: { kind: 'cloak' },
      issues: [],
    }));

    expect(text).toContain('[OK] Selected browser: Cloak (bundled default)');
  });

  it('renders the selected browser as a custom executable path', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: true,
      runtimeName: 'custom',
      selectedBrowser: { kind: 'custom', executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
      issues: [],
    }));

    expect(text).toContain('[OK] Selected browser: custom (/Applications/Brave Browser.app/Contents/MacOS/Brave Browser)');
  });

  it('renders the selected browser as SLAB alpha', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: true,
      runtimeName: 'SLAB',
      selectedBrowser: { kind: 'slab' },
      issues: [],
    }));

    expect(text).toContain('[OK] Selected browser: SLAB (macOS alpha opt-in)');
  });

  it('uses the selected browser label when runtime name is missing', () => {
    const slab = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: false,
      selectedBrowser: { kind: 'slab' },
      issues: [],
    }));
    const custom = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      runtimeConnected: false,
      selectedBrowser: { kind: 'custom', executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
      issues: [],
    }));

    expect(slab).toContain('[MISSING] Runtime: SLAB not connected');
    expect(custom).toContain('[MISSING] Runtime: custom not connected');
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
        expect.stringContaining('Default browser profile is not active: work (profile-default)'),
      ]));
      expect(report.issues.join('\n')).toContain('fall back to the only active profile: active-profile');
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('defaults an old local config to bundled Cloak', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-doctor-legacy-config-'));
    vi.stubEnv('WEBCMD_CONFIG_DIR', configDir);
    fs.writeFileSync(
      getConfigPath({ env: { WEBCMD_CONFIG_DIR: configDir } }),
      JSON.stringify({ mode: 'local', updatedAt: '2026-08-31T00:00:00.000Z' }),
    );
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { runtimeConnected: true, runtimeName: 'Cloak' } });

    try {
      const report = await runBrowserDoctor();

      expect(report.selectedBrowser).toEqual({ kind: 'cloak' });
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('uses the configured custom executable for doctor checks', async () => {
    const configDir = writeLocalConfig({
      kind: 'custom',
      executablePath: managedBinaryPath,
    });
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { runtimeConnected: true, runtimeName: 'custom' } });

    try {
      const report = await runBrowserDoctor();

      expect(report.selectedBrowser).toEqual({
        kind: 'custom',
        executablePath: managedBinaryPath,
      });
      expect(report.binary).toMatchObject({
        installed: true,
        path: managedBinaryPath,
      });
      expect(mockEnsureBinary).not.toHaveBeenCalled();
      expect(mockBinaryInfo).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('checks only the configured SLAB runtime', async () => {
    const configDir = writeLocalConfig({ kind: 'slab' });
    mockConnect.mockRejectedValueOnce(new Error('slab runtime unavailable'));
    mockGetDaemonHealth.mockResolvedValueOnce({
      state: 'no-runtime',
      status: { runtimeConnected: false, runtimeName: 'SLAB' },
    });

    try {
      const report = await runBrowserDoctor();
      const text = strip(renderBrowserDoctorReport(report));
      const issues = report.issues.join('\n');

      expect(report.selectedBrowser).toEqual({ kind: 'slab' });
      expect(report.binary).toBeUndefined();
      expect(mockEnsureBinary).not.toHaveBeenCalled();
      expect(mockBinaryInfo).not.toHaveBeenCalled();
      expect(text).toContain('[OK] Selected browser: SLAB (macOS alpha opt-in)');
      expect(text).not.toContain('Browser binary:');
      expect(issues).toContain('SLAB runtime is not connected');
      expect(issues).not.toContain('Cloak runtime is not connected');
      expect(issues).not.toContain('Chrome/Chromium');
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

  it('uses SLAB wording when the selected SLAB runtime flaps', async () => {
    const configDir = writeLocalConfig({ kind: 'slab' });
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'no-runtime', status: { runtimeConnected: false } });

    try {
      const report = await runBrowserDoctor();
      const issues = report.issues.join('\n');
      const text = strip(renderBrowserDoctorReport(report));

      expect(report.runtimeFlaky).toBe(true);
      expect(issues).toContain('SLAB runtime connection is unstable');
      expect(issues).not.toContain('Cloak runtime connection is unstable');
      expect(text).toContain('[WARN] Runtime: SLAB unstable');
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('uses custom wording when the selected custom runtime flaps', async () => {
    const configDir = writeLocalConfig({ kind: 'custom', executablePath: managedBinaryPath });
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'no-runtime', status: { runtimeConnected: false } });

    try {
      const report = await runBrowserDoctor();
      const issues = report.issues.join('\n');
      const text = strip(renderBrowserDoctorReport(report));

      expect(report.runtimeFlaky).toBe(true);
      expect(issues).toContain('custom runtime connection is unstable');
      expect(issues).not.toContain('Cloak runtime connection is unstable');
      expect(text).toContain('[WARN] Runtime: custom unstable');
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('uses Cloak readiness hints when the runtime is disconnected', async () => {
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

  it('uses a temporary named Session for live connectivity checks', async () => {
    let timeoutSeen: number | undefined;
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    mockConnect.mockImplementationOnce(async (opts?: { timeout?: number; session?: string; surface?: string }) => {
      timeoutSeen = opts?.timeout;
      expect(opts?.session).toBe('doctor-probe-k7');
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
    expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'session-create', { sessionName: 'Doctor Probe' });
    expect(mockSendCommand).toHaveBeenLastCalledWith('session-close', {
      session: 'doctor-probe-k7',
      surface: 'browser',
      force: true,
      discard: true,
    });
    expect(mockSetDaemonCommandTimeoutSeconds).toHaveBeenNthCalledWith(1, 8);
    expect(mockSetDaemonCommandTimeoutSeconds).toHaveBeenLastCalledWith(null);
  });

  it('installs the browser binary before starting the timed live probe', async () => {
    let finishInstall!: () => void;
    mockEnsureBinary.mockReturnValueOnce(new Promise<string>((resolve) => {
      finishInstall = () => resolve(managedBinaryPath);
    }));

    const connectivity = checkConnectivity();
    await vi.waitFor(() => expect(mockEnsureBinary).toHaveBeenCalledTimes(1));

    expect(mockSetDaemonCommandTimeoutSeconds).not.toHaveBeenCalled();
    expect(mockSendCommand).not.toHaveBeenCalled();

    finishInstall();
    await expect(connectivity).resolves.toMatchObject({ ok: true });
    expect(mockSetDaemonCommandTimeoutSeconds).toHaveBeenNthCalledWith(1, 8);
    expect(mockSendCommand).toHaveBeenNthCalledWith(1, 'session-create', { sessionName: 'Doctor Probe' });
    expect(mockSendCommand).toHaveBeenLastCalledWith('session-close', {
      session: 'doctor-probe-k7',
      surface: 'browser',
      force: true,
      discard: true,
    });
  });

  it('reports binary installation failures without creating a Session', async () => {
    mockEnsureBinary.mockRejectedValueOnce(new Error('binary download failed'));

    await expect(checkConnectivity()).resolves.toMatchObject({
      ok: false,
      error: 'binary download failed',
    });
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockSetDaemonCommandTimeoutSeconds).toHaveBeenCalledTimes(1);
    expect(mockSetDaemonCommandTimeoutSeconds).toHaveBeenCalledWith(null);
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
      expect.stringContaining('Multiple browser profiles are connected'),
    ]));
  });

  describe('Cloak browser binary status', () => {
    it('reports an installed browser binary without altering a generic connectivity failure', async () => {
      mockConnect.mockRejectedValueOnce(new Error('page.goto: Target page, context or browser has been closed'));
      mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { runtimeConnected: true, runtimeName: 'Cloak' } });

      const report = await runBrowserDoctor();

      expect(report.binary).toMatchObject({ installed: true, path: managedBinaryPath });
      expect(report.issues).toEqual(expect.arrayContaining([
        expect.stringContaining('Browser connectivity test failed: page.goto: Target page, context or browser has been closed'),
      ]));
      expect(report.issues.join('\n')).not.toContain('CloakBrowser Chromium is not installed');
    });

    it('reports a missing binary without claiming a download was attempted', async () => {
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
      expect(issueText).toContain('CloakBrowser Chromium is not installed');
      expect(issueText).toContain('/home/test/.cloakbrowser/chromium-146.0.7680.177.5/chrome');
      expect(issueText).toContain('https://cloakbrowser.dev/chromium-v146.0.7680.177.5/cloakbrowser-linux-x64.tar.gz');
      expect(issueText).toContain('Browser connectivity test failed: fetch failed');
      expect(issueText).toContain('Check network access to the download URL above.');
      expect(issueText).not.toContain('could not be downloaded');
      expect(issueText).not.toContain('download failed');
    });

    it('preserves a session-create connectivity failure alongside missing-binary facts', async () => {
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
      mockSendCommand.mockRejectedValueOnce(new Error('session-create refused'));
      mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { runtimeConnected: true, runtimeName: 'Cloak' } });

      const report = await runBrowserDoctor();
      const issueText = report.issues.join('\n');

      expect(report.binary?.installed).toBe(false);
      expect(report.connectivity).toMatchObject({ ok: false, error: 'session-create refused' });
      expect(issueText).toContain('CloakBrowser Chromium is not installed');
      expect(issueText).toContain('Browser connectivity test failed: session-create refused');
    });

    it('reports failed browser binary checks as warnings', async () => {
      mockBinaryInfo.mockImplementationOnce(() => { throw new Error('corrupt CloakBrowser metadata'); });
      mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { runtimeConnected: true, runtimeName: 'Cloak' } });

      const report = await runBrowserDoctor();
      const text = strip(renderBrowserDoctorReport(report));

      expect(report.binary?.installed).toBeUndefined();
      expect(report.issues.join('\n')).toContain('Could not check CloakBrowser Chromium binary: corrupt CloakBrowser metadata');
      expect(text).toContain('[WARN] Browser binary: status unknown');
      expect(text).not.toContain('[OK] Browser binary');
      expect(text).not.toContain('Everything looks good!');
    });

    it('ignores retired browser-binary environment variables and uses the managed binary', async () => {
      vi.stubEnv('WEBCMD_BROWSER_BINARY_PATH', '/does/not/exist/webcmd-chrome');
      vi.stubEnv('CLOAKBROWSER_BINARY_PATH', '/does/not/exist/cloak-chrome');

      expect(checkBrowserBinary()).toMatchObject({ installed: true, path: managedBinaryPath });
      await checkConnectivity();
      expect(mockEnsureBinary).toHaveBeenCalledOnce();
    });

    it('rejects a managed non-executable binary on POSIX', () => {
      if (process.platform === 'win32') return;
      const binaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-managed-non-executable-'));
      const binaryPath = path.join(binaryDir, 'chrome');
      fs.writeFileSync(binaryPath, '#!/bin/sh\n', { mode: 0o644 });
      mockBinaryInfo.mockReturnValue({
        version: '1.0.0', bundledVersion: '1.0.0', tier: 'free', platform: 'linux-x64',
        binaryPath, installed: true, cacheDir: binaryDir, downloadUrl: 'https://example.test/download',
      });
      try {
        expect(checkBrowserBinary().installed).toBe(false);
      } finally {
        fs.rmSync(binaryDir, { recursive: true, force: true });
      }
    });

    it('rejects a non-exe binary file on Windows', () => {
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      const binaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-windows-binary-'));
      const binaryPath = path.join(binaryDir, 'chrome.txt');
      fs.writeFileSync(binaryPath, 'not an executable');
      try {
        Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
        mockBinaryInfo.mockReturnValue({
          version: '1.0.0', bundledVersion: '1.0.0', tier: 'free', platform: 'win32-x64',
          binaryPath, installed: true, cacheDir: binaryDir, downloadUrl: 'https://example.test/download',
        });
        expect(checkBrowserBinary().installed).toBe(false);
      } finally {
        if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
        vi.unstubAllEnvs();
        fs.rmSync(binaryDir, { recursive: true, force: true });
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

describe('doctorRequiredChecksFailed', () => {
  const healthy: DoctorReport = {
    daemonRunning: true,
    runtimeConnected: true,
    connectivity: { ok: true, durationMs: 12 },
    issues: [],
  };

  it('passes when every required check is healthy', () => {
    expect(doctorRequiredChecksFailed(healthy)).toBe(false);
  });

  it('passes when only a soft issue was recorded', () => {
    expect(doctorRequiredChecksFailed({
      ...healthy,
      issues: ['Could not check adapter overrides: EACCES'],
    })).toBe(false);
  });

  it.each([
    ['daemon down', { ...healthy, daemonRunning: false }],
    ['runtime disconnected', { ...healthy, runtimeConnected: false }],
    ['connectivity failed', { ...healthy, connectivity: { ok: false, durationMs: 9 } }],
  ])('fails when %s', (_label, report) => {
    expect(doctorRequiredChecksFailed(report as DoctorReport)).toBe(true);
  });

  it('passes when connectivity was not probed at all', () => {
    const { connectivity: _omitted, ...withoutConnectivity } = healthy;
    expect(doctorRequiredChecksFailed(withoutConnectivity as DoctorReport)).toBe(false);
  });
});

describe('doctor command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureBinary.mockResolvedValue('path/to/chrome');
    mockBinaryInfo.mockReturnValue({
      version: '146.0.7680.177.5',
      bundledVersion: '146.0.7680.177.5',
      tier: 'free',
      platform: 'linux-x64',
      binaryPath: '/path/to/chrome',
      installed: true,
      cacheDir: '/cache',
      downloadUrl: 'https://example.com/download',
    });
    mockConnect.mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(2),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    });
    mockClose.mockResolvedValue(undefined);
    mockSendCommand.mockImplementation(async (action: string) => {
      if (action === 'session-create') return { id: 'doctor-probe-k7' };
      if (action === 'session-close') return { closed: true };
      throw new Error(`Unexpected doctor command: ${action}`);
    });
    mockFindShadowedUserAdapters.mockReturnValue([]);
    mockSetDaemonCommandTimeoutSeconds.mockClear();
  });

  it('exits CONFIG_ERROR when a required doctor check fails', async () => {
    mockGetDaemonHealth.mockResolvedValue({ state: 'stopped', status: null });
    const previous = process.exitCode;
    process.exitCode = undefined;
    try {
      await createProgram('', '').parseAsync(['doctor', '-f', 'json'], { from: 'user' });
      expect(process.exitCode).toBe(EXIT_CODES.CONFIG_ERROR);
    } finally {
      process.exitCode = previous;
    }
  });
});
