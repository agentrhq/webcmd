/**
 * CLI commands for daemon lifecycle:
 *   webcmd daemon status — show daemon state
 *   webcmd daemon stop   — graceful shutdown
 *   webcmd daemon restart — graceful shutdown, then start a fresh daemon
 */

import { fetchDaemonStatus, requestDaemonShutdown } from '../browser/daemon-transport.js';
import { restartDaemon } from '../browser/daemon-lifecycle.js';
import { formatDuration } from '../download/progress.js';
import { log } from '../logger.js';
import { PKG_VERSION } from '../version.js';
import { formatDaemonVersion, isDaemonStale } from '../browser/daemon-version.js';

export async function daemonStatus(): Promise<void> {
  const status = await fetchDaemonStatus();
  if (!status) {
    console.log('Daemon: not running');
    return;
  }

  // GH #1575: ``Runtime: disconnected`` used to be printed for THREE
  // structurally different states — zero profiles (accurate), 2+
  // profiles connected with no default (misleading), and a requested
  // profile that vanished (misleading). The status JSON already
  // distinguishes them; surface that distinction so the user's next
  // step is visible inline instead of "reinstall everything".
  const runtimeLabel = status.runtimeConnected
    ? status.runtimeVersion
      ? `${status.runtimeName} connected (v${status.runtimeVersion})`
      : `${status.runtimeName} connected`
    : status.profileRequired
      ? `${status.profiles?.length ?? 0} ${status.profiles?.length === 1 ? 'profile' : 'profiles'} available, none selected — run \`webcmd profile use <name>\``
      : status.profileDisconnected
        ? 'requested profile not connected — run `webcmd profile use <name>`'
        : 'disconnected';

  const daemonVersion = formatDaemonVersion(status);
  const stale = isDaemonStale(status, PKG_VERSION);
  console.log(`Daemon: ${stale ? 'stale' : 'running'} (PID ${status.pid})`);
  console.log(`Version: ${daemonVersion}${stale ? ` (CLI v${PKG_VERSION}; run: webcmd daemon restart)` : ''}`);
  console.log(`Uptime: ${formatDuration(Math.round(status.uptime * 1000))}`);
  console.log(`Runtime: ${runtimeLabel}`);
  if (status.profiles && status.profiles.length > 0) {
    console.log(`Profiles: ${status.profiles.map((profile) => {
      const version = profile.runtimeVersion ? ` v${profile.runtimeVersion}` : '';
      return `${profile.contextId}${version}`;
    }).join(', ')}`);
  }
  console.log(`Memory: ${status.memoryMB} MB`);
  console.log(`Port: ${status.port}`);
}

export async function daemonStop(): Promise<void> {
  const status = await fetchDaemonStatus();
  if (!status) {
    log.info('Daemon is not running.');
    return;
  }

  const ok = await requestDaemonShutdown();
  if (ok) {
    log.success('Daemon stopped.');
  } else {
    log.error('Failed to stop daemon.');
    process.exitCode = 1;
  }
}

export async function daemonRestart(): Promise<void> {
  const before = await fetchDaemonStatus();
  if (before?.profiles && before.profiles.length > 0) {
    log.warn(`Restarting daemon will disconnect ${before.profiles.length} browser ${before.profiles.length === 1 ? 'profile' : 'profiles'}; Cloak should reconnect automatically.`);
  }

  const result = await restartDaemon();
  if (!result.stopped) {
    log.error('Failed to stop daemon before restart.');
    process.exitCode = 1;
    return;
  }
  if (!result.status) {
    log.error('Daemon restart timed out before the new daemon reported status.');
    process.exitCode = 1;
    return;
  }

  const action = result.previousStatus ? 'restarted' : 'started';
  const version = formatDaemonVersion(result.status);
  log.success(`Daemon ${action} on port ${result.status.port} (${version}).`);
  if (result.status.runtimeConnected) {
    const profiles = result.status.profiles?.length ?? 0;
    const profileText = profiles > 0 ? `; ${profiles} ${profiles === 1 ? 'profile' : 'profiles'} connected` : '';
    log.status(`Runtime connected${profileText}.`);
  } else {
    log.warn('Daemon is running, but the Cloak runtime has not connected yet.');
  }
}
