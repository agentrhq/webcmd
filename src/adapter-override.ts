/**
 * `webcmd adapter override <site>/<command>`: fork an installed plugin's
 * command file into ~/.webcmd/clis/<site>/<command>.js so the user can edit
 * it, while keeping a `.base/` copy and a provenance record so a later
 * `plugin update` can tell the user upstream changed and offer a real
 * three-way merge base.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLI_COMMAND } from './brand.js';
import { classifyCommandOrigin } from './command-origin.js';
import { getRegistry } from './registry.js';
import {
  fileSha256,
  getBaseCopyPath,
  readOverrideRecords,
  writeOverrideRecords,
} from './override-provenance.js';

export interface AdapterOverrideResult {
  commandKey: string;
  plugin: string;
  overridePath: string;
  basePath: string;
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
  if (fs.existsSync(overridePath)) {
    throw new Error(
      `An override already exists at ${overridePath}. Run "${CLI_COMMAND} adapter reset ${site}" first if you want to start over.`,
    );
  }

  const basePath = getBaseCopyPath(commandKey, options.homeDir);

  const content = fs.readFileSync(pluginFile);
  fs.mkdirSync(path.dirname(overridePath), { recursive: true });
  fs.writeFileSync(overridePath, content);
  fs.mkdirSync(path.dirname(basePath), { recursive: true });
  fs.writeFileSync(basePath, content);

  const commitHash = readCommitHashFor(homeDir, site);

  const records = readOverrideRecords(options.homeDir);
  records[commandKey] = {
    plugin: site,
    commitHash,
    sourcePath: pluginFile,
    sourceSha256: fileSha256(pluginFile),
    basePath,
    createdAt: new Date().toISOString(),
  };
  writeOverrideRecords(records, options.homeDir);

  return { commandKey, plugin: site, overridePath, basePath };
}
