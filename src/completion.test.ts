import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
});
