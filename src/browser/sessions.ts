import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI_COMMAND, CONFIG_DIR_NAME, ENV_PREFIX } from '../brand.js';
import { CliError, ConfigError, EXIT_CODES } from '../errors.js';
import {
  ADAPTER_DEFAULT_SESSION_ID,
  generateSessionSuffix,
  requireSessionIdShape,
  requireSessionName,
  SESSION_GENERATION_ATTEMPTS,
  SessionIdGenerationError,
} from './session-identifiers.js';

export interface BrowserSessionRecord {
  id: string;
  profileId: string;
  kind: 'explicit' | 'adapter-default';
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  handoff?: { site: string; expiresAt: string };
}

export interface ManagedBrowserSessionListRow extends BrowserSessionRecord {
  rowKind?: 'session';
  runtimeState: 'idle' | 'active';
  provenance?: 'agent-created' | 'human-adopted';
  window?: string;
}

export interface DiscoveredBrowserWindowListRow {
  rowKind: 'discovered';
  profileId: string;
  runtimeState: 'available';
  window: string;
  page: string;
  tabCount: number;
  title: string;
  url: string;
  ownership: 'unowned';
}

export type BrowserSessionListRow = ManagedBrowserSessionListRow | DiscoveredBrowserWindowListRow;

export interface LocalBrowserSessionStoreOptions {
  baseDir?: string;
  now?: () => Date;
  suffixFactory?: () => string;
  isActive?: (record: BrowserSessionRecord) => boolean;
}

type StateFile = { version: 2; sessions: BrowserSessionRecord[] };
const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class SessionNotFoundError extends CliError {
  constructor(sessionId: string, profileId: string) {
    super(
      'SESSION_NOT_FOUND',
      `Session not found: ${sessionId}`,
      `Run \`${CLI_COMMAND} --profile ${profileId} session list\` to choose an existing readable Session ID, then \`${CLI_COMMAND} session close <session-id>\`.`,
      EXIT_CODES.EMPTY_RESULT,
    );
  }
}

export class LocalBrowserSessionStore {
  private readonly baseDir: string;
  private readonly now: () => Date;
  private readonly suffixFactory: () => string;
  private readonly isActive: (record: BrowserSessionRecord) => boolean;

  constructor(opts: LocalBrowserSessionStoreOptions = {}) {
    this.baseDir = opts.baseDir ?? getWebcmdConfigDir();
    this.now = opts.now ?? (() => new Date());
    this.suffixFactory = opts.suffixFactory ?? generateSessionSuffix;
    this.isActive = opts.isActive ?? (() => false);
  }

  create(profileId: string, name: string): BrowserSessionRecord {
    const state = this.load();
    const record = this.newExplicitRecord(profileId, name, state.sessions);
    state.sessions.push(record);
    this.save(state);
    return { ...record };
  }

  find(profileId: string, sessionId: string): BrowserSessionRecord | undefined {
    requireSessionIdShape(sessionId);
    const record = this.load().sessions.find((row) => row.id === sessionId && row.profileId === profileId);
    return record ? { ...record } : undefined;
  }

  require(profileId: string, sessionId: string | undefined): BrowserSessionRecord {
    const id = sessionId?.trim() ?? '';
    requireSessionIdShape(id);
    const state = this.load();
    const record = state.sessions.find((row) => row.id === id && row.profileId === profileId);
    if (!record) throw new SessionNotFoundError(id, profileId);
    this.touchRecord(state, record);
    return { ...record };
  }

  resolveAdapterDefault(profileId: string): BrowserSessionRecord {
    const state = this.load();
    const existing = state.sessions.find((row) => row.profileId === profileId && row.id === ADAPTER_DEFAULT_SESSION_ID);
    if (existing) {
      this.touchRecord(state, existing);
      return { ...existing };
    }
    const timestamp = this.now().toISOString();
    const record: BrowserSessionRecord = {
      id: ADAPTER_DEFAULT_SESSION_ID,
      profileId,
      kind: 'adapter-default',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    };
    state.sessions.push(record);
    this.save(state);
    return { ...record };
  }

