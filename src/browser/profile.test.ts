import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ENV_PREFIX } from '../brand.js';
import { ArgumentError } from '../errors.js';
import { createProfile, loadProfileConfig, profileListRows, profileRouteParams, resolveProfileSelection, setDefaultProfile } from './profile.js';

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

describe('profileListRows', () => {
  const config = {
    aliases: { work: 'ctx-work', sales: 'ctx-sales' },
    defaultContextId: 'ctx-default',
  } as never;

  it('marks connected profiles and carries their alias, default flag, and version', () => {
    const rows = profileListRows(config, [
      { contextId: 'ctx-work', runtimeVersion: '1.2.3' },
      { contextId: 'ctx-default' },
    ]);
    expect(rows).toEqual([
      { contextId: 'ctx-work', alias: 'work', default: false, connected: true, runtimeVersion: '1.2.3' },
      { contextId: 'ctx-default', alias: '', default: true, connected: true, runtimeVersion: '' },
      { contextId: 'ctx-sales', alias: 'sales', default: false, connected: false, runtimeVersion: '' },
    ]);
  });

  it('includes saved profiles that are not currently connected', () => {
    const rows = profileListRows(config, [{ contextId: 'ctx-work' }]);
    expect(rows.map((row) => [row.contextId, row.connected])).toEqual([
      ['ctx-work', true],
      ['ctx-sales', false],
      ['ctx-default', false],
    ]);
  });

  it('reports every saved profile when the runtime shows none', () => {
    // Regression guard: structured output that hides disconnected profiles reads as
    // "only the default exists", which sends callers hunting through internal state.
    const rows = profileListRows(config, []);
    expect(rows.map((row) => row.contextId).sort()).toEqual(['ctx-default', 'ctx-sales', 'ctx-work']);
    expect(rows.every((row) => row.connected === false)).toBe(true);
  });

  it('does not duplicate a default that is also a saved alias', () => {
    const rows = profileListRows(
      { aliases: { work: 'ctx-work' }, defaultContextId: 'ctx-work' } as never,
      [],
    );
    expect(rows).toEqual([
      { contextId: 'ctx-work', alias: 'work', default: true, connected: false, runtimeVersion: '' },
    ]);
  });
});

describe('createProfile', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-profile-create-'));
    vi.stubEnv(`${ENV_PREFIX}_CONFIG_DIR`, configDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('creates an alias and is idempotent', () => {
    expect(createProfile('eval-a')).toEqual({ contextId: 'eval-a', alias: 'eval-a', created: true });
    expect(createProfile('eval-a')).toEqual({ contextId: 'eval-a', alias: 'eval-a', created: false });
    expect(loadProfileConfig().aliases['eval-a']).toBe('eval-a');
    expect(fs.existsSync(path.join(configDir, 'cloak', 'profiles', 'eval-a'))).toBe(true);
  });

  it('rejects an invalid alias', () => {
    expect(() => createProfile('../nope')).toThrow(ArgumentError);
  });
});

describe('setDefaultProfile membership', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-profile-use-'));
    vi.stubEnv(`${ENV_PREFIX}_CONFIG_DIR`, configDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  const rows = profileListRows(
    { version: 1, aliases: { work: 'ctx-work' }, defaultContextId: 'ctx-default' },
    [{ contextId: 'ctx-live', runtimeVersion: '1.0.3' }],
  );

  it('sets the default from a connected contextId', () => {
    const config = setDefaultProfile('ctx-live', rows);
    expect(config.defaultContextId).toBe('ctx-live');
    expect(loadProfileConfig().defaultContextId).toBe('ctx-live');
  });

  it('sets the default from a saved alias and stores the contextId', () => {
    expect(setDefaultProfile('work', rows).defaultContextId).toBe('ctx-work');
  });

  it('rejects an unknown name and enumerates valid profiles', () => {
    try {
      setDefaultProfile('__audit_nope__', rows);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ArgumentError);
      expect((err as ArgumentError).exitCode).toBe(2);
      expect((err as ArgumentError).message).toBe(
        'No profile matches "__audit_nope__". Valid profiles: work, ctx-live, ctx-work, ctx-default',
      );
      expect((err as ArgumentError).hint).toBe(
        'usage: webcmd profile use <alias|contextId>\nexample: webcmd profile use work',
      );
    }
  });

  it('rejects an unknown name when no profiles exist', () => {
    expect(() => setDefaultProfile('__audit_nope__', [])).toThrow(ArgumentError);
    try {
      setDefaultProfile('__audit_nope__', []);
    } catch (err) {
      expect((err as ArgumentError).message).toBe(
        'No profile matches "__audit_nope__". No Cloak profiles are available.',
      );
      expect((err as ArgumentError).hint).toContain('webcmd profile list');
    }
  });
});
