import { describe, expect, it } from 'vitest';
import {
  commandNamesForSite,
  findHostedCommand,
  hostedListRows,
  renderHostedCommandHelp,
  renderHostedSiteHelp,
  siteNames,
} from './manifest.js';
import type { HostedManifest } from './types.js';

const manifest: HostedManifest = {
  userId: 'user_demo',
  generatedAt: '2026-07-08T00:00:00.000Z',
  commands: [
    {
      site: 'github',
      name: 'whoami',
      aliases: ['me'],
      command: 'github/whoami',
      description: 'Show GitHub identity',
      access: 'read',
      strategy: 'COOKIE',
      browser: true,
      args: [],
      columns: ['username'],
      domain: 'github.com',
    },
    {
      site: 'docker',
      name: 'ps',
      command: 'docker/ps',
      description: 'Local Docker containers',
      access: 'read',
      strategy: 'LOCAL',
      browser: false,
      args: [],
    },
  ],
};

describe('hosted manifest helpers', () => {
  it('filters LOCAL commands from hosted list rows', () => {
    expect(hostedListRows(manifest, true).map((row) => row.command)).toEqual(['github/whoami']);
  });

  it('finds canonical commands and aliases', () => {
    expect(findHostedCommand(manifest, 'github', 'whoami')?.command).toBe('github/whoami');
    expect(findHostedCommand(manifest, 'github', 'me')?.command).toBe('github/whoami');
  });

  it('renders hosted help and completion names from supported commands', () => {
    expect(siteNames(manifest)).toEqual(['github']);
    expect(commandNamesForSite(manifest, 'github')).toEqual(['me', 'whoami']);
    expect(renderHostedSiteHelp(manifest, 'github')).toContain('whoami');
    expect(renderHostedCommandHelp(manifest.commands[0]!)).toContain('Output columns: username');
  });
});
