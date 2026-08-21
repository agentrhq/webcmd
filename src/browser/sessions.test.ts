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
  it('creates unique explicit sessions and persists them', () => {
    const baseDir = tempDir();
    const store = new LocalBrowserSessionStore({
      baseDir,
      now: () => new Date('2026-08-11T00:00:00.000Z'),
      idFactory: () => 'session_11111111-1111-4111-8111-111111111111',
    });

    const created = store.create('profile_work');

    expect(created).toMatchObject({
      id: 'session_11111111-1111-4111-8111-111111111111',
      profileId: 'profile_work',
      kind: 'explicit',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      lastUsedAt: '2026-08-11T00:00:00.000Z',
    });
    expect(store.create('profile_work').id).not.toBe(created.id);
    expect(new LocalBrowserSessionStore({ baseDir }).find('profile_work', created.id)?.id).toBe(created.id);
  });

  it('scopes lookup by profile and validates opaque ids', () => {
    const store = new LocalBrowserSessionStore({ baseDir: tempDir(), idFactory: () => 'session_a' });
    const created = store.create('profile_work');

    expect(() => store.require('profile_other', created.id)).toThrowError(expect.objectContaining({ code: 'SESSION_NOT_FOUND' }));
    expect(() => store.find('profile_work', 'work')).toThrowError(expect.objectContaining({ code: 'INVALID_SESSION_SELECTOR' }));
  });

  it('names the owning profile when the session exists under a different one', () => {
    // A cleanup command that omits `--profile` looks up a real Session ID in
    // the wrong Profile. A bare "not found" sent agents into retrying the same
    // command; naming the owner and the retry shape ends that loop.
    const store = new LocalBrowserSessionStore({ baseDir: tempDir(), idFactory: () => 'session_a' });
    const created = store.create('profile_work');

    expect(() => store.require('profile_personal', created.id)).toThrowError(expect.objectContaining({
      code: 'SESSION_NOT_FOUND',
      ownerProfileId: 'profile_work',
      message: `Session not found in Profile profile_personal: ${created.id}`,
      hint: `Session ${created.id} belongs to Profile profile_work. Re-run the same command with \`--profile profile_work\`, for example \`webcmd --profile profile_work session close ${created.id}\`.`,
    }));
  });

  it('names the owning profile on mutating lookups too', () => {
    // `remove`/`touch`/handoff updates resolve the record through a separate
    // lookup, so the close path must not fall back to the anonymous message.
    const store = new LocalBrowserSessionStore({ baseDir: tempDir(), idFactory: () => 'session_a' });
    const created = store.create('profile_work');

    expect(() => store.remove('profile_personal', created.id)).toThrowError(expect.objectContaining({
      code: 'SESSION_NOT_FOUND',
      ownerProfileId: 'profile_work',
    }));
  });

  it('keeps the generic hint when no profile owns the session', () => {
    const store = new LocalBrowserSessionStore({ baseDir: tempDir() });

    expect(() => store.require('profile_work', 'session_missing')).toThrowError(expect.objectContaining({
      code: 'SESSION_NOT_FOUND',
      ownerProfileId: undefined,
      message: 'Session not found: session_missing',
      hint: 'Run `webcmd --profile profile_work session list` to choose an existing Session.',
    }));
  });

  it('resolves one lazy adapter-default per profile without list side effects', () => {
    const store = new LocalBrowserSessionStore({
      baseDir: tempDir(),
      idFactory: () => 'session_default',
    });

    expect(store.list('profile_work')).toEqual([]);
    const adapterDefault = store.resolveAdapterDefault('profile_work');

    expect(adapterDefault.kind).toBe('adapter-default');
    expect(store.resolveAdapterDefault('profile_work').id).toBe(adapterDefault.id);
    expect(store.list('profile_work')).toHaveLength(1);
  });

  it('writes state atomically with private file mode', () => {
    const baseDir = tempDir();
    const store = new LocalBrowserSessionStore({ baseDir, idFactory: () => 'session_private' });

    store.create('profile_work');

    const statePath = path.join(baseDir, 'browser-sessions.json');
    expect(fs.existsSync(statePath)).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(baseDir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('fails closed on malformed persisted JSON', () => {
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), '{not json', { mode: 0o600 });

    expect(() => new LocalBrowserSessionStore({ baseDir }).list('profile_work'))
      .toThrowError(expect.objectContaining({ code: 'CONFIG' }));
  });

  it('clears expired handoffs while resolving and listing Sessions', () => {
    let now = new Date('2026-08-11T00:00:00.000Z');
    const store = new LocalBrowserSessionStore({
      baseDir: tempDir(),
      now: () => now,
      idFactory: () => 'session_a',
    });
    const session = store.create('work');
    store.markHandoff('work', session.id, {
      site: 'github',
      expiresAt: '2026-08-11T00:15:00.000Z',
    });

    expect(store.require('work', session.id).handoff).toEqual({
      site: 'github',
      expiresAt: '2026-08-11T00:15:00.000Z',
    });
    now = new Date('2026-08-11T00:15:00.000Z');

    expect(store.require('work', session.id).handoff).toBeUndefined();
    expect(store.list('work')[0]?.handoff).toBeUndefined();
  });

  it('prunes explicit Sessions idle for 30 days while preserving adapter defaults and handoffs', () => {
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), `${JSON.stringify({
      version: 1,
      sessions: [
        sessionRecord('session_old', 'explicit', '2026-07-11T23:59:59.000Z'),
        sessionRecord('session_boundary', 'explicit', '2026-07-12T00:00:01.000Z'),
        sessionRecord('session_handoff', 'explicit', '2026-07-01T00:00:00.000Z', { site: 'github', expiresAt: '2026-08-12T00:15:00.000Z' }),
        sessionRecord('session_expired_handoff', 'explicit', '2026-07-01T00:00:00.000Z', { site: 'github', expiresAt: '2026-08-10T00:15:00.000Z' }),
        sessionRecord('session_default', 'adapter-default', '2026-07-01T00:00:00.000Z'),
      ],
    })}\n`, { mode: 0o600 });

    const rows = new LocalBrowserSessionStore({
      baseDir,
      now: () => new Date('2026-08-11T00:00:00.000Z'),
    }).list('work');

    expect(rows.map((row) => row.id)).toEqual(['session_boundary', 'session_default', 'session_handoff']);
  });

  it('retains active Sessions and limits newest-first listings', () => {
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), `${JSON.stringify({
      version: 1,
      sessions: [
        sessionRecord('session_active', 'explicit', '2026-07-01T00:00:00.000Z'),
        sessionRecord('session_newest', 'explicit', '2026-08-10T00:00:00.000Z'),
        sessionRecord('session_middle', 'explicit', '2026-08-09T00:00:00.000Z'),
      ],
    })}\n`, { mode: 0o600 });

    const rows = new LocalBrowserSessionStore({
      baseDir,
      now: () => new Date('2026-08-11T00:00:00.000Z'),
      isActive: session => session.id === 'session_active',
    }).list('work', 2);

    expect(rows.map((row) => row.id)).toEqual(['session_newest', 'session_middle']);
    expect(new LocalBrowserSessionStore({
      baseDir,
      now: () => new Date('2026-08-11T00:00:00.000Z'),
      isActive: session => session.id === 'session_active',
    }).find('work', 'session_active')).toBeDefined();
  });
});

function sessionRecord(
  id: string,
  kind: 'explicit' | 'adapter-default',
  lastUsedAt: string,
  handoff?: { site: string; expiresAt: string },
) {
  return { id, profileId: 'work', kind, createdAt: lastUsedAt, updatedAt: lastUsedAt, lastUsedAt, ...(handoff ? { handoff } : {}) };
}
