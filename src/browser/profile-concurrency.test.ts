import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV_PREFIX } from '../brand.js';
import { ConfigError } from '../errors.js';
import { createProviderProfile, loadProfileConfig } from './profile.js';

describe('provider Profile config transactions', () => {
  let configDir: string;
  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-profile-lock-'));
    vi.stubEnv(`${ENV_PREFIX}_CONFIG_DIR`, configDir);
  });
  afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(configDir, { recursive: true, force: true }); });

  it('retains concurrent mutations in independent provider namespaces', async () => {
    await Promise.all([
      createProviderProfile('cloak', 'work'),
      createProviderProfile('chrome', 'personal'),
    ]);
    expect(loadProfileConfig('cloak').aliases).toEqual({ work: 'work' });
    expect(loadProfileConfig('chrome').aliases).toEqual({ personal: 'personal' });
    const target = path.join(configDir, 'browser-profiles-v2.json');
    expect(() => JSON.parse(fs.readFileSync(target, 'utf8'))).not.toThrow();
    if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(configDir).filter(name => name.includes('.tmp') || name.endsWith('.lock'))).toEqual([]);
  });

  it('serializes mutations made by independent processes', async () => {
    const run = promisify(execFile);
    const moduleUrl = new URL('./profile.ts', import.meta.url).href;
    await Promise.all(Array.from({ length: 6 }, (_, index) => run(process.execPath, [
      '--import',
      'tsx',
      '--eval',
      `import { createProviderProfile } from ${JSON.stringify(moduleUrl)}; void createProviderProfile('cloak', ${JSON.stringify(`worker-${index}`)});`,
    ], {
      env: { ...process.env, [`${ENV_PREFIX}_CONFIG_DIR`]: configDir },
    })));
    expect(Object.keys(loadProfileConfig('cloak').aliases).sort()).toEqual(
      Array.from({ length: 6 }, (_, index) => `worker-${index}`),
    );
  });

  it('reclaims a dead-owner lock but fails closed for a malformed crash lock', async () => {
    const lock = path.join(configDir, 'browser-profiles-v2.json.lock');
    fs.writeFileSync(lock, JSON.stringify({ pid: 999_999_999, createdAt: 0, token: 'dead' }));
    await expect(createProviderProfile('cloak', 'after-dead')).resolves.toMatchObject({ created: true });

    fs.writeFileSync(lock, 'truncated-after-crash');
    const old = new Date(Date.now() - 2_000);
    fs.utimesSync(lock, old, old);
    vi.stubEnv(`${ENV_PREFIX}_PROFILE_LOCK_TIMEOUT_MS`, '20');
    await expect(createProviderProfile('cloak', 'after-malformed')).rejects.toBeInstanceOf(ConfigError);
    expect(fs.readFileSync(lock, 'utf8')).toBe('truncated-after-crash');
  });

  it('never steals an old lock from a live owner', async () => {
    const lock = path.join(configDir, 'browser-profiles-v2.json.lock');
    const owner = { pid: process.pid, createdAt: 0, token: 'still-live' };
    fs.writeFileSync(lock, JSON.stringify(owner));
    const pending = createProviderProfile('cloak', 'after-live-owner');
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(JSON.parse(fs.readFileSync(lock, 'utf8'))).toEqual(owner);
    expect(loadProfileConfig('cloak').aliases).not.toHaveProperty('after-live-owner');
    fs.unlinkSync(lock);
    await expect(pending).resolves.toMatchObject({ created: true });
  });

  it('returns a stable ConfigError when a live owner remains paused past the wait budget', async () => {
    const lock = path.join(configDir, 'browser-profiles-v2.json.lock');
    const owner = { pid: process.pid, createdAt: 0, token: 'paused-live-writer' };
    fs.writeFileSync(lock, JSON.stringify(owner));
    vi.stubEnv(`${ENV_PREFIX}_PROFILE_LOCK_TIMEOUT_MS`, '20');
    const blocked = createProviderProfile('cloak', 'blocked');
    await expect(blocked).rejects.toBeInstanceOf(ConfigError);
    await expect(blocked).rejects.toMatchObject({ code: 'CONFIG', exitCode: 78 });
    expect(JSON.parse(fs.readFileSync(lock, 'utf8'))).toEqual(owner);
  });
});
