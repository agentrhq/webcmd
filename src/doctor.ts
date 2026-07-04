/**
 * webcmd doctor — diagnose browser connectivity.
 *
 * Simplified for the daemon-based architecture.
 */

import { DEFAULT_DAEMON_PORT } from './constants.js';
import { BrowserBridge } from './browser/index.js';
import { setDaemonCommandTimeoutSeconds } from './browser/daemon-client.js';
import { getDaemonHealth } from './browser/daemon-transport.js';
import { getErrorMessage } from './errors.js';
import { getRuntimeLabel } from './runtime-detect.js';
import type { BrowserProfileStatus } from './browser/daemon-transport.js';
import { aliasForContextId, loadProfileConfig } from './browser/profile.js';
import { formatDaemonVersion, isDaemonStale, staleDaemonIssue } from './browser/daemon-version.js';
import { findShadowedUserAdapters, formatAdapterShadowIssue, type AdapterShadow } from './adapter-shadow.js';

const DOCTOR_LIVE_TIMEOUT_SECONDS = 8;
const DOCTOR_SESSION = '__doctor__';

export type DoctorOptions = {
  yes?: boolean;
  cliVersion?: string;
};

export type ConnectivityResult = {
  ok: boolean;
  error?: string;
  durationMs: number;
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
  connectivity?: ConnectivityResult;
  profiles?: BrowserProfileStatus[];
  adapterShadows?: AdapterShadow[];
  issues: string[];
};

/**
 * Test connectivity by attempting a real browser command.
 */
export async function checkConnectivity(opts?: { timeout?: number }): Promise<ConnectivityResult> {
  const start = Date.now();
  const timeoutSeconds = opts?.timeout ?? DOCTOR_LIVE_TIMEOUT_SECONDS;
  setDaemonCommandTimeoutSeconds(timeoutSeconds);
  try {
    const bridge = new BrowserBridge();
    const page = await bridge.connect({
      timeout: timeoutSeconds,
      session: DOCTOR_SESSION,
      surface: 'browser',
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
    setDaemonCommandTimeoutSeconds(null);
  }
}

export async function runBrowserDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  // Live connectivity check is the core of doctor — it doubles as auto-start
  // (bridge.connect spawns daemon) and validates end-to-end browser bridge health.
  const connectivity = await checkConnectivity();

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
  const adapterShadows = findShadowedUserAdapters();

  const issues: string[] = [];
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
