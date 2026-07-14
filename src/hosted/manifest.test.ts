import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  commandHelpData,
  formatCommandHelpText,
  formatSiteHelpText,
  renderStructuredHelp,
  siteHelpData,
} from '../help.js';
import { serializeCommand } from '../serialization.js';
import { Strategy, type CliCommand } from '../registry.js';
import {
  commandNamesForSite,
  findHostedCommand,
  hostedListRows,
  renderHostedCommandHelp,
  renderHostedSiteHelp,
  siteNames,
} from './manifest.js';
import type { HostedManifest } from './types.js';
import { makeHostedConfig } from './config.js';
import { runHostedCli } from './runner.js';
import { formatRootHelp } from '../command-presentation.js';
import { HOSTED_ROOT_HELP } from '../completion-shared.js';

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

const equivalentLocalCommand: CliCommand = {
  site: 'github',
  name: 'whoami',
  aliases: ['me'],
  description: 'Show GitHub identity',
  access: 'read',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['username'],
  domain: 'github.com',
};

function sink(): { stream: Writable; text: () => string } {
  let data = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        data += String(chunk);
        callback();
      },
    }),
    text: () => data,
  };
}

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

  it('matches local site and command help byte-for-byte for equal metadata', () => {
    expect(renderHostedSiteHelp(manifest, 'github')).toBe(formatSiteHelpText('github', [equivalentLocalCommand]));
    expect(renderHostedCommandHelp(manifest.commands[0]!)).toBe(formatCommandHelpText(equivalentLocalCommand));
  });

  it('matches local structured list rows for equal metadata', () => {
    expect(hostedListRows({ ...manifest, commands: [manifest.commands[0]!] }, true))
      .toEqual([serializeCommand(equivalentLocalCommand)]);
  });

  it('describes universal hosted surfaces and accepted local-only commands at the root', async () => {
    const stdout = sink();
    const result = await runHostedCli(['--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toBe(formatRootHelp(HOSTED_ROOT_HELP));
    expect(stdout.text()).toContain('completion');
    expect(stdout.text()).toContain('--profile <name>');
    expect(stdout.text()).toContain('Local-only commands:');
    expect(stdout.text()).toContain('Run `webcmd setup` and choose local mode to use local-only commands.');
  });

  it('completes private hosted manifest commands without local discovery', async () => {
    const stdout = sink();
    const privateManifest = {
      ...manifest,
      commands: [
        ...manifest.commands,
        {
          site: 'private-tools',
          name: 'deploy-preview',
          aliases: ['preview'],
          command: 'private-tools/deploy-preview',
          description: 'Deploy a private preview',
          access: 'write',
          strategy: 'PUBLIC',
          browser: false,
          args: [],
          columns: ['url'],
        },
      ],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, manifest: privateManifest }), { status: 200 }));

    const result = await runHostedCli(['--get-completions', '--cursor', '2', 'private-tools'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text().trim().split('\n')).toEqual(['deploy-preview', 'preview']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['json', 'json'],
    ['yaml', 'yaml'],
    ['yml', 'yaml'],
  ] as const)('matches local structured site and command help bytes for -f %s', async (requested, rendered) => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: true, manifest }), { status: 200 });

    const siteStdout = sink();
    await runHostedCli(['github', '--help', '-f', requested], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: siteStdout.stream,
      fetchImpl,
    });
    expect(siteStdout.text()).toBe(renderStructuredHelp(
      siteHelpData('github', [equivalentLocalCommand]),
      rendered,
    ));

    const commandStdout = sink();
    await runHostedCli(['github', 'whoami', '--help', '-f', requested], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: commandStdout.stream,
      fetchImpl,
    });
    expect(commandStdout.text()).toBe(renderStructuredHelp(
      commandHelpData(equivalentLocalCommand),
      rendered,
    ));
  });

  it('uses only executable hosted root capabilities as root completion candidates', async () => {
    const stdout = sink();
    await runHostedCli(['--get-completions', '--cursor', '1'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, manifest }), { status: 200 }),
    });

    expect(stdout.text().trim().split('\n')).toEqual(['browser', 'completion', 'github', 'list', 'setup']);
  });
});
