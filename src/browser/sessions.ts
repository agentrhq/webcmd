import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR_NAME, ENV_PREFIX } from '../brand.js';
import { CliError, ConfigError, EXIT_CODES } from '../errors.js';

export interface BrowserSessionRecord {
  id: string;
  profileId: string;
  /** Optional user-supplied alias, unique per Profile. */
  name?: string;
  kind: 'explicit' | 'adapter-default';
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  handoff?: { site: string; expiresAt: string };
}

export interface BrowserSessionListRow extends BrowserSessionRecord {
  runtimeState: 'idle' | 'active';
}

export interface LocalBrowserSessionStoreOptions {
  baseDir?: string;
  now?: () => Date;
  idFactory?: () => string;
  isActive?: (record: BrowserSessionRecord) => boolean;
}

type StateFile = { version: 1; sessions: BrowserSessionRecord[] };
const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class SessionNotFoundError extends CliError {
  constructor(sessionId: string, profileId: string, candidates: BrowserSessionRecord[] = []) {
    super(
      'SESSION_NOT_FOUND',
      `Session not found: ${sessionId}`,
      formatSessionCandidates(profileId, candidates),
      EXIT_CODES.EMPTY_RESULT,
    );
  }
}

/**
 * Agents that cannot resolve a Session selector otherwise create a fresh Session
 * and silently lose the isolation the caller asked for, so the miss must name the
 * Sessions that do exist.
 */
function formatSessionCandidates(profileId: string, candidates: BrowserSessionRecord[]): string {
  const listCommand = `Run \`webcmd --profile ${profileId} session list\` to choose an existing Session.`;
  if (candidates.length === 0) return listCommand;
  const known = candidates
    .slice(0, 10)
    .map((row) => (row.name ? `${row.id} (${row.name})` : row.id))
    .join(', ');
  return `Known Sessions for Profile ${profileId}: ${known}. ${listCommand}`;
}

