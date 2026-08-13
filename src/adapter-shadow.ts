import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readOverrideRecords } from './override-provenance.js';

export type AdapterShadow = {
  name: string;
  userPath: string;
  pluginPath: string;
  plugin: string;
  hasProvenance: boolean;
};

export type AdapterShadowOptions = {
  userClisDir?: string;
  pluginsDir?: string;
  /** Home dir used to locate the override provenance store; defaults to the real home. */
  homeDir?: string;
};

/** Readdir that treats a missing directory as empty, but throws on any other failure. */
function readdirOrEmpty(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw new Error(`Cannot read ${dir}: ${(err as Error).message}`);
  }
}

/**
 * A plugins directory that simply doesn't exist yet (no plugins installed) is normal
 * and must not be distinguished from "nothing to report". But a path that is broken in
 * a way a real install would never produce — permission denied, a file where a directory
 * should be, or a path whose own parent is also missing — must throw instead of quietly
 * behaving like "no plugins installed", or override detection silently goes blind again.
 */
function assertPluginsDirUsable(pluginsDir: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(pluginsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' && fs.existsSync(path.dirname(pluginsDir))) return; // no plugins installed yet
    throw new Error(`Cannot read plugins directory ${pluginsDir}: ${(err as Error).message}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Cannot read plugins directory ${pluginsDir}: not a directory`);
  }
}

export function findShadowedUserAdapters(opts: AdapterShadowOptions = {}): AdapterShadow[] {
  const userClisDir = opts.userClisDir ?? path.join(os.homedir(), '.webcmd', 'clis');
  const pluginsDir = opts.pluginsDir ?? path.join(os.homedir(), '.webcmd', 'plugins');
  assertPluginsDirUsable(pluginsDir);
  const provenance = readOverrideRecords(opts.homeDir);
  const shadows: AdapterShadow[] = [];

  for (const siteEntry of readdirOrEmpty(userClisDir)) {
    if (!siteEntry.isDirectory() || siteEntry.name === '.base') continue;
    const site = siteEntry.name;
    const userSiteDir = path.join(userClisDir, site);
    const pluginSiteDir = path.join(pluginsDir, site);

    for (const commandEntry of readdirOrEmpty(userSiteDir)) {
      if (!commandEntry.isFile() || !commandEntry.name.endsWith('.js')) continue;
      const userPath = path.join(userSiteDir, commandEntry.name);
      const pluginPath = path.join(pluginSiteDir, commandEntry.name);
      if (!fs.existsSync(pluginPath)) continue;

      const name = `${site}/${commandEntry.name.replace(/\.js$/, '')}`;
      shadows.push({
        name,
        userPath,
        pluginPath,
        plugin: site,
        hasProvenance: Object.prototype.hasOwnProperty.call(provenance, name),
      });
    }
  }

  return shadows.sort((a, b) => a.name.localeCompare(b.name));
}

export function formatAdapterShadowIssue(shadows: AdapterShadow[]): string {
  const visible = shadows.slice(0, 10);
  const lines = ['Local adapter overrides shadow installed plugin adapters:'];
  for (const shadow of visible) {
    lines.push(`  ${shadow.name}: ${shadow.userPath} overrides ${shadow.pluginPath}`);
  }
  if (shadows.length > visible.length) {
    lines.push(`  ... and ${shadows.length - visible.length} more`);
  }
  lines.push(
    'Run webcmd adapter override <site> <command> to track a fork, or webcmd adapter reset <site> to drop an untracked one.',
  );
  return lines.join('\n');
}