  list(profileId?: string, limit = 20): ManagedBrowserSessionListRow[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new CliError('INVALID_SESSION_LIMIT', 'Session list limit must be an integer from 1 to 100.', undefined, EXIT_CODES.USAGE_ERROR);
    }
    const rows = this.load().sessions
      .filter((row) => profileId === undefined || row.profileId === profileId)
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
    return rows.map((row) => ({ ...row, rowKind: 'session' as const, runtimeState: 'idle' as const }));
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

  private newExplicitRecord(profileId: string, name: string, existing: BrowserSessionRecord[]): BrowserSessionRecord {
    const base = requireSessionName(name);
    const used = new Set(existing.filter((row) => row.profileId === profileId).map((row) => row.id));
    for (let attempt = 0; attempt < SESSION_GENERATION_ATTEMPTS; attempt += 1) {
      const id = `${base}-${this.suffixFactory()}`;
      if (used.has(id)) continue;
      requireSessionIdShape(id);
      const timestamp = this.now().toISOString();
      return { id, profileId, kind: 'explicit', createdAt: timestamp, updatedAt: timestamp, lastUsedAt: timestamp };
    }
    throw new SessionIdGenerationError(name);
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
    if (!record) throw new SessionNotFoundError(sessionId, profileId);
    return record;
  }

  private load(): StateFile {
    const file = this.statePath();
    if (!fs.existsSync(file)) return { version: 2, sessions: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new ConfigError(`Could not read browser sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (isVersionOneState(parsed)) {
      const state: StateFile = { version: 2, sessions: [] };
      this.save(state);
      return state;
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
    state.sessions = state.sessions.filter((record) => {
      const expired = record.kind === 'explicit'
        && !record.handoff
        && !this.isActive(record)
        && Date.parse(record.lastUsedAt) <= now - SESSION_RETENTION_MS;
      if (expired) changed = true;
      return !expired;
    });
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

function isVersionOneState(value: unknown): value is { version: 1 } {
  return Boolean(value) && typeof value === 'object' && (value as { version?: unknown }).version === 1;
}

function validateState(value: unknown): StateFile {
  if (!value || typeof value !== 'object') throw new ConfigError('browser-sessions.json must contain an object.');
  const state = value as { version?: unknown; sessions?: unknown };
  if (state.version !== 2 || !Array.isArray(state.sessions)) {
    throw new ConfigError('browser-sessions.json has an unsupported schema.');
  }
  const adapterDefaults = new Set<string>();
  const sessions = state.sessions.map((row) => validateRecord(row, adapterDefaults));
  return { version: 2, sessions };
}

function validateRecord(value: unknown, adapterDefaults: Set<string>): BrowserSessionRecord {
  if (!value || typeof value !== 'object') throw new ConfigError('browser-sessions.json contains an invalid Session record.');
  const row = value as Partial<BrowserSessionRecord>;
  if (typeof row.id !== 'string') throw new ConfigError('browser-sessions.json contains a Session without an id.');
  try {
    requireSessionIdShape(row.id);
  } catch {
    throw new ConfigError('browser-sessions.json contains a Session with an invalid readable id.');
  }
  if (typeof row.profileId !== 'string' || !row.profileId.trim()) throw new ConfigError('browser-sessions.json contains a Session without a profileId.');
  if (row.kind !== 'explicit' && row.kind !== 'adapter-default') throw new ConfigError('browser-sessions.json contains an invalid Session kind.');
  if ((row.kind === 'adapter-default') !== (row.id === ADAPTER_DEFAULT_SESSION_ID)) {
    throw new ConfigError('browser-sessions.json contains a Session with an invalid kind/id combination.');
  }
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
    if (adapterDefaults.has(row.profileId)) throw new ConfigError(`browser-sessions.json contains multiple adapter-default Sessions for ${row.profileId}.`);
    adapterDefaults.add(row.profileId);
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
    kind: row.kind,
    createdAt,
    updatedAt,
    lastUsedAt,
    ...(handoff ? { handoff } : {}),
  };
}

function getWebcmdConfigDir(): string {
  return process.env[`${ENV_PREFIX}_CONFIG_DIR`] || path.join(os.homedir(), CONFIG_DIR_NAME);
}
