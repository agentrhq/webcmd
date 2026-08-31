/**
 * webcmd doctor — diagnose browser connectivity.
 *
 * Simplified for the daemon-based architecture.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { binaryInfo, ensureBinary } from 'cloakbrowser';
import { DEFAULT_DAEMON_PORT } from './constants.js';
import { BrowserBridge } from './browser/index.js';
import { sendCommand, setDaemonCommandTimeoutSeconds } from './browser/daemon-client.js';
import { getDaemonHealth } from './browser/daemon-transport.js';
import { getErrorMessage } from './errors.js';
import { getRuntimeLabel } from './runtime-detect.js';
import type { BrowserProfileStatus } from './browser/daemon-transport.js';
import { aliasForContextId, loadProfileConfig } from './browser/profile.js';
import { formatDaemonVersion, isDaemonStale, staleDaemonIssue } from './browser/daemon-version.js';
import { findShadowedUserAdapters, formatAdapterShadowIssue, type AdapterShadow } from './adapter-shadow.js';
import { resolveBrowserBinaryOverride } from './browser/browser-binary.js';

const DOCTOR_LIVE_TIMEOUT_SECONDS = 8;

export type DoctorOptions = {
  yes?: boolean;
  cliVersion?: string;
};

export type ConnectivityResult = {
  ok: boolean;
  error?: string;
  durationMs: number;
};

export type BrowserBinaryStatus = {
  installed: boolean | undefined;
  path: string;
  downloadUrl?: string;
  error?: string;
  /** True when a custom executable is selected instead of the managed cache. */
  override: boolean;
  overrideEnv?: string;
};

export type DoctorReport = {
  cliVersion?: string;
  daemonRunning: boolean;
  daemonFlaky?: boolean;
  daemonStale?: boolean;
  daemonVersion?: string;
  runtimeConnected: boolean;
  runtimeFlaky?: boolean;
  runtimeName?: string;
  runtimeVersion?: string;
  binary?: BrowserBinaryStatus;
  connectivity?: ConnectivityResult;
  profiles?: BrowserProfileStatus[];
  adapterShadows?: AdapterShadow[];
  issues: string[];
};

/**
 * Required readiness checks, as opposed to `issues`, which also collects soft
 * warnings such as an unreadable adapter-override directory. An absent
 * `connectivity` means the probe never ran, which is not a failure.
 */
export function doctorRequiredChecksFailed(report: DoctorReport): boolean {
  if (!report.daemonRunning) return true;
  if (!report.runtimeConnected) return true;
  if (report.connectivity && !report.connectivity.ok) return true;
  return false;
}

