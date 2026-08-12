/**
 * `webcmd update` — self-update the globally installed package.
 *
 * Reuses the same install command the update notice prints (see update-check.ts),
 * so the manual and automatic paths stay in sync. Runs under Bun when the CLI
 * itself is running under Bun; otherwise npm.
 */

import { execFileSync } from 'node:child_process';
import { PACKAGE_NAME } from './brand.js';
import { PKG_VERSION } from './version.js';
import { _buildUpdateNotices, readUpdateCache } from './update-check.js';

export interface UpgradeCommand {
  cmd: string;
  args: string[];
}

/** Build the global-install command for the running runtime. Pure; exported for tests. */
export function buildUpgradeCommand(spec: string = `${PACKAGE_NAME}@latest`): UpgradeCommand {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
  return isBun
    ? { cmd: 'bun', args: ['add', '-g', spec] }
    : { cmd: 'npm', args: ['install', '-g', spec] };
}

/**
 * Notice for the separately-shipped Cloak runtime/extension, which `npm install -g`
 * does NOT update. Returns the notice text when a newer runtime is known, else
 * undefined. Currently dormant until update-check URLs are enabled upstream.
 */
export function getRuntimeUpdateNotice(): string | undefined {
  return _buildUpdateNotices({
    cliVersion: PKG_VERSION,
    cache: readUpdateCache(),
    now: Date.now(),
  }).extension;
}

/** Run the global install, streaming package-manager output. Throws on failure. */
export function upgradePackage(): UpgradeCommand {
  const command = buildUpgradeCommand();
  execFileSync(command.cmd, command.args, {
    stdio: 'inherit',
    ...(process.platform === 'win32' && { shell: true }),
  });
  return command;
}
