import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('postinstall', () => {
  it('installs only core completion files and prints explicit plugin guidance', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-postinstall-'));
    roots.push(home);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SHELL: '/bin/zsh',
      npm_config_global: 'true',
    };
    delete env.CI;
    delete env.CONTINUOUS_INTEGRATION;

    const result = spawnSync(process.execPath, ['scripts/postinstall.js'], { env, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(home, '.zsh', 'completions', '_webcmd'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.webcmd', 'spotify.env'))).toBe(false);
    expect(result.stdout).toContain('webcmd plugin search <site> -f json');
    expect(result.stdout).toContain('webcmd plugin install <installSource-from-search>');
    expect(result.stdout).not.toMatch(/spotify|youtube|reddit|twitter/i);
  });

  it('does not block without a TTY and points local setup to SLAB onboarding', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-postinstall-slab-'));
    roots.push(home);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SHELL: '/bin/zsh',
      npm_config_global: 'true',
    };
    delete env.CI;
    delete env.CONTINUOUS_INTEGRATION;

    const result = spawnSync(process.execPath, ['scripts/postinstall.js'], { env, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SLAB browser is required for local webcmd commands. Run `webcmd setup` to install it.');
  });
});