function isLaunchableFile(binaryPath: string): boolean {
  try {
    if (!fs.statSync(binaryPath).isFile()) return false;
    if (process.platform === 'win32') return path.extname(binaryPath).toLowerCase() === '.exe';
    fs.accessSync(binaryPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the CloakBrowser Chromium binary is actually installed.
 * `runtimeConnected: true` only means the daemon/Cloak runtime process is
 * healthy — it says nothing about whether the browser binary CloakBrowser
 * needs to launch is present on disk.
 */
export function checkBrowserBinary(): BrowserBinaryStatus {
  const override = resolveBrowserBinaryOverride();
  if (override) {
    return {
      installed: isLaunchableFile(override.path),
      path: override.path,
      override: true,
      overrideEnv: override.envVar,
    };
  }
  try {
    const info = binaryInfo();
    return {
      installed: info.installed && isLaunchableFile(info.binaryPath),
      path: info.binaryPath,
      downloadUrl: info.downloadUrl,
      override: false,
    };
  } catch (err) {
    return { installed: undefined, path: 'unknown', error: getErrorMessage(err), override: false };
  }
}

/**
 * Test connectivity by attempting a real browser command.
 */
export async function checkConnectivity(opts?: { timeout?: number }): Promise<ConnectivityResult> {
  const start = Date.now();
  const timeoutSeconds = opts?.timeout ?? DOCTOR_LIVE_TIMEOUT_SECONDS;
  let sessionId: string | undefined;
  try {
    // A first-use download can exceed doctor's deliberately short live-probe deadline.
    if (!resolveBrowserBinaryOverride()) await ensureBinary();
    setDaemonCommandTimeoutSeconds(timeoutSeconds);
    const session = await sendCommand('session-create', { sessionName: 'Doctor Probe' }) as { id?: unknown };
    if (typeof session.id !== 'string') throw new Error('Doctor could not create a browser Session.');
    sessionId = session.id;
    const bridge = new BrowserBridge();
    const page = await bridge.connect({
      timeout: timeoutSeconds,
      session: sessionId,
      surface: 'browser',
      // Without this, windowMode is undefined, which skips the darwin `open -g`
      // launcher AND trips the explicit bringToFront() in the session manager —
      // so doctor steals focus while every other command stays backgrounded.
      windowMode: process.env.WEBCMD_WINDOW === 'foreground' ? 'foreground' : 'background',
    });
    try {
      // Try a simple eval to verify end-to-end connectivity.
      await page.evaluate('1 + 1');
      await page.closeWindow?.();
    } finally {
      await bridge.close();
    }
    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err), durationMs: Date.now() - start };
  } finally {
    if (sessionId) {
      await sendCommand('session-close', { session: sessionId, surface: 'browser', force: true, discard: true }).catch(() => undefined);
    }
    setDaemonCommandTimeoutSeconds(null);
  }
}

export async function runBrowserDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  // Live connectivity check is the core of doctor — it doubles as auto-start
  // (bridge.connect spawns daemon) and validates
  // end-to-end browser bridge health.
  const connectivity = await checkConnectivity();
  const binary = checkBrowserBinary();

  // Single status read *after* connectivity side-effects settle.
  const health = await getDaemonHealth();
  const daemonRunning = health.state !== 'stopped';
  const runtimeConnected = health.state === 'ready';
  const daemonFlaky = connectivity.ok && !daemonRunning;
  const runtimeFlaky = connectivity.ok && daemonRunning && !runtimeConnected;
  const daemonStale = isDaemonStale(health.status, opts.cliVersion);
  const profiles = health.status?.profiles;
  const runtimeName = health.status?.runtimeName;
  const runtimeVersion = health.status?.runtimeVersion;
  const issues: string[] = [];
  let adapterShadows: AdapterShadow[] = [];
  try {
    adapterShadows = findShadowedUserAdapters();
  } catch (err) {
    issues.push(`Could not check adapter overrides: ${getErrorMessage(err)}`);
  }
  if (binary.error) {
    issues.push(`Could not check CloakBrowser Chromium binary: ${binary.error}`);
  } else if (binary.installed === false) {
    const source = binary.override ? `${binary.overrideEnv} (${binary.path})` : binary.path;
    issues.push(
      `CloakBrowser Chromium is ${binary.override ? 'not launchable at' : 'not installed at'} ${source}.\n` +
      (binary.downloadUrl ? `  Download URL: ${binary.downloadUrl}\n` : '') +
      (binary.override
        ? `  Check that ${binary.overrideEnv} points at a compatible local Chromium executable.`
        : '  Check network access to the download URL above, or set WEBCMD_BROWSER_BINARY_PATH to a compatible local Chromium executable.'),
    );
  }
  if (daemonFlaky) {
    issues.push(
      'Daemon connectivity is unstable. The live browser test succeeded, but the daemon was no longer running immediately afterward.\n' +
      'This usually means the daemon crashed or exited right after serving the live probe.',
    );
  } else if (!daemonRunning) {
    issues.push('Daemon is not running. It should start automatically when you run a webcmd browser command.');
  }
  if (daemonStale && opts.cliVersion) {
    issues.push(staleDaemonIssue(health.status, opts.cliVersion));
  }
  if (runtimeFlaky) {
    issues.push(
      'Cloak runtime connection is unstable. The live browser test succeeded, but the daemon reported the runtime disconnected immediately afterward.\n' +
      'This usually means Chrome/Chromium or the Cloak runtime is still starting, reconnecting, or was suspended.',
    );
  } else if (daemonRunning && !runtimeConnected) {
    if (health.state === 'profile-required') {
      issues.push(
        'Multiple Chrome profiles are connected to the daemon, but no default profile was selected.\n' +
        '  Run webcmd profile list, then webcmd profile use <name>, or pass --profile <name>.',
      );
    } else if (health.state === 'profile-disconnected') {
      issues.push(
        `Selected browser profile is not connected: ${health.status?.contextId ?? 'unknown'}.\n` +
        '  Open that Chrome profile and make sure Cloak is enabled.',
      );
    } else {
      issues.push(
        'Daemon is running but the Cloak runtime is not connected.\n' +
        '  Make sure Chrome/Chromium is open and Cloak is enabled.\n' +
        '  If Chrome is already open, try: webcmd daemon restart',
      );
    }
  }
  if (!connectivity.ok) {
    issues.push(`Browser connectivity test failed: ${connectivity.error ?? 'unknown'}`);
  }
  const profileConfig = loadProfileConfig();
  const staleDefault = profileConfig.defaultContextId;
  if (staleDefault && profiles?.length && !profiles.some((p) => p.contextId === staleDefault)) {
    const alias = aliasForContextId(profileConfig, staleDefault);
    const label = alias ? `${alias} (${staleDefault})` : staleDefault;
    const fallbackNote = profiles.length === 1
      ? `Commands currently fall back to the only active profile: ${profiles[0].contextId}.`
      : 'Multiple profiles are active, so commands will ask you to choose.';
    issues.push(
      `Default Cloak profile is not active: ${label}.\n` +
      `  ${fallbackNote}\n` +
      '  Refresh it with: webcmd profile list, then webcmd profile use <name>.',
    );
  }
  if (adapterShadows.length > 0) {
    issues.push(formatAdapterShadowIssue(adapterShadows));
  }

  return {
    cliVersion: opts.cliVersion,
    daemonRunning,
    daemonFlaky,
    daemonStale,
    daemonVersion: health.status?.daemonVersion,
    runtimeConnected,
    runtimeFlaky,
    runtimeName,
    runtimeVersion,
    binary,
    connectivity,
    profiles,
    adapterShadows,
    issues,
  };
}