export class SessionNameTakenError extends CliError {
  constructor(name: string, sessionId: string, profileId: string) {
    super(
      'SESSION_NAME_TAKEN',
      `Session name "${name}" is already used by ${sessionId} in Profile ${profileId}.`,
      'Pick another name, or rename the existing Session first.',
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

export class InvalidSessionNameError extends CliError {
  constructor(name: string, reason: string) {
    super(
      'INVALID_SESSION_NAME',
      `Invalid Session name "${name}": ${reason}`,
      'Use 1-64 characters: letters, digits, dash, underscore, or dot; it must not start with `session_`.',
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

export class InvalidSessionSelectorError extends CliError {
  constructor(sessionId: string) {
    super(
      'INVALID_SESSION_SELECTOR',
      `Session selector must be an opaque Session ID: ${sessionId}`,
      'Run `webcmd session create` and pass the returned `session_...` ID.',
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

export class LocalBrowserSessionStore {
  private readonly baseDir: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly isActive: (record: BrowserSessionRecord) => boolean;

  constructor(opts: LocalBrowserSessionStoreOptions = {}) {
    this.baseDir = opts.baseDir ?? getWebcmdConfigDir();
    this.now = opts.now ?? (() => new Date());
    this.idFactory = opts.idFactory ?? (() => `session_${randomUUID()}`);
    this.isActive = opts.isActive ?? (() => false);
  }

  create(profileId: string, name?: string): BrowserSessionRecord {
    const state = this.load();
    const alias = name === undefined ? undefined : normalizeSessionName(name);
    if (alias) this.requireNameFree(state, profileId, alias);
    const record = this.newRecord(profileId, 'explicit', state.sessions);
    if (alias) record.name = alias;
    state.sessions.push(record);
    this.save(state);
    return { ...record };
  }

  rename(profileId: string, sessionId: string, name: string): BrowserSessionRecord {
    const alias = normalizeSessionName(name);
    const state = this.load();
    const record = this.requireMutable(state, profileId, sessionId);
    this.requireNameFree(state, profileId, alias, record.id);
    record.name = alias;
    this.touchRecord(state, record);
    return { ...record };
  }

  /**
   * Resolve a `--session` selector to a Session ID. Opaque IDs pass through so a
   * stale local file cannot mask a Session the runtime knows about; anything else
   * is looked up as an alias and a miss is a loud SESSION_NOT_FOUND.
   */
  resolveSelector(profileId: string, selector: string): string {
    const value = selector.trim();
    if (isSessionIdShape(value)) return value;
    if (!isSessionNameShape(value)) throw new InvalidSessionSelectorError(value);
    const state = this.load();
    const scoped = state.sessions.filter((row) => row.profileId === profileId);
    const match = scoped.find((row) => row.name === value);
    if (match) return match.id;
    throw new SessionNotFoundError(value, profileId, scoped);
  }

  private requireNameFree(state: StateFile, profileId: string, name: string, exceptId?: string): void {
    const clash = state.sessions.find((row) => row.profileId === profileId && row.name === name && row.id !== exceptId);
    if (clash) throw new SessionNameTakenError(name, clash.id, profileId);
  }

  find(profileId: string, sessionId: string): BrowserSessionRecord | undefined {
    requireSessionIdShape(sessionId);
    const state = this.load();
    const record = state.sessions.find((row) => row.id === sessionId && row.profileId === profileId);
    return record ? { ...record } : undefined;
  }

  require(profileId: string, sessionId: string | undefined): BrowserSessionRecord {
    const id = sessionId?.trim() ?? '';
    requireSessionIdShape(id);
    const state = this.load();
    const record = state.sessions.find((row) => row.id === id && row.profileId === profileId);
    if (!record) throw new SessionNotFoundError(id, profileId, state.sessions.filter((row) => row.profileId === profileId));
    this.touchRecord(state, record);
    return { ...record };
  }

  resolveAdapterDefault(profileId: string): BrowserSessionRecord {
    const state = this.load();
    const existing = state.sessions.find((row) => row.profileId === profileId && row.kind === 'adapter-default');
    if (existing) {
      this.touchRecord(state, existing);
      return { ...existing };
    }
    const record = this.newRecord(profileId, 'adapter-default', state.sessions);
    state.sessions.push(record);
    this.save(state);
    return { ...record };
  }

  list(profileId?: string, limit = 20): BrowserSessionListRow[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new CliError('INVALID_SESSION_LIMIT', 'Session list limit must be an integer from 1 to 100.', undefined, EXIT_CODES.USAGE_ERROR);
    }
    const rows = this.load().sessions
      .filter((row) => profileId === undefined || row.profileId === profileId)
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
    return rows.map((row) => ({ ...row, runtimeState: 'idle' as const }));
  }

  markHandoff(profileId: string, sessionId: string, handoff: { site: string; expiresAt: string }): BrowserSessionRecord {
    const state = this.load();
    const record = this.requireMutable(state, profileId, sessionId);
    record.handoff = handoff;
    this.touchRecord(state, record);
    return { ...record };
  }

  clearHandoff(profileId: string, sessionId: string): BrowserSessionRecord {
    const state = this.load();
    const record = this.requireMutable(state, profileId, sessionId);
    delete record.handoff;
    this.touchRecord(state, record);
    return { ...record };
  }

  touch(profileId: string, sessionId: string): BrowserSessionRecord {
    const state = this.load();
    const record = this.requireMutable(state, profileId, sessionId);
    this.touchRecord(state, record);
    return { ...record };
  }

  remove(profileId: string, sessionId: string): BrowserSessionRecord {
    const state = this.load();
    const record = this.requireMutable(state, profileId, sessionId);
    state.sessions = state.sessions.filter((row) => row !== record);
    this.save(state);
    return { ...record };
  }

  private newRecord(
    profileId: string,
    kind: BrowserSessionRecord['kind'],
    existing: BrowserSessionRecord[],
  ): BrowserSessionRecord {
    const timestamp = this.now().toISOString();
    const id = this.uniqueId(existing);
    return { id, profileId, kind, createdAt: timestamp, updatedAt: timestamp, lastUsedAt: timestamp };
  }

  private uniqueId(existing: BrowserSessionRecord[]): string {
    const used = new Set(existing.map((row) => row.id));
    const first = this.idFactory();
    if (!used.has(first)) {
      requireSessionIdShape(first);
      return first;
    }
    let candidate = `session_${randomUUID()}`;
    while (used.has(candidate)) candidate = `session_${randomUUID()}`;
    return candidate;
  }

  private touchRecord(state: StateFile, record: BrowserSessionRecord): void {
    const timestamp = this.now().toISOString();
    record.updatedAt = timestamp;
    record.lastUsedAt = timestamp;
    this.save(state);
  }

  private requireMutable(state: StateFile, profileId: string, sessionId: string): BrowserSessionRecord {
    requireSessionIdShape(sessionId);
    const record = state.sessions.find((row) => row.id === sessionId && row.profileId === profileId);
    if (!record) throw new SessionNotFoundError(sessionId, profileId, state.sessions.filter((row) => row.profileId === profileId));
    return record;
  }

  private load(): StateFile {
    const file = this.statePath();
    if (!fs.existsSync(file)) return { version: 1, sessions: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new ConfigError(`Could not read browser sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
    const state = validateState(parsed);
    const now = this.now().getTime();
    let changed = false;
    for (const record of state.sessions) {
      if (record.handoff && Date.parse(record.handoff.expiresAt) <= now) {
        delete record.handoff;
        changed = true;
      }
    }
    const retained = state.sessions.filter((record) => {
      const expired = record.kind === 'explicit'
        && !record.handoff
        && !this.isActive(record)
        && Date.parse(record.lastUsedAt) <= now - SESSION_RETENTION_MS;
      if (expired) changed = true;
      return !expired;
    });
    state.sessions = retained;
    if (changed) this.save(state);
    return state;
  }

  private save(state: StateFile): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const target = this.statePath();
    const tmp = path.join(this.baseDir, `.browser-sessions.${process.pid}.${randomUUID()}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, target);
    fs.chmodSync(target, 0o600);
  }

  private statePath(): string {
    return path.join(this.baseDir, 'browser-sessions.json');
  }
}

function validateState(value: unknown): StateFile {
  if (!value || typeof value !== 'object') throw new ConfigError('browser-sessions.json must contain an object.');
  const state = value as { version?: unknown; sessions?: unknown };
  if (state.version !== 1 || !Array.isArray(state.sessions)) {
    throw new ConfigError('browser-sessions.json has an unsupported schema.');
  }
  const adapterDefaults = new Set<string>();
  const names = new Set<string>();
  const sessions = state.sessions.map((row) => validateRecord(row, adapterDefaults, names));
  return { version: 1, sessions };
}

function validateRecord(value: unknown, adapterDefaults: Set<string>, names: Set<string>): BrowserSessionRecord {
  if (!value || typeof value !== 'object') throw new ConfigError('browser-sessions.json contains an invalid Session record.');
  const row = value as Partial<BrowserSessionRecord>;
  if (typeof row.id !== 'string') throw new ConfigError('browser-sessions.json contains a Session without an id.');
  requireSessionIdShape(row.id);
  if (typeof row.profileId !== 'string' || !row.profileId.trim()) throw new ConfigError('browser-sessions.json contains a Session without a profileId.');
  if (row.kind !== 'explicit' && row.kind !== 'adapter-default') throw new ConfigError('browser-sessions.json contains an invalid Session kind.');
  const createdAt = row.createdAt;
  const updatedAt = row.updatedAt;
  const lastUsedAt = row.lastUsedAt;
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    throw new ConfigError('browser-sessions.json contains an invalid createdAt.');
  }
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    throw new ConfigError('browser-sessions.json contains an invalid updatedAt.');
  }
  if (typeof lastUsedAt !== 'string' || Number.isNaN(Date.parse(lastUsedAt))) {
    throw new ConfigError('browser-sessions.json contains an invalid lastUsedAt.');
  }
  if (row.kind === 'adapter-default') {
    const key = row.profileId;
    if (adapterDefaults.has(key)) throw new ConfigError(`browser-sessions.json contains multiple adapter-default Sessions for ${key}.`);
    adapterDefaults.add(key);
  }
  let name: string | undefined;
  if (row.name !== undefined) {
    if (typeof row.name !== 'string') throw new ConfigError('browser-sessions.json contains an invalid Session name.');
    name = normalizeSessionName(row.name);
    const key = `${row.profileId} ${name}`;
    if (names.has(key)) throw new ConfigError(`browser-sessions.json contains a duplicate Session name for ${row.profileId}.`);
    names.add(key);
  }
  const handoff = row.handoff;
  if (handoff && (
    typeof handoff.site !== 'string'
    || !handoff.site.trim()
    || typeof handoff.expiresAt !== 'string'
    || Number.isNaN(Date.parse(handoff.expiresAt))
  )) {
    throw new ConfigError('browser-sessions.json contains an invalid handoff.');
  }
  return {
    id: row.id,
    profileId: row.profileId,
    ...(name ? { name } : {}),
    kind: row.kind,
    createdAt,
    updatedAt,
    lastUsedAt,
    ...(handoff ? { handoff } : {}),
  };
}

export function isSessionIdShape(sessionId: string): boolean {
  return /^session_[A-Za-z0-9_-]+$/u.test(sessionId);
}

export function requireSessionIdShape(sessionId: string): void {
  if (!isSessionIdShape(sessionId)) throw new InvalidSessionSelectorError(sessionId);
}

/**
 * A name that looks like an ID would make selector resolution ambiguous, so
 * `session_`-prefixed aliases are rejected outright.
 */
export function isSessionNameShape(name: string): boolean {
  return name.length <= 64 && !name.startsWith('session_') && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(name);
}

export function normalizeSessionName(name: string): string {
  const value = name.trim();
  if (!value) throw new InvalidSessionNameError(name, 'a name is required');
  if (value.length > 64) throw new InvalidSessionNameError(name, 'names are limited to 64 characters');
  if (value.startsWith('session_')) throw new InvalidSessionNameError(name, 'names must not look like a Session ID');
  if (!isSessionNameShape(value)) throw new InvalidSessionNameError(name, 'names allow letters, digits, dash, underscore, and dot');
  return value;
}

function getWebcmdConfigDir(): string {
  return process.env[`${ENV_PREFIX}_CONFIG_DIR`] || path.join(os.homedir(), CONFIG_DIR_NAME);
}
