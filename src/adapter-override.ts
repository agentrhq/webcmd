/**
 * `webcmd adapter override <site>/<command>`: fork an installed plugin's
 * command file into ~/.webcmd/clis/<site>/<command>.js so the user can edit
 * it, while keeping a `.base/` copy and a provenance record so a later
 * `plugin update` can tell the user upstream changed and offer a real
 * three-way merge base.
 *
 * The fork is the command's whole relative-import closure, not just the one
 * file. Most plugin commands import a sibling helper, and copying the command
 * alone yields an override that throws `Cannot find module` on load: command
 * resolution then falls back to the plugin copy while `adapter status` still
 * reports the override as tracked, so the user edits a file that never runs.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLI_COMMAND } from './brand.js';
import { classifyCommandOrigin } from './command-origin.js';
import { getRegistry } from './registry.js';
import { collectRelativeImportClosure } from './adapter-import-closure.js';
import {
  fileSha256,
  getBaseCopyPath,
  getBaseDependencyPath,
  readOverrideRecords,
  writeOverrideRecords,
  type OverrideDependency,
  type OverrideRecord,
} from './override-provenance.js';

export interface AdapterOverrideResult {
  commandKey: string;
  plugin: string;
  overridePath: string;
  basePath: string;
  /** Files copied alongside the command so the override can load, relative to the override directory. */
  dependencies: string[];
}

/**
 * True when `fileName` already sits in the override directory only because an
 * earlier fork of a *different* command in the same plugin copied it as part
 * of its import closure.
 *
 * This is not hypothetical: a plugin command can import another command's
 * file (linkedin's `salesnav-thread` imports `./salesnav-inbox.js`), so
 * forking one command can put a second command's file in `clis/`. Overriding
 * that second command must then adopt the existing copy rather than refuse
 * with "an override already exists" — a file webcmd itself placed there is
 * not a reason to send the user to `adapter reset`.
 */
function isCopiedDependency(
  records: Record<string, OverrideRecord>,
  site: string,
  fileName: string,
): boolean {
  return Object.values(records).some(
    (record) => record.plugin === site && (record.dependencies ?? []).some((dep) => dep.path === fileName),
  );
}

/**
 * Copy every file the command imports into the override directory, and keep a
 * fork-time base copy of each.
 *
 * An existing copy is never overwritten: it is either a file the user has
 * already edited, or one an earlier fork of a sibling command placed there.
 * The recorded sha256 is therefore taken from the copy the override will
 * actually load — if that copy is older than upstream, reconciliation should
 * say so instead of claiming the fork is current.
 */
function copyImportClosure(
  closure: string[],
  pluginFile: string,
  overridePath: string,
  site: string,
  homeDir: string | undefined,
): OverrideDependency[] {
  const pluginDir = path.dirname(pluginFile);
  const overrideDir = path.dirname(overridePath);
  const dependencies: OverrideDependency[] = [];

  for (const relPath of closure) {
    const segments = relPath.split('/');
    const source = path.join(pluginDir, ...segments);
    const destination = path.join(overrideDir, ...segments);
    const baseDestination = getBaseDependencyPath(site, relPath, homeDir);

    if (!fs.existsSync(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
    if (!fs.existsSync(baseDestination)) {
      fs.mkdirSync(path.dirname(baseDestination), { recursive: true });
      fs.copyFileSync(destination, baseDestination);
    }

    dependencies.push({ path: relPath, sha256: fileSha256(destination) });
  }

  return dependencies;
}

function resolveHomeDir(homeDir?: string): string {
  return homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
}

/**
 * Read a plugin's commitHash from the lock file scoped to `homeDir`.
 *
 * `readLockFile()` in plugin.ts always resolves the real $HOME and has no
 * `homeDir` param — using it here would make provenance describe whatever
 * plugin happens to be installed on the real machine instead of the
 * installation actually being forked. Read the lock file directly instead,
 * scoped the same way as the plugin file and clis/.base copies above.
 */
function readCommitHashFor(homeDir: string, plugin: string): string | null {
  const lockPath = path.join(homeDir, '.webcmd', 'plugins.lock.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    const commitHash = parsed?.[plugin]?.commitHash;
    return typeof commitHash === 'string' ? commitHash : null;
  } catch {
    return null;
  }
}

/** Fork an installed plugin's command file into ~/.webcmd/clis and record provenance. */
export function createAdapterOverride(
  commandKey: string,
  options: { homeDir?: string } = {},
): AdapterOverrideResult {
  const parts = commandKey.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Usage: ${CLI_COMMAND} adapter override <site>/<command> (got "${commandKey}")`);
  }
  const [site, command] = parts;

  const homeDir = resolveHomeDir(options.homeDir);
  const pluginFile = path.join(homeDir, '.webcmd', 'plugins', site, `${command}.js`);

  if (!fs.existsSync(pluginFile)) {
    const registered = getRegistry().get(commandKey);
    if (registered) {
      const origin = classifyCommandOrigin(registered, {
        pluginsDir: path.join(homeDir, '.webcmd', 'plugins'),
        userClisDir: path.join(homeDir, '.webcmd', 'clis'),
      });
      if (origin.kind === 'local') {
        throw new Error(
          `"${commandKey}" is not provided by an installed plugin — it's already a local adapter. ` +
          `Edit it directly at ~/.webcmd/clis/${commandKey}.js.`,
        );
      }
      if (origin.kind === 'builtin') {
        throw new Error(
          `"${commandKey}" is not provided by an installed plugin — it's a built-in command and can't be forked this way.`,
        );
      }
    }
    throw new Error(
      `"${commandKey}" is not provided by an installed plugin (no plugin file found at ${pluginFile}).`,
    );
  }

  const overridePath = path.join(homeDir, '.webcmd', 'clis', site, `${command}.js`);
  const records = readOverrideRecords(options.homeDir);
  const adoptExistingCopy = isCopiedDependency(records, site, `${command}.js`);
  if (fs.existsSync(overridePath) && !adoptExistingCopy) {
    throw new Error(
      `An override already exists at ${overridePath}. Run "${CLI_COMMAND} adapter reset ${site}" first if you want to start over.`,
    );
  }

  // Resolved before anything is written: an adapter whose imports cannot be
  // copied must fail with nothing on disk, rather than leave behind the
  // half-copied override that is the whole failure mode being fixed here.
  const closure = collectRelativeImportClosure(pluginFile, path.dirname(pluginFile));

  const basePath = getBaseCopyPath(commandKey, options.homeDir);

  fs.mkdirSync(path.dirname(overridePath), { recursive: true });
  if (!fs.existsSync(overridePath)) {
    fs.copyFileSync(pluginFile, overridePath);
  }
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(path.dirname(basePath), { recursive: true });
    fs.copyFileSync(overridePath, basePath);
  }

  const dependencies = copyImportClosure(closure, pluginFile, overridePath, site, options.homeDir);
  const commitHash = readCommitHashFor(homeDir, site);

  records[commandKey] = {
    plugin: site,
    commitHash,
    sourcePath: pluginFile,
    // Hashed from the copy the override will load, not from the plugin file.
    // They are the same bytes for a fresh fork; when an earlier fork already
    // left this file in clis/, the copy is what the user actually runs, and
    // reconciliation should compare upstream against that.
    sourceSha256: fileSha256(overridePath),
    basePath,
    createdAt: new Date().toISOString(),
    ...(dependencies.length > 0 ? { dependencies } : {}),
  };
  writeOverrideRecords(records, options.homeDir);

  return {
    commandKey,
    plugin: site,
    overridePath,
    basePath,
    dependencies: dependencies.map((dependency) => dependency.path),
  };
}
