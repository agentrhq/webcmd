import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type SkillVersionDrift = {
  cliVersion: string;
  pluginCacheVersion: string;
  pluginCachePath: string;
};

export type SkillVersionDriftOptions = {
  homeDir?: string;
  cwd?: string;
  /** Marketplace/plugin id pair under `<homeDir>/.claude/plugins/cache/<marketplace>/<plugin>/`. */
  marketplace?: string;
  plugin?: string;
};

/**
 * Webcmd ships the same skills/ through two channels: an npm-managed symlink (which can
 * never drift — it always points at the running package) and a Claude Code plugin cache
 * copy that's version-pinned and only refreshed by `claude plugin update`. Drift is only
 * possible, and only worth reporting, when both channels are actually in use on this
 * machine and the plugin-cache copy is pinned to a different version than the running CLI.
 */
export function findSkillVersionDrift(cliVersion: string | undefined, options: SkillVersionDriftOptions = {}): SkillVersionDrift | null {
  if (!cliVersion) return null;
  const homeDir = options.homeDir ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  const marketplace = options.marketplace ?? 'webcmd';
  const plugin = options.plugin ?? 'webcmd';

  const pluginCacheRoot = path.join(homeDir, '.claude', 'plugins', 'cache', marketplace, plugin);
  const pluginCacheVersion = latestPluginCacheVersion(pluginCacheRoot);
  if (!pluginCacheVersion) return null;

  if (!hasSymlinkedSkills(homeDir, cwd)) return null;
  if (pluginCacheVersion === cliVersion) return null;

  return { cliVersion, pluginCacheVersion, pluginCachePath: path.join(pluginCacheRoot, pluginCacheVersion) };
}

export function formatSkillVersionDriftIssue(drift: SkillVersionDrift): string {
  return (
    `Claude Code plugin skills are pinned at v${drift.pluginCacheVersion}, but the webcmd CLI is v${drift.cliVersion}.\n` +
    '  Skills emit webcmd commands and flags for their own version, so a mismatch can produce confidently wrong commands.\n' +
    '  Run: claude plugin update webcmd@webcmd'
  );
}

function latestPluginCacheVersion(pluginCacheRoot: string): string | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(pluginCacheRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const versions = entries.filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+/.test(entry.name)).map((entry) => entry.name);
  return versions.sort(compareVersions).at(-1);
}

function compareVersions(a: string, b: string): number {
  const partsOf = (v: string) => v.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const [aParts, bParts] = [partsOf(a), partsOf(b)];
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function hasSymlinkedSkills(homeDir: string, cwd: string): boolean {
  const stableRoot = path.join(homeDir, '.webcmd', 'skills');
  if (directoryHasEntries(stableRoot)) return true;

  return ['.agents', '.codex', '.claude'].some((agentDir) =>
    [path.join(homeDir, agentDir, 'skills'), path.join(cwd, agentDir, 'skills')].some((root) => directoryHasSymlinkEntry(root)),
  );
}

function directoryHasEntries(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function directoryHasSymlinkEntry(dir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => {
    try {
      return fs.lstatSync(path.join(dir, entry.name)).isSymbolicLink();
    } catch {
      return false;
    }
  });
}
