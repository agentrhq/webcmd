import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ENV_PREFIX } from '../brand.js';
import { profileRouteParams, resolveProfileSelection } from './profile.js';

describe('profile selection', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-profile-test-'));
    vi.stubEnv(`${ENV_PREFIX}_CONFIG_DIR`, configDir);
    vi.stubEnv(`${ENV_PREFIX}_PROFILE`, '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function writeConfig(config: object): void {
    fs.writeFileSync(path.join(configDir, 'browser-profiles.json'), JSON.stringify(config));
  }

  it('tags an explicit profile argument as explicit and resolves aliases', () => {
    writeConfig({ version: 1, aliases: { work: 'profile-work' } });
    expect(resolveProfileSelection('work')).toEqual({ contextId: 'profile-work', source: 'explicit' });
  });

  it('tags WEBCMD_PROFILE as explicit', () => {
    vi.stubEnv(`${ENV_PREFIX}_PROFILE`, 'profile-env');
    expect(resolveProfileSelection()).toEqual({ contextId: 'profile-env', source: 'explicit' });
  });

  it('tags the persisted config default as preferred', () => {
    writeConfig({ version: 1, aliases: {}, defaultContextId: 'profile-default' });
    expect(resolveProfileSelection()).toEqual({ contextId: 'profile-default', source: 'preferred' });
  });

  it('explicit argument beats env, and env beats config default', () => {
    vi.stubEnv(`${ENV_PREFIX}_PROFILE`, 'from-env');
    writeConfig({ version: 1, aliases: {}, defaultContextId: 'from-config' });
    expect(resolveProfileSelection('from-arg')).toEqual({ contextId: 'from-arg', source: 'explicit' });
    expect(resolveProfileSelection()).toEqual({ contextId: 'from-env', source: 'explicit' });
  });

  it('maps explicit routes to contextId and preferred routes to preferredContextId', () => {
    expect(profileRouteParams({ contextId: 'a', source: 'explicit' })).toEqual({ contextId: 'a' });
    expect(profileRouteParams({ contextId: 'b', source: 'preferred' })).toEqual({ preferredContextId: 'b' });
    expect(profileRouteParams(undefined)).toEqual({});
  });
});
