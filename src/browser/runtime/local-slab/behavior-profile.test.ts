import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BEHAVIOR_FILENAME,
  BEHAVIOR_LOCK,
  BEHAVIOR_SCHEMA_VERSION,
  loadOrCreateBehaviorProfile,
} from './behavior-profile.js';
import { resolveSlabProfileDir } from './profiles.js';

const temporaryDirectories: string[] = [];

async function createBaseDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webcmd-behavior-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('SLAB behavior profiles', () => {
  it('creates one document on first use and reloads identical traits', async () => {
    const baseDir = await createBaseDir();
    let i = 0;
    const random = () => (i++ % 10) / 10;

    const created = await loadOrCreateBehaviorProfile('Profile 1', { baseDir, random });
    const loaded = await loadOrCreateBehaviorProfile('Profile 1', { baseDir, random });

    expect(created.schemaVersion).toBe(BEHAVIOR_SCHEMA_VERSION);
    expect(loaded.traits).toEqual(created.traits);
    expect(created.warning).toBeUndefined();
    expect(loaded.warning).toBeUndefined();
    const raw = JSON.parse(await readFile(
      path.join(baseDir, 'slab', 'profiles', 'Profile 1', BEHAVIOR_FILENAME),
      'utf8',
    ));
    expect(raw.traits).toEqual(created.traits);
  });

  it('gives two profile ids independent documents', async () => {
    const baseDir = await createBaseDir();

    const first = await loadOrCreateBehaviorProfile('Profile 1', { baseDir, random: () => 0 });
    const second = await loadOrCreateBehaviorProfile('Profile 2', { baseDir, random: () => 0.999 });

    expect(first.profileId).toBe('Profile 1');
    expect(second.profileId).toBe('Profile 2');
    expect(second.traits).not.toEqual(first.traits);
  });

  it('serializes concurrent first use so callers share one personality', async () => {
    const baseDir = await createBaseDir();

    const [first, second] = await Promise.all([
      loadOrCreateBehaviorProfile('default', { baseDir, random: () => 0 }),
      loadOrCreateBehaviorProfile('default', { baseDir, random: () => 0.999 }),
    ]);

    expect(second.traits).toEqual(first.traits);
  });

  it('recovers from an abandoned behavior lock older than one minute', async () => {
    const baseDir = await createBaseDir();
    const profileDir = resolveSlabProfileDir('default', { baseDir });
    await mkdir(profileDir, { recursive: true });
    const lockPath = path.join(profileDir, BEHAVIOR_LOCK);
    await writeFile(lockPath, '');
    const stale = new Date(Date.now() - 61_000);
    await utimes(lockPath, stale, stale);

    await expect(loadOrCreateBehaviorProfile('default', { baseDir })).resolves.toMatchObject({
      profileId: 'default',
      schemaVersion: BEHAVIOR_SCHEMA_VERSION,
    });
  });

  it('names the blocking lock file when initialization times out', async () => {
    const baseDir = await createBaseDir();
    const profileDir = resolveSlabProfileDir('default', { baseDir });
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, BEHAVIOR_LOCK), '');

    await expect(loadOrCreateBehaviorProfile('default', { baseDir }))
      .rejects.toThrow(/behavior\.lock/);
  }, 10_000);

  it('retains existing trait values and samples only missing allowlisted fields', async () => {
    const baseDir = await createBaseDir();
    const profileDir = resolveSlabProfileDir('default', { baseDir });
    await mkdir(profileDir, { recursive: true });
    const partial = {
      schemaVersion: 1,
      profileId: 'default',
      traits: { typing_delay: 91, idle_between_actions: false },
    };
    await writeFile(path.join(profileDir, BEHAVIOR_FILENAME), JSON.stringify(partial));

    const loaded = await loadOrCreateBehaviorProfile('default', { baseDir, random: () => 0.5 });

    expect(loaded.traits.typing_delay).toBe(91);
    expect(loaded.traits.typing_delay_spread).toEqual(expect.any(Number));
    expect(loaded.warning).toBeUndefined();
  });

  it('moves a malformed current document aside and regenerates it once', async () => {
    const baseDir = await createBaseDir();
    const profileDir = resolveSlabProfileDir('default', { baseDir });
    await mkdir(profileDir, { recursive: true });
    await writeFile(path.join(profileDir, BEHAVIOR_FILENAME), '{"schemaVersion":1,"traits":');

    const document = await loadOrCreateBehaviorProfile('default', {
      baseDir,
      now: () => 123,
      random: () => 0.5,
    });

    expect(document.schemaVersion).toBe(BEHAVIOR_SCHEMA_VERSION);
    expect(document.warning).toMatch(/regenerated.*malformed/i);
    expect(await readFile(path.join(profileDir, 'behavior.json.corrupt-123'), 'utf8'))
      .toBe('{"schemaVersion":1,"traits":');
  });

  it('errors on a future schema version without overwriting it', async () => {
    const baseDir = await createBaseDir();
    const profileDir = resolveSlabProfileDir('default', { baseDir });
    await mkdir(profileDir, { recursive: true });
    const futureDocument = JSON.stringify({ schemaVersion: 99, profileId: 'default', traits: {} });
    await writeFile(path.join(profileDir, BEHAVIOR_FILENAME), futureDocument);

    await expect(loadOrCreateBehaviorProfile('default', { baseDir }))
      .rejects.toThrow(/newer schema version/i);
    expect(await readFile(path.join(profileDir, BEHAVIOR_FILENAME), 'utf8')).toBe(futureDocument);
  });

  it('fails clearly when the behavior profile cannot be persisted', async () => {
    const baseDir = await createBaseDir();
    const unavailableDirectory = path.join(baseDir, 'unwritable');
    await writeFile(unavailableDirectory, 'not a directory');

    await expect(loadOrCreateBehaviorProfile('default', { baseDir: unavailableDirectory }))
      .rejects.toThrow(/persist behavior profile/i);
  });

  it('writes only allowlisted behavior traits and disables idle actions', async () => {
    const baseDir = await createBaseDir();
    const document = await loadOrCreateBehaviorProfile('default', { baseDir, random: () => 0.5 });

    expect(JSON.stringify(document)).not.toMatch(/cookie|history|canvas|webgl/i);
    expect(document.traits.idle_between_actions).toBe(false);
  });

  it('keeps behavior.json owner-readable and writable only', async () => {
    const baseDir = await createBaseDir();
    await loadOrCreateBehaviorProfile('default', { baseDir });

    const file = await stat(path.join(resolveSlabProfileDir('default', { baseDir }), BEHAVIOR_FILENAME));
    if (process.platform !== 'win32') {
      expect(file.mode & 0o777).toBe(0o600);
    }
  });
});
