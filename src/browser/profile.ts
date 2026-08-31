import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLI_COMMAND, CONFIG_DIR_NAME, ENV_PREFIX } from '../brand.js';
import { ArgumentError, CliError, EXIT_CODES } from '../errors.js';
import { normalizeProfileId } from './runtime/local-slab/profiles.js';

export const DEFAULT_CONTEXT_ID = 'default';

export type ProfileConfig = {
  version: 1;
  defaultContextId?: string;
  aliases: Record<string, string>;
};

function profileConfigPath(): string {
  const baseDir = process.env[`${ENV_PREFIX}_CONFIG_DIR`] || path.join(os.homedir(), CONFIG_DIR_NAME);
  return path.join(baseDir, 'browser-profiles.json');
}

export function normalizeContextId(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function emptyProfileConfig(): ProfileConfig {
  return { version: 1, aliases: {} };
}

export function loadProfileConfig(): ProfileConfig {
  try {
    const raw = fs.readFileSync(profileConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ProfileConfig>;
    const aliases = parsed.aliases && typeof parsed.aliases === 'object'
      ? Object.fromEntries(Object.entries(parsed.aliases).filter((entry): entry is [string, string] => {
        const [key, value] = entry;
        return typeof key === 'string' && key.trim().length > 0
          && typeof value === 'string' && value.trim().length > 0;
      }))
      : {};
    return {
      version: 1,
      aliases,
      ...(typeof parsed.defaultContextId === 'string' && parsed.defaultContextId.trim()
        ? { defaultContextId: parsed.defaultContextId.trim() }
        : {}),
    };
  } catch {
    return emptyProfileConfig();
  }
}

export function saveProfileConfig(config: ProfileConfig): void {
  const target = profileConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export type ProfileSelection = {
  contextId: string;
  source: 'explicit' | 'preferred';
};

export function resolveProfileSelection(profile?: string): ProfileSelection | undefined {
  const config = loadProfileConfig();
  const explicit = normalizeContextId(profile) ?? normalizeContextId(process.env[`${ENV_PREFIX}_PROFILE`]);
  if (explicit) return { contextId: config.aliases[explicit] ?? explicit, source: 'explicit' };
  const preferred = normalizeContextId(config.defaultContextId);
  if (preferred) return { contextId: config.aliases[preferred] ?? preferred, source: 'preferred' };
  return undefined;
}

export function profileRouteParams(
  selection: ProfileSelection | undefined,
): { contextId?: string; preferredContextId?: string } {
  if (!selection) return {};
  return selection.source === 'explicit'
    ? { contextId: selection.contextId }
    : { preferredContextId: selection.contextId };
}

export function resolveProfileContextId(profile?: string): string | undefined {
  return resolveProfileSelection(profile)?.contextId;
}

export function aliasForContextId(config: ProfileConfig, contextId: string): string | undefined {
  for (const [alias, id] of Object.entries(config.aliases)) {
    if (id === contextId) return alias;
  }
  return undefined;
}

export class ProfileNotFoundError extends CliError {
  constructor(name: string, rows: ProfileListRow[]) {
    const labels = knownProfileLabels(rows);
    const valid = labels.length > 0 ? `Valid profiles: ${labels.join(', ')}` : 'No profiles exist yet.';
    super(
      'PROFILE_NOT_FOUND',
      `No profile matches "${name}". ${valid}`,
      `usage: ${CLI_COMMAND} --profile <alias|contextId> session create\nSave an alias: ${CLI_COMMAND} profile create ${name}\nList profiles: ${CLI_COMMAND} profile list`,
      EXIT_CODES.EMPTY_RESULT,
    );
  }
}

export function createProfile(alias: string): { contextId: string; alias: string; created: boolean } {
  const name = normalizeContextId(alias);
  if (!name) throw new ArgumentError('profile alias is required', `usage: ${CLI_COMMAND} profile create <alias>`);
  let contextId: string;
  try {
    contextId = normalizeProfileId(name);
  } catch {
    throw new ArgumentError(
      `Invalid profile alias "${name}". Use letters, numbers, ".", "_" or "-".`,
      `usage: ${CLI_COMMAND} profile create <alias>\nexample: ${CLI_COMMAND} profile create work`,
    );
  }
  const config = loadProfileConfig();
  if (config.aliases[name]) {
    return { contextId: config.aliases[name], alias: name, created: false };
  }
  config.aliases[name] = contextId;
  saveProfileConfig(config);
  return { contextId, alias: name, created: true };
}

export function renameProfile(contextId: string, alias: string): ProfileConfig {
  const normalizedContextId = normalizeContextId(contextId);
  const normalizedAlias = normalizeContextId(alias);
  if (!normalizedContextId) throw new Error('profile contextId is required');
  if (!normalizedAlias) throw new Error('profile alias is required');

  const config = loadProfileConfig();
  for (const [existingAlias, existingContextId] of Object.entries(config.aliases)) {
    if (existingAlias !== normalizedAlias && existingContextId === normalizedContextId) {
      delete config.aliases[existingAlias];
    }
  }
  config.aliases[normalizedAlias] = normalizedContextId;
  saveProfileConfig(config);
  return config;
}

export function knownProfileLabels(rows: ProfileListRow[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.alias || seen.has(row.alias)) continue;
    seen.add(row.alias);
    labels.push(row.alias);
  }
  for (const row of rows) {
    if (seen.has(row.contextId)) continue;
    seen.add(row.contextId);
    labels.push(row.contextId);
  }
  return labels;
}

export function resolveKnownProfile(profile: string, rows: ProfileListRow[]): ProfileListRow | undefined {
  const name = normalizeContextId(profile);
  if (!name) return undefined;
  return rows.find(row => row.contextId === name || row.alias === name);
}

export function setDefaultProfile(profile: string, rows: ProfileListRow[]): ProfileConfig {
  const name = normalizeContextId(profile);
  if (!name) throw new ArgumentError('profile is required');
  const match = resolveKnownProfile(name, rows);
  if (!match) {
    const labels = knownProfileLabels(rows);
    const usage = `usage: ${CLI_COMMAND} profile use <alias|contextId>`;
    if (labels.length === 0) {
      throw new ArgumentError(
        `No profile matches "${name}". No SLAB profiles are available.`,
        `${usage}\nRun ${CLI_COMMAND} profile list, or create one with a browser-backed command.`,
      );
    }
    throw new ArgumentError(
      `No profile matches "${name}". Valid profiles: ${labels.join(', ')}`,
      `${usage}\nexample: ${CLI_COMMAND} profile use ${labels[0]}`,
    );
  }
  const config = loadProfileConfig();
  config.defaultContextId = match.contextId;
  saveProfileConfig(config);
  return config;
}

export interface ProfileListRow {
  contextId: string;
  alias: string;
  default: boolean;
  connected: boolean;
  runtimeVersion: string;
}

/**
 * Structured view of `profile list`, including saved-but-disconnected profiles.
 *
 * The prose output already surfaces disconnected aliases; structured output must too.
 * A caller that sees only connected profiles concludes the others do not exist and goes
 * looking for profile state elsewhere, which is exactly the wrong place to look.
 */
export function profileListRows(
  config: ProfileConfig,
  connected: Array<{ contextId: string; runtimeVersion?: string }>,
): ProfileListRow[] {
  const seen = new Set<string>();
  const rows: ProfileListRow[] = [];
  for (const profile of connected) {
    seen.add(profile.contextId);
    rows.push({
      contextId: profile.contextId,
      alias: aliasForContextId(config, profile.contextId) ?? '',
      default: config.defaultContextId === profile.contextId,
      connected: true,
      runtimeVersion: profile.runtimeVersion ?? '',
    });
  }
  for (const [alias, contextId] of Object.entries(config.aliases)) {
    if (seen.has(contextId)) continue;
    seen.add(contextId);
    rows.push({
      contextId,
      alias,
      default: config.defaultContextId === contextId,
      connected: false,
      runtimeVersion: '',
    });
  }
  if (config.defaultContextId && !seen.has(config.defaultContextId)) {
    rows.push({
      contextId: config.defaultContextId,
      alias: '',
      default: true,
      connected: false,
      runtimeVersion: '',
    });
  }
  return rows;
}
