import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR_NAME, ENV_PREFIX } from '../brand.js';
import { CliError, ConfigError, EXIT_CODES } from '../errors.js';

export interface BrowserSessionRecord {
  id: string;
  profileId: string;
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
}

type StateFile = { version: 1; sessions: BrowserSessionRecord[] };

export class SessionNotFoundError extends CliError {
  constructor(sessionId: string, profileId: string) {
    super(
      'SESSION_NOT_FOUND',
      `Session not found: ${sessionId}`,
      `Run \`webcmd --profile ${profileId} session list\` to choose an existing Session.`,
      EXIT_CODES.EMPTY_RESULT,
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

  constructor(opts: LocalBrowserSessionStoreOptions = {}) {
    this.baseDir = opts.baseDir ?? getWebcmdConfigDir();
    this.now = opts.now ?? (() => new Date());
    this.idFactory = opts.idFactory ?? (() => `session_${randomUUID()}`);
  }

  create(profileId: string): BrowserSessionRecord {
    const state = this.load();
    const record = this.newRecord(profileId, 'explicit', state.sessions);
    state.sessions.push(record);
    this.save(state);
    return { ...record };
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
    if (!record) throw new SessionNotFoundError(id, profileId);
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

  list(profileId?: string): BrowserSessionListRow[] {
    const rows = this.load().sessions
      .filter((row) => profileId === undefined || row.profileId === profileId);
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
    if (!record) throw new SessionNotFoundError(sessionId, profileId);
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
    return validateState(parsed);
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
  const sessions = state.sessions.map((row) => validateRecord(row, adapterDefaults));
  return { version: 1, sessions };
}

function validateRecord(value: unknown, adapterDefaults: Set<string>): BrowserSessionRecord {
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
  return {
    id: row.id,
    profileId: row.profileId,
    kind: row.kind,
    createdAt,
    updatedAt,
    lastUsedAt,
    ...(row.handoff ? { handoff: row.handoff } : {}),
  };
}

export function requireSessionIdShape(sessionId: string): void {
  if (!/^session_[A-Za-z0-9_-]+$/u.test(sessionId)) throw new InvalidSessionSelectorError(sessionId);
}

function getWebcmdConfigDir(): string {
  return process.env[`${ENV_PREFIX}_CONFIG_DIR`] || path.join(os.homedir(), CONFIG_DIR_NAME);
}
