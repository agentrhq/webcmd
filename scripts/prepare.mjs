#!/usr/bin/env node

/**
 * prepare lifecycle script — build the CLI when installing from a source tree.
 *
 * npm runs lifecycle scripts through the platform shell, which is cmd.exe on
 * Windows. The previous inline script, `[ -d src ] && npm run build || true`,
 * is POSIX sh: cmd.exe has neither `[` nor `true`, so it exited 1 and took
 * `npm install`/`npm ci` down with it, leaving the tree unbuilt. This script
 * is the cross-platform equivalent of that intent:
 *
 *   - skip the build when there is no source tree (a published tarball ships
 *     only dist/, so there is nothing to compile);
 *   - never fail the install, whatever the build does.
 *
 * Intentionally plain Node.js with no imports from the main source tree: it
 * runs before the build that produces dist/.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (existsSync(path.join(packageRoot, 'src'))) {
  // `npm` is a .cmd shim on Windows, which spawnSync can only launch via a shell.
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (build.error || build.status !== 0) {
    // The build is a convenience for source installs, not a requirement, so
    // report it and leave the install itself successful.
    console.error('Warning: `npm run build` did not complete; run it manually before using the CLI.');
  }
}
