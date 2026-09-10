import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalBrowserSessionStore } from './sessions.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-sessions-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('LocalBrowserSessionStore', () => {
  it('creates readable IDs that are unique within each profile', () => {
    const baseDir = tempDir();
    const suffixes = ['k7', 'k7', '8n', 'k7'];
    const store = new LocalBrowserSessionStore({
      baseDir,
      suffixFactory: () => suffixes.shift()!,
    });

    expect(store.create('profile-a', 'Work Project').id).toBe('work-project-k7');
    expect(store.create('profile-a', 'Work Project').id).toBe('work-project-8n');
    expect(store.create('profile-b', 'Work Project').id).toBe('work-project-k7');
    expect(store.resolveAdapterDefault('profile-a').id).toBe('adapter-default');
  });

  it('fails after ten readable ID collisions', () => {
    const now = new Date();
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), `${JSON.stringify({
      version: 2,
      sessions: [sessionRecord('work-project-k7', 'explicit', isoAt(now))],
    })}\n`, { mode: 0o600 });
    const store = new LocalBrowserSessionStore({
      baseDir,
      suffixFactory: () => 'k7',
      now: () => now,
    });

    expect(() => store.create('work', 'Work Project')).toThrowError(
      expect.objectContaining({ code: 'SESSION_ID_GENERATION_FAILED' }),
    );
  });

  it('scopes lookups by profile and validates readable IDs', () => {
    const store = new LocalBrowserSessionStore({ baseDir: tempDir(), suffixFactory: () => 'k7' });
    const created = store.create('profile-work', 'Work');

    expect(() => store.require('profile-other', created.id)).toThrowError(expect.objectContaining({
      code: 'SESSION_NOT_FOUND',
    }));
    expect(() => store.find('profile-work', 'work')).toThrowError(expect.objectContaining({ code: 'INVALID_SESSION_SELECTOR' }));
  });

  it('resolves one lazy adapter-default per profile without list side effects', () => {
    const store = new LocalBrowserSessionStore({
      baseDir: tempDir(),
      suffixFactory: () => 'k7',
    });

    expect(store.list('profile-work')).toEqual([]);
    const adapterDefault = store.resolveAdapterDefault('profile-work');

    expect(adapterDefault).toMatchObject({ id: 'adapter-default', kind: 'adapter-default' });
    expect(store.resolveAdapterDefault('profile-work').id).toBe('adapter-default');
    expect(store.list('profile-work')).toHaveLength(1);
  });

  it('writes state atomically with private file mode', () => {
    const baseDir = tempDir();
    const store = new LocalBrowserSessionStore({ baseDir, suffixFactory: () => 'k7' });

    store.create('profile-work', 'Private');

    const statePath = path.join(baseDir, 'browser-sessions.json');
    expect(fs.existsSync(statePath)).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(baseDir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('discards version-1 state into an empty version-2 state without a backup', () => {
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), `${JSON.stringify({
      version: 1,
      sessions: [sessionRecord('old-k7', 'explicit', isoAt(new Date()))],
    })}\n`, { mode: 0o600 });

    expect(new LocalBrowserSessionStore({ baseDir }).list('work')).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(baseDir, 'browser-sessions.json'), 'utf8'))).toEqual({
      version: 2,
      sessions: [],
    });
    expect(fs.readdirSync(baseDir)).toEqual(['browser-sessions.json']);
  });

  it('fails closed on malformed persisted JSON', () => {
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), '{not json', { mode: 0o600 });

    expect(() => new LocalBrowserSessionStore({ baseDir }).list('profile-work'))
      .toThrowError(expect.objectContaining({ code: 'CONFIG' }));
  });

  it.each([
    sessionRecord('adapter-default', 'explicit', isoAt(new Date())),
    sessionRecord('work-k7', 'adapter-default', isoAt(new Date())),
  ])('rejects persisted rows that violate the kind/ID invariant', (record) => {
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), `${JSON.stringify({ version: 2, sessions: [record] })}\n`, { mode: 0o600 });

    expect(() => new LocalBrowserSessionStore({ baseDir }).list('work'))
      .toThrowError(expect.objectContaining({ code: 'CONFIG' }));
  });

  it('clears expired handoffs while resolving and listing Sessions', () => {
    let now = new Date();
    const expiresAt = isoAt(now, 15 * 60 * 1000);
    const store = new LocalBrowserSessionStore({
      baseDir: tempDir(),
      now: () => now,
      suffixFactory: () => 'k7',
    });
    const session = store.create('work', 'Work');
    store.markHandoff('work', session.id, {
      site: 'github',
      expiresAt,
    });

    expect(store.require('work', session.id).handoff).toEqual({
      site: 'github',
      expiresAt,
    });
    now = new Date(now.getTime() + 15 * 60 * 1000);

    expect(store.require('work', session.id).handoff).toBeUndefined();
    expect(store.list('work')[0]?.handoff).toBeUndefined();
  });

  it('prunes explicit Sessions idle for 30 days while preserving adapter defaults and handoffs', () => {
    const now = new Date();
    const retentionMs = 30 * DAY_MS;
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), `${JSON.stringify({
      version: 2,
      sessions: [
        sessionRecord('old-k7', 'explicit', isoAt(now, -retentionMs - 1000)),
        sessionRecord('boundary-k7', 'explicit', isoAt(now, -retentionMs)),
        sessionRecord('recent-k7', 'explicit', isoAt(now, -retentionMs + 1000)),
        sessionRecord('handoff-k7', 'explicit', isoAt(now, -41 * DAY_MS), { site: 'github', expiresAt: isoAt(now, DAY_MS + 15 * 60 * 1000) }),
        sessionRecord('expired-handoff-k7', 'explicit', isoAt(now, -41 * DAY_MS), { site: 'github', expiresAt: isoAt(now, -DAY_MS + 15 * 60 * 1000) }),
        sessionRecord('adapter-default', 'adapter-default', isoAt(now, -41 * DAY_MS)),
      ],
    })}\n`, { mode: 0o600 });

    const rows = new LocalBrowserSessionStore({
      baseDir,
      now: () => now,
    }).list('work');

    expect(rows.map((row) => row.id)).toEqual(['recent-k7', 'adapter-default', 'handoff-k7']);
  });

  it('retains active Sessions and limits newest-first listings', () => {
    const now = new Date();
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), `${JSON.stringify({
      version: 2,
      sessions: [
        sessionRecord('active-k7', 'explicit', isoAt(now, -41 * DAY_MS)),
        sessionRecord('newest-k7', 'explicit', isoAt(now, -DAY_MS)),
        sessionRecord('middle-k7', 'explicit', isoAt(now, -2 * DAY_MS)),
      ],
    })}\n`, { mode: 0o600 });

    const rows = new LocalBrowserSessionStore({
      baseDir,
      now: () => now,
      isActive: session => session.id === 'active-k7',
    }).list('work', 2);

    expect(rows.map((row) => row.id)).toEqual(['newest-k7', 'middle-k7']);
    expect(new LocalBrowserSessionStore({
      baseDir,
      now: () => now,
      isActive: session => session.id === 'active-k7',
    }).find('work', 'active-k7')).toBeDefined();
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAt(now: Date, offsetMs = 0): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

function sessionRecord(
  id: string,
  kind: 'explicit' | 'adapter-default',
  lastUsedAt: string,
  handoff?: { site: string; expiresAt: string },
) {
  return { id, profileId: 'work', kind, createdAt: lastUsedAt, updatedAt: lastUsedAt, lastUsedAt, ...(handoff ? { handoff } : {}) };
}
