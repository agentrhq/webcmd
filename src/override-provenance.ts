/**
 * Override provenance store: tracks user forks of plugin commands.
 *
 * An override is a user's forked copy of an installed plugin's command,
 * living at ~/.webcmd/clis/<site>/<cmd>.js. This store records where each
 * override came from (sourceSha256 at fork time) and keeps a `.base/` copy
 * of the fork-time file for three-way merges.
 *
 * Store: ~/.webcmd/override-provenance.json
 * Base copies: ~/.webcmd/clis/.base/<site>/<command>.js
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isRecord } from './utils.js';

export interface OverrideRecord {
  plugin: string;
  commitHash: string | null;
  sourcePath: string;
  sourceSha256: string;
  basePath: string;
  createdAt: string;
}

function resolveHomeDir(homeDir?: string): string {
  return homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
}

/** Path to the override provenance store. */
export function getOverrideStorePath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), '.webcmd', 'override-provenance.json');
}

/** Path to the fork-time base copy for a given "<site>/<command>" key. */
export function getBaseCopyPath(commandKey: string, homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), '.webcmd', 'clis', '.base', `${commandKey}.js`);
}

/**
 * Read all override records. A missing store is normal and returns {}.
 * A malformed store throws, naming the path — silently returning {} here
 * would report every override as a plain local adapter, losing the
 * upstream link without a word.
 */
export function readOverrideRecords(homeDir?: string): Record<string, OverrideRecord> {
  const storePath = getOverrideStorePath(homeDir);
  let raw: string;
  try {
    raw = fs.readFileSync(storePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return {};
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed override provenance store at ${storePath}: invalid JSON`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Malformed override provenance store at ${storePath}: expected an object`);
  }

  return parsed as Record<string, OverrideRecord>;
}

/** Write the full set of override records, creating parent directories as needed. */
export function writeOverrideRecords(records: Record<string, OverrideRecord>, homeDir?: string): void {
  const storePath = getOverrideStorePath(homeDir);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(records, null, 2) + '\n');
}

/** sha256 hex digest of a file's bytes. */
export function fileSha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Remove every override record (and its base copy) belonging to `site`.
 * Returns the removed command keys ("<site>/<command>").
 */
export function removeOverrideRecords(site: string, homeDir?: string): string[] {
  const records = readOverrideRecords(homeDir);
  const prefix = `${site}/`;
  const removed: string[] = [];

  for (const key of Object.keys(records)) {
    if (key !== site && !key.startsWith(prefix)) continue;
    removed.push(key);
    delete records[key];
    try {
      fs.rmSync(getBaseCopyPath(key, homeDir), { force: true });
    } catch {}
  }

  if (removed.length > 0) writeOverrideRecords(records, homeDir);
  return removed;
}
