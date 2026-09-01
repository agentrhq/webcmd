import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultHostedApiBaseUrl,
  getConfigPath,
  isHostedConfig,
  loadWebcmdConfig,
  makeHostedConfig,
  makeLocalConfig,
  resolveHostedProfileSelection,
  saveWebcmdConfig,
  withHostedPreferredProfile,
} from './config.js';
import { resolveHostedApiKey } from './credentials.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('hosted config', () => {
  it('defaults to local mode when config is absent', () => {
    tempDir = join(tmpdir(), `webcmd-config-missing-${Date.now()}`);

    expect(loadWebcmdConfig({ env: { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv })).toEqual({
      mode: 'local',
      updatedAt: '1970-01-01T00:00:00.000Z',
      browser: { kind: 'cloak' },
    });
  });

  it('writes and reads hosted config', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-config-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const config = makeHostedConfig({
      apiBaseUrl: 'https://api.example.com/',
      apiKey: 'wcmd_live_test',
      now: new Date('2026-07-08T00:00:00.000Z'),
    });

    saveWebcmdConfig(config, { env });

    expect(getConfigPath({ env })).toBe(join(tempDir, 'config.json'));
    expect(loadWebcmdConfig({ env })).toEqual({
      mode: 'hosted',
      updatedAt: '2026-07-08T00:00:00.000Z',
      hosted: {
        apiBaseUrl: 'https://api.example.com',
        apiKey: 'wcmd_live_test',
      },
    });
    expect(isHostedConfig(loadWebcmdConfig({ env }))).toBe(true);
  });

  it('migrates a legacy inline API key without losing manifest cache', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-config-migrate-'));
    const env = {
      WEBCMD_CONFIG_DIR: tempDir,
      WEBCMD_CREDENTIAL_BACKEND: 'file',
    } as NodeJS.ProcessEnv;
    await writeFile(getConfigPath({ env }), JSON.stringify({
      mode: 'hosted',
      updatedAt: '2026-07-08T00:00:00.000Z',
      hosted: {
        apiBaseUrl: 'https://api.example.com',
        apiKey: 'wcmd_legacy_secret',
        manifestCache: {
          fetchedAt: '2026-07-08T00:01:00.000Z',
          manifest: { ok: true },
        },
        preferredProfile: 'work',
      },
    }, null, 2));

    const loaded = loadWebcmdConfig({ env });
    if (!isHostedConfig(loaded)) throw new Error('Expected hosted config');
    const credential = await resolveHostedApiKey(loaded, { env, platform: 'linux' });
    const persisted = await readFile(getConfigPath({ env }), 'utf8');

    expect(credential).toMatchObject({
      apiKey: 'wcmd_legacy_secret',
      backend: 'file-fallback',
      migrated: true,
    });
    expect(persisted).not.toContain('wcmd_legacy_secret');
    expect(persisted).toContain('apiKeyRef');
    expect(persisted).toContain('manifestCache');
    expect(persisted).toContain('preferredProfile');
  });

  it('loads old hosted config without inventing a preferred profile', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-config-profile-old-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    await writeFile(getConfigPath({ env }), JSON.stringify({
      mode: 'hosted',
      updatedAt: '2026-08-27T00:00:00.000Z',
      hosted: { apiBaseUrl: 'https://api.example.com', apiKey: 'key' },
    }));

    const loaded = loadWebcmdConfig({ env });
    if (!isHostedConfig(loaded)) throw new Error('Expected hosted config');
    expect(loaded.hosted.preferredProfile).toBeUndefined();
  });

  it('persists a preferred hosted display name without changing credentials', () => {
    const hostedConfig = makeHostedConfig({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      now: new Date('2026-08-27T00:00:00.000Z'),
    });

    const next = withHostedPreferredProfile(hostedConfig, ' work ', new Date('2026-08-27T01:00:00.000Z'));

    expect(next).toMatchObject({
      updatedAt: '2026-08-27T01:00:00.000Z',
      hosted: { apiBaseUrl: 'https://api.example.com', apiKey: 'key', preferredProfile: 'work' },
    });
  });

  it('uses explicit, environment, preferred, then Cloud default precedence', () => {
    const hostedConfig = makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' });
    const saved = withHostedPreferredProfile(hostedConfig, 'saved');

    expect(resolveHostedProfileSelection(saved, 'flag', { WEBCMD_PROFILE: 'env' })).toEqual({ name: 'flag', source: 'explicit' });
    expect(resolveHostedProfileSelection(saved, undefined, { WEBCMD_PROFILE: 'env' })).toEqual({ name: 'env', source: 'environment' });
    expect(resolveHostedProfileSelection(saved, undefined, {})).toEqual({ name: 'saved', source: 'preferred' });
    expect(resolveHostedProfileSelection(hostedConfig, undefined, {})).toBeUndefined();
  });

  it('writes local config and resolves default API URL from env', () => {
    expect(makeLocalConfig(new Date('2026-07-08T00:00:00.000Z'))).toEqual({
      mode: 'local',
      updatedAt: '2026-07-08T00:00:00.000Z',
      browser: { kind: 'cloak' },
    });
    expect(defaultHostedApiBaseUrl({ WEBCMD_CLOUD_API_URL: 'https://cloud.example.com/' } as NodeJS.ProcessEnv))
      .toBe('https://cloud.example.com');
  });

  it('round-trips each local browser choice', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-config-browser-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const updatedAt = '2026-08-31T00:00:00.000Z';

    for (const browser of [
      { kind: 'cloak' } as const,
      { kind: 'chrome', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } as const,
      { kind: 'slab' } as const,
      { kind: 'custom', executablePath: '/Applications/Chrome.app/Contents/MacOS/Google Chrome' } as const,
    ]) {
      saveWebcmdConfig({ mode: 'local', updatedAt, browser }, { env });
      expect(loadWebcmdConfig({ env })).toEqual({ mode: 'local', updatedAt, browser });
    }
  });

  it('defaults old or invalid local browser data to Cloak', () => {
    expect(loadWebcmdConfig({
      readFileSync: (() => '{"mode":"local","updatedAt":"2026-08-31T00:00:00.000Z"}') as never,
    })).toMatchObject({ mode: 'local', browser: { kind: 'cloak' } });

    for (const browser of [
      { kind: 'custom' },
      { kind: 'custom', executablePath: '' },
      { kind: 'custom', executablePath: 'relative/browser' },
      { kind: 'chrome' },
      { kind: 'chrome', executablePath: 'relative/browser' },
      { kind: 'other' },
    ]) {
      expect(loadWebcmdConfig({
        readFileSync: (() => JSON.stringify({ mode: 'local', updatedAt: '2026-08-31T00:00:00.000Z', browser })) as never,
      })).toMatchObject({ mode: 'local', browser: { kind: 'cloak' } });
    }
  });
});
