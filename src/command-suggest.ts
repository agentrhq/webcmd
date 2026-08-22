/**
 * "Did you mean" engine for unknown commands.
 *
 * A mistyped token used to fall straight through to `missingPluginGuidance`,
 * telling the caller to search a plugin marketplace for a plugin that cannot
 * exist (`webcmd adapters` → "Search: webcmd plugin search adapters"). Agents
 * burned turns on those hunts. Everything registered on the program — built-in
 * namespaces, their leaves, installed site adapters, external CLIs — is already
 * in memory when the miss happens, so match against it instead.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { CLI_COMMAND } from './brand.js';
import { missingPluginGuidance, PLUGINS_DIR, USER_CLIS_DIR } from './discovery.js';

/**
 * High-priority overrides: intent that edit distance cannot infer.
 * `marketplace` is nowhere near `plugin search`, but it is what people type.
 */
const CANONICAL_ROOT: Record<string, string> = {
  catalog: `${CLI_COMMAND} plugin catalog list`,
  catalogs: `${CLI_COMMAND} plugin catalog list`,
  command: `${CLI_COMMAND} list`,
  commands: `${CLI_COMMAND} list`,
  cmds: `${CLI_COMMAND} list`,
  ls: `${CLI_COMMAND} list`,
  marketplace: `${CLI_COMMAND} plugin search <query>`,
  plugins: `${CLI_COMMAND} plugin list`,
  pluginlist: `${CLI_COMMAND} plugin list`,
  search: `${CLI_COMMAND} plugin search <query>`,
};

/** Subcommands that were removed and whose replacement lives elsewhere. */
const RETIRED_SUBCOMMANDS: Record<string, string> = {
  'browser fork': `${CLI_COMMAND} adapter override <site>/<command>`,
};

/** Same idea as CANONICAL_ROOT, one level down: intent, not spelling. */
const CANONICAL_SUB: Record<string, string> = {
  'adapter list': `${CLI_COMMAND} adapter status`,
  'adapter ls': `${CLI_COMMAND} adapter status`,
  'plugin ls': `${CLI_COMMAND} plugin list`,
  'session ls': `${CLI_COMMAND} session list`,
  'profile ls': `${CLI_COMMAND} profile list`,
  'external ls': `${CLI_COMMAND} external list`,
};

/** Levenshtein distance, two-row variant. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** A command the user could have meant: the token they'd type, and its full path. */
type Candidate = { token: string; commandPath: string };

function collect(parent: Command, prefix: string, depth: number, out: Candidate[]): void {
  for (const child of parent.commands) {
    const name = child.name();
    const commandPath = prefix ? `${prefix} ${name}` : name;
    out.push({ token: name, commandPath });
    for (const alias of child.aliases()) out.push({ token: alias, commandPath });
    if (depth > 0) collect(child, commandPath, depth - 1, out);
  }
}

export function commandCandidates(root: Command, prefix = ''): Candidate[] {
  const out: Candidate[] = [];
  collect(root, prefix, 2, out);
  return out;
}

/**
 * Best matches for `token`, closest first, at most 3.
 * Only long tokens tolerate two edits: at distance 2 a short token matches half
 * the command surface, and a confidently wrong suggestion costs more than none.
 */
export function suggestCommands(token: string, candidates: Candidate[]): string[] {
  const needle = token.toLowerCase();
  const threshold = needle.length >= 8 ? 2 : 1;
  const best = new Map<string, number>();
  for (const candidate of candidates) {
    const distance = editDistance(needle, candidate.token.toLowerCase());
    if (distance > threshold) continue;
    const existing = best.get(candidate.commandPath);
    if (existing === undefined || distance < existing) best.set(candidate.commandPath, distance);
  }
  return [...best.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([commandPath]) => commandPath);
}

function formatSuggestions(paths: string[]): string {
  if (paths.length === 1) return `Did you mean: ${CLI_COMMAND} ${paths[0]}`;
  return [`Did you mean one of:`, ...paths.map(p => `  ${CLI_COMMAND} ${p}`)].join('\n');
}

/**
 * `~/.webcmd/clis/<site>` or `~/.webcmd/plugins/<site>` exists, so "not
 * installed" would be a lie — the adapter is on disk and failed to register.
 */
function installedDirFor(site: string, dirs: string[]): string | undefined {
  if (!/^[a-zA-Z0-9_.-]+$/.test(site) || site.startsWith('.')) return undefined;
  for (const dir of dirs) {
    const candidate = path.join(dir, site);
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch { /* not there */ }
  }
  return undefined;
}

/** Message for an unknown root token. Caller writes it to stderr. */
export function unknownRootCommandMessage(
  program: Command,
  name: string,
  installDirs: string[] = [PLUGINS_DIR, USER_CLIS_DIR],
): string {
  const canonical = CANONICAL_ROOT[name.toLowerCase()];
  if (canonical) return `Unknown command "${name}".\nDid you mean: ${canonical}`;

  const suggestions = suggestCommands(name, commandCandidates(program));
  if (suggestions.length > 0) return `Unknown command "${name}".\n${formatSuggestions(suggestions)}`;

  const installedDir = installedDirFor(name, installDirs);
  if (installedDir) {
    return [
      `Site "${name}" is installed at ${installedDir} but registered no commands.`,
      'The adapter failed to load; this is not a missing plugin.',
      `Re-run with WEBCMD_VERBOSE=1 to see the load error, then: ${CLI_COMMAND} plugin update ${name}`,
    ].join('\n');
  }
  return missingPluginGuidance(name);
}

/** Message for an unknown subcommand inside a namespace. Caller writes it to stderr. */
export function unknownSubcommandMessage(namespace: Command, name: string): string {
  const nsPath = namespace.name();
  const key = `${nsPath} ${name.toLowerCase()}`;
  const retired = RETIRED_SUBCOMMANDS[key];
  const lines = [retired
    ? `error: '${CLI_COMMAND} ${nsPath} ${name}' was removed. Use: ${retired}`
    : `error: unknown command '${name}'`];
  if (!retired) {
    const canonical = CANONICAL_SUB[key];
    if (canonical) lines.push(`Did you mean: ${canonical}`);
    else {
      const suggestions = suggestCommands(name, commandCandidates(namespace, nsPath));
      if (suggestions.length > 0) lines.push(formatSuggestions(suggestions));
    }
  }
  const valid = [...new Set(namespace.commands.map(child => child.name()))].sort();
  if (valid.length > 0) lines.push(`Valid ${CLI_COMMAND} ${nsPath} commands: ${valid.join(', ')}`);
  return lines.join('\n');
}
