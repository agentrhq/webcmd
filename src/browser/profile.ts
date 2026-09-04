import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLI_COMMAND, CONFIG_DIR_NAME, ENV_PREFIX } from '../brand.js';
import { ArgumentError, CliError, ConfigError, EXIT_CODES } from '../errors.js';
import { normalizeProfileId } from './runtime/local-cloak/profiles.js';
import { randomUUID } from 'node:crypto';
import { loadWebcmdConfig, type LocalBrowserConfig } from '../hosted/config.js';

export const DEFAULT_CONTEXT_ID = 'default';

export type ProfileConfig = {
  version: 1;
  defaultContextId?: string;
  aliases: Record<string, string>;
};

export type ProfileProvider = LocalBrowserConfig['kind'];
type ProviderState = { aliases: Record<string, string>; defaultContextId?: string };
type ProfileConfigV2 = {
  version: 2;
  providers: Record<ProfileProvider, ProviderState>;
  slabEnsures: Record<string, { idempotencyKey: string; nativeProfileId?: string }>;
};

function profileConfigPath(): string {
  const baseDir = process.env[`${ENV_PREFIX}_CONFIG_DIR`] || path.join(os.homedir(), CONFIG_DIR_NAME);
  return path.join(baseDir, 'browser-profiles.json');
}

function providerConfigPath(): string { return profileConfigPath().replace(/\.json$/, '-v2.json'); }
function activeProvider(): ProfileProvider {
  const config = loadWebcmdConfig();
  return config.mode === 'local' ? config.browser.kind : 'cloak';
}

function emptyV2(): ProfileConfigV2 {
  return { version: 2, providers: { cloak: { aliases: {} }, chrome: { aliases: {} }, custom: { aliases: {} }, slab: { aliases: {} } }, slabEnsures: {} };
}

