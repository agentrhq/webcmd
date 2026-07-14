import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _isMacOsKeychainAvailableForTest,
  getHostedCredentialPath,
  resolveHostedApiKey,
  storeHostedApiKey,
  type HostedCredentialStore,
} from './credentials.js';
import { getConfigPath, makeHostedConfig, saveWebcmdConfig } from './config.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('hosted credential storage', () => {
  it('honors process-level file credential backend when no explicit env is injected', () => {
    const previous = process.env.WEBCMD_CREDENTIAL_BACKEND;
    process.env.WEBCMD_CREDENTIAL_BACKEND = 'file';
    try {
      expect(_isMacOsKeychainAvailableForTest({
        platform: 'darwin',
        existsSync: () => true,
      })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.WEBCMD_CREDENTIAL_BACKEND;
      else process.env.WEBCMD_CREDENTIAL_BACKEND = previous;
    }
  });

  it('stores hosted API keys in the protected file fallback', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-creds-'));
    const env = {
      WEBCMD_CONFIG_DIR: tempDir,
      WEBCMD_CREDENTIAL_BACKEND: 'file',
    } as NodeJS.ProcessEnv;

    const stored = await storeHostedApiKey('wcmd_live_test', {
      env,
      platform: 'linux',
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    });

    expect(stored).toEqual({
      apiKeyRef: 'wcmd_cred_11111111-2222-4333-8444-555555555555',
      credentialBackend: 'file-fallback',
    });
    const credentialFile = JSON.parse(await readFile(getHostedCredentialPath({ env }), 'utf8'));
    expect(credentialFile.credentials[stored.apiKeyRef]).toBe('wcmd_live_test');
    expect((await stat(getHostedCredentialPath({ env }))).mode & 0o777).toBe(0o600);
  });

  it('uses an injected OS credential store when available', async () => {
    const secrets = new Map<string, string>();
    const credentialStore: HostedCredentialStore = {
      backend: () => 'os',
      put: vi.fn(async (reference, secret) => { secrets.set(reference, secret); }),
      get: vi.fn(async (reference) => secrets.get(reference) ?? null),
      delete: vi.fn(async (reference) => { secrets.delete(reference); }),
    };

    const stored = await storeHostedApiKey('wcmd_keychain_test', {
      credentialStore,
      randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });

    expect(stored).toEqual({
      apiKeyRef: 'wcmd_cred_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      credentialBackend: 'os',
    });
    expect(await credentialStore.get(stored.apiKeyRef)).toBe('wcmd_keychain_test');
  });

  it('migrates a legacy inline key to a credential reference without keeping the secret in config', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-creds-migrate-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const legacy = makeHostedConfig({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'wcmd_legacy_key',
      now: new Date('2026-07-08T00:00:00.000Z'),
    });
    saveWebcmdConfig(legacy, { env });

    const resolved = await resolveHostedApiKey(legacy, {
      env,
      platform: 'linux',
      randomUUID: () => 'bbbbbbbb-2222-4333-8444-555555555555',
    });

    expect(resolved).toMatchObject({
      apiKey: 'wcmd_legacy_key',
      backend: 'file-fallback',
      migrated: true,
    });
    const configJson = await readFile(getConfigPath({ env }), 'utf8');
    expect(configJson).toContain('wcmd_cred_bbbbbbbb-2222-4333-8444-555555555555');
    expect(configJson).not.toContain('wcmd_legacy_key');
  });
});