export function renderBrowserDoctorReport(report: DoctorReport): string {
  const lines = [`webcmd v${report.cliVersion ?? 'unknown'} doctor` + ` (${getRuntimeLabel()})`, ''];

  // Daemon status
  const daemonIcon = report.daemonFlaky
    ? '[WARN]'
    : report.daemonStale
      ? '[WARN]'
      : report.daemonRunning ? '[OK]' : '[MISSING]';
  const daemonLabel = report.daemonFlaky
    ? 'unstable (running during live check, then stopped)'
    : report.daemonRunning
      ? `running on port ${DEFAULT_DAEMON_PORT} (${report.daemonStale
        ? `${formatDaemonVersion(report)}, stale; CLI v${report.cliVersion ?? 'unknown'}`
        : formatDaemonVersion(report)})`
      : 'not running';
  lines.push(`${daemonIcon} Daemon: ${daemonLabel}`);

  // Runtime status
  const runtimeIcon = report.runtimeFlaky
    ? '[WARN]'
    : report.runtimeConnected ? '[OK]' : '[MISSING]';
  const runtimeVersion = !report.runtimeConnected
    ? ''
    : report.runtimeVersion
      ? ` (v${report.runtimeVersion})`
      : ' (version unknown)';
  const runtimeName = report.runtimeName ?? 'Cloak';
  const runtimeLabel = report.runtimeFlaky
    ? 'unstable (connected during live check, then disconnected)'
    : report.runtimeConnected ? 'connected' : 'not connected';
  lines.push(`${runtimeIcon} Runtime: ${runtimeName} ${runtimeLabel}${runtimeVersion}`);

  // Browser binary availability is distinct from a live daemon attachment.
  if (report.binary) {
    const binaryIcon = report.binary.installed === undefined
      ? '[WARN]'
      : report.binary.installed ? '[OK]' : '[MISSING]';
    const binaryLabel = report.binary.installed === undefined
      ? 'status unknown'
      : report.binary.installed
      ? `installed at ${report.binary.path}`
      : `${report.binary.override ? 'not launchable' : 'not installed'} (${report.binary.path})`;
    lines.push(`${binaryIcon} Browser binary: ${binaryLabel}`);
  }

  if (report.profiles && report.profiles.length > 0) {
    const config = loadProfileConfig();
    lines.push('', 'Profiles:');
    for (const profile of report.profiles) {
      const alias = aliasForContextId(config, profile.contextId);
      const aliasText = alias ? ` (${alias})` : '';
      const defaultText = config.defaultContextId === profile.contextId ? ', default' : '';
      const version = profile.runtimeVersion ? `v${profile.runtimeVersion}` : 'version unknown';
      lines.push(`  • ${profile.contextId}${aliasText}: connected ${version}${defaultText}`);
    }
  }

  // Connectivity
  if (report.connectivity) {
    const connIcon = report.connectivity.ok ? '[OK]' : '[FAIL]';
    const detail = report.connectivity.ok
      ? `connected in ${(report.connectivity.durationMs / 1000).toFixed(1)}s`
      : `failed (${report.connectivity.error ?? 'unknown'})`;
    lines.push(`${connIcon} Connectivity: ${detail}`);
  }

  if (report.issues.length) {
    lines.push('', 'Issues:');
    for (const issue of report.issues) {
      lines.push(`  • ${issue}`);
    }
  } else if (report.daemonRunning && report.runtimeConnected) {
    lines.push('', 'Everything looks good!');
  }

  return lines.join('\n');
}
