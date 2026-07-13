import { mkdtemp, rm } from 'node:fs/promises';
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
  saveWebcmdConfig,
} from './config.js';

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

  it('writes local config and resolves default API URL from env', () => {
    expect(makeLocalConfig(new Date('2026-07-08T00:00:00.000Z'))).toEqual({
      mode: 'local',
      updatedAt: '2026-07-08T00:00:00.000Z',
    });
    expect(defaultHostedApiBaseUrl({ WEBCMD_CLOUD_API_URL: 'https://cloud.example.com/' } as NodeJS.ProcessEnv))
      .toBe('https://cloud.example.com');
  });
});