function loadV2(): ProfileConfigV2 {
  try {
    const value = JSON.parse(fs.readFileSync(providerConfigPath(), 'utf8')) as ProfileConfigV2;
    if (value.version !== 2 || !value.providers || !value.slabEnsures
      || !['cloak', 'chrome', 'custom', 'slab'].every(provider => {
        const state = value.providers[provider as ProfileProvider];
        return state && typeof state === 'object' && state.aliases && typeof state.aliases === 'object'
          && Object.entries(state.aliases).every(([alias, id]) => alias.trim() && typeof id === 'string' && id.trim())
          && (state.defaultContextId === undefined || typeof state.defaultContextId === 'string');
      })
      || Object.entries(value.slabEnsures).some(([alias, ensure]) => !alias.trim()
        || !ensure || typeof ensure !== 'object'
        || typeof ensure.idempotencyKey !== 'string' || !ensure.idempotencyKey.trim()
        || (ensure.nativeProfileId !== undefined && typeof ensure.nativeProfileId !== 'string'))
    ) throw new ConfigError('browser-profiles-v2.json has an unsupported schema.');
    return value;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return emptyV2();
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`Could not read browser-profiles-v2.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function saveV2(value: ProfileConfigV2): void {
  const target = providerConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
    try { fs.chmodSync(target, 0o600); } catch {}
    try { const directory = fs.openSync(path.dirname(target), 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); } } catch {}
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}

async function withConfigLock<T>(mutate: (value: ProfileConfigV2) => T): Promise<T> {
  const lock = `${providerConfigPath()}.lock`;
  const token = randomUUID();
  const startedAt = Date.now();
  const configuredTimeout = Number(process.env[`${ENV_PREFIX}_PROFILE_LOCK_TIMEOUT_MS`]);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 5_000;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      const fd = fs.openSync(lock, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }));
        const value = loadV2();
        if (Object.keys(value.providers.cloak.aliases).length === 0 && !value.providers.cloak.defaultContextId) {
          try {
            const legacy = JSON.parse(fs.readFileSync(profileConfigPath(), 'utf8')) as Partial<ProfileConfig>;
            if (legacy.version === 1 && legacy.aliases && typeof legacy.aliases === 'object') {
              value.providers.cloak.aliases = Object.fromEntries(Object.entries(legacy.aliases).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
              if (typeof legacy.defaultContextId === 'string' && legacy.defaultContextId.trim()) value.providers.cloak.defaultContextId = legacy.defaultContextId.trim();
            }
          } catch {}
        }
        const result = mutate(value);
        saveV2(value);
        return result;
      } finally {
        fs.closeSync(fd);
        try {
          const current = JSON.parse(fs.readFileSync(lock, 'utf8')) as { token?: string };
          if (current.token === token) fs.unlinkSync(lock);
        } catch {}
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(lock, 'utf8')) as { pid?: number; createdAt?: number };
        let alive = true;
        if (owner.pid) try { process.kill(owner.pid, 0); } catch { alive = false; }
        const age = Date.now() - (owner.createdAt ?? 0);
        // Age is only evidence that a dead owner's lock is stale. A live owner may
        // legitimately be delayed; stealing its lock would permit concurrent writers.
        if (!alive && age > 1_000) { fs.unlinkSync(lock); continue; }
      } catch {
        // An unreadable or malformed lock has no demonstrably dead recorded PID.
        // Fail closed after the bounded wait rather than deleting another writer's lock.
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new ConfigError('Profile configuration is locked by another live process. Retry after that operation finishes.');
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(5 + attempt * 2, 50)));
    }
  }
}

export function normalizeContextId(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function emptyProfileConfig(): ProfileConfig {
  return { version: 1, aliases: {} };
}

export function loadProfileConfig(provider: ProfileProvider = activeProvider()): ProfileConfig {
  const v2 = loadV2();
  const providerState = v2.providers[provider];
  if (providerState && (Object.keys(providerState.aliases).length > 0 || providerState.defaultContextId || provider === 'slab')) {
    return { version: 1, aliases: { ...providerState.aliases }, ...(providerState.defaultContextId ? { defaultContextId: providerState.defaultContextId } : {}) };
  }
  if (provider !== 'cloak') return emptyProfileConfig();
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

export async function prepareSlabProfileEnsure(alias: string): Promise<{ alias: string; idempotencyKey: string }> {
  const name = normalizeContextId(alias);
  if (!name) throw new ArgumentError('profile alias is required');
  try { normalizeProfileId(name); } catch {
    throw new ArgumentError(`Invalid profile alias "${name}". Use letters, numbers, ".", "_" or "-".`);
  }
  return withConfigLock(value => {
    const existing = value.slabEnsures[name];
    const idempotencyKey = existing?.idempotencyKey ?? randomUUID();
    value.slabEnsures[name] = { ...existing, idempotencyKey };
    return { alias: name, idempotencyKey };
  });
}

export async function commitSlabProfileEnsure(alias: string, idempotencyKey: string, nativeProfileId: string): Promise<void> {
  await withConfigLock(value => {
    const existing = value.slabEnsures[alias];
    if (existing && existing.idempotencyKey !== idempotencyKey) throw new Error('SLAB Profile ensure identity changed concurrently.');
    value.slabEnsures[alias] = { idempotencyKey, nativeProfileId };
    value.providers.slab.aliases[alias] = nativeProfileId;
  });
}

export async function rotateSlabProfileEnsure(alias: string, expectedIdempotencyKey: string): Promise<{ alias: string; idempotencyKey: string }> {
  return withConfigLock(value => {
    const existing = value.slabEnsures[alias];
    if (!existing || existing.idempotencyKey !== expectedIdempotencyKey) {
      throw new ConfigError(`SLAB Profile repair identity changed for alias "${alias}".`);
    }
    const idempotencyKey = randomUUID();
    value.slabEnsures[alias] = { idempotencyKey };
    delete value.providers.slab.aliases[alias];
    return { alias, idempotencyKey };
  });
}

export async function createProviderProfile(provider: Exclude<ProfileProvider, 'slab'>, alias: string): Promise<{ contextId: string; alias: string; created: boolean }> {
  const name = normalizeContextId(alias);
  if (!name) throw new ArgumentError('profile alias is required');
  let contextId: string;
  try { contextId = normalizeProfileId(name); } catch {
    throw new ArgumentError(`Invalid profile alias "${name}". Use letters, numbers, ".", "_" or "-".`);
  }
  return withConfigLock(value => {
    const existing = value.providers[provider].aliases[name];
    if (existing) return { contextId: existing, alias: name, created: false };
    value.providers[provider].aliases[name] = contextId;
    return { contextId, alias: name, created: true };
  });
}

export async function renameProviderProfile(provider: ProfileProvider, contextId: string, alias: string): Promise<void> {
  const normalizedContextId = normalizeContextId(contextId);
  const normalizedAlias = normalizeContextId(alias);
  if (!normalizedContextId || !normalizedAlias) throw new ArgumentError('profile contextId and alias are required');
  try { normalizeProfileId(normalizedAlias); } catch {
    throw new ArgumentError(`Invalid profile alias "${normalizedAlias}". Use letters, numbers, ".", "_" or "-".`);
  }
  await withConfigLock(value => {
    const state = value.providers[provider];
    let movedEnsure: ProfileConfigV2['slabEnsures'][string] | undefined;
    for (const [existingAlias, existingId] of Object.entries(state.aliases)) {
      if (existingId !== normalizedContextId) continue;
      delete state.aliases[existingAlias];
      if (provider === 'slab' && existingAlias !== normalizedAlias) {
        const ensure = value.slabEnsures[existingAlias];
        if (ensure) {
          movedEnsure = { ...ensure, nativeProfileId: normalizedContextId };
          delete value.slabEnsures[existingAlias];
        }
      }
    }
    if (provider === 'slab') {
      delete value.slabEnsures[normalizedAlias];
      if (movedEnsure) value.slabEnsures[normalizedAlias] = movedEnsure;
    }
    state.aliases[normalizedAlias] = normalizedContextId;
  });
}

export async function setProviderDefaultProfile(provider: ProfileProvider, profile: string, rows: ProfileListRow[]): Promise<string> {
  const name = normalizeContextId(profile);
  const match = name ? resolveKnownProfile(name, rows) : undefined;
  if (!name) throw new ArgumentError('profile is required');
  if (!match) {
    const labels = knownProfileLabels(rows);
    const usage = `usage: ${CLI_COMMAND} profile use <alias|contextId>`;
    throw new ArgumentError(
      labels.length ? `No profile matches "${name}". Valid profiles: ${labels.join(', ')}` : `No profile matches "${name}". No browser profiles are available.`,
      labels.length ? `${usage}\nexample: ${CLI_COMMAND} profile use ${labels[0]}` : `${usage}\nRun ${CLI_COMMAND} profile list, or create one with a browser-backed command.`,
    );
  }
  await withConfigLock(value => { value.providers[provider].defaultContextId = match.contextId; });
  return match.contextId;
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
      `usage: ${CLI_COMMAND} --profile <alias|contextId> session create\nCreate one: ${CLI_COMMAND} profile create ${name}\nList profiles: ${CLI_COMMAND} profile list`,
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
        `No profile matches "${name}". No browser profiles are available.`,
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
