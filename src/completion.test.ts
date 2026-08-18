import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockGetRegistry } = vi.hoisted(() => ({
  mockGetRegistry: vi.fn(() => new Map([
    ['github/issues', {
      site: 'github',
      name: 'issues',
      aliases: ['issue-list'],
      description: 'List issues',
      access: 'read',
      strategy: 'public',
      browser: false,
      args: [],
      columns: [],
    }],
  ])),
}));

vi.mock('./registry.js', () => ({
  getRegistry: mockGetRegistry,
}));

import { getCompletions } from './completion.js';
import { getCompletionsFromManifest } from './completion-fast.js';

const tempDirs: string[] = [];

function installFixturePlugin(home: string): void {
  const pluginDir = path.join(home, '.webcmd', 'plugins', 'fixture');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'show.js'), `
import { cli, Strategy } from '@agentrhq/webcmd/registry';

cli({
  site: 'fixture',
  name: 'show',
  description: 'Show an opaque identifier',
  access: 'read',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [{ name: 'id', positional: true, required: true, help: 'Opaque identifier' }],
  columns: ['id'],
  func: async ({ id }) => [{ id }],
});
`);
}

function createFixtureHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-plugin-completion-'));
  tempDirs.push(home);
  installFixturePlugin(home);
  return home;
}

function runFixtureCli(home: string, args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'src/main.ts'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CI: '1' },
  });
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('getCompletions', () => {
  it('includes top-level built-ins that are registered outside the site registry', () => {
    const completions = getCompletions([], 1);

    expect(completions).toContain('plugin');
    expect(completions).toContain('external');
    expect(completions).not.toContain('install');
    expect(completions).not.toContain('register');
    expect(completions).not.toContain('setup');
  });

  it('still includes discovered site names', () => {
    const completions = getCompletions([], 1);

    expect(completions).toContain('github');
  });

  it('returns byte-identical candidates from registry and manifest metadata', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-completion-parity-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'cli-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify([
      { site: 'github', name: 'issues', aliases: ['issue-list'] },
    ]));

    expect(getCompletionsFromManifest([], 1, [manifestPath])).toEqual(getCompletions([], 1));
    expect(getCompletionsFromManifest(['github'], 2, [manifestPath])).toEqual(getCompletions(['github'], 2));
  });

  it('uses installed plugin metadata for completion and dash-leading positionals', () => {
    const rootCompletion = runFixtureCli(createFixtureHome(), ['--get-completions', '--cursor', '1']);
    const commandCompletion = runFixtureCli(createFixtureHome(), ['--get-completions', 'fixture', '--cursor', '2']);
    const execution = runFixtureCli(createFixtureHome(), ['fixture', 'show', '-opaque']);

    expect(rootCompletion.status, rootCompletion.stderr).toBe(0);
    expect(rootCompletion.stdout.split(/\r?\n/)).toContain('fixture');
    expect(commandCompletion.status, commandCompletion.stderr).toBe(0);
    expect(commandCompletion.stdout.split(/\r?\n/)).toContain('show');
    expect(execution.status, execution.stderr).toBe(0);
    expect(execution.stdout).toContain('"id": "-opaque"');
  }, 20_000);
});
