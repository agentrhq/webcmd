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
    expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(baseDir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('fails closed on malformed persisted JSON', () => {
    const baseDir = tempDir();
    fs.writeFileSync(path.join(baseDir, 'browser-sessions.json'), '{not json', { mode: 0o600 });

    expect(() => new LocalBrowserSessionStore({ baseDir }).list('profile_work'))
      .toThrowError(expect.objectContaining({ code: 'CONFIG' }));
  });
});
