import { describe, expect, it } from 'vitest';
import { Strategy, type CliCommand } from './registry.js';
import {
  commandListPresentation,
  commandListRows,
  filterCommandsByTag,
  formatCommandHelp,
  formatRootHelp,
  formatSiteHelp,
  getCommandCompletionCandidates,
  toPresentableCommand,
  type RootHelpPresentation,
} from './command-presentation.js';
import type { HostedCommand } from './hosted/types.js';

const args = [
  { name: 'owner', positional: true, required: true, help: 'Repository owner' },
  { name: 'limit', type: 'int', default: 20, help: 'Maximum issues' },
] as const;

const localCommand = {
  site: 'github',
  name: 'issues',
  aliases: ['issue-list'],
  description: 'List repository issues',
  access: 'read',
  strategy: Strategy.COOKIE,
  browser: true,
  args: args.map((arg) => ({ ...arg })),
  columns: ['number', 'title'],
  domain: 'github.com',
  defaultFormat: 'yaml',
} satisfies CliCommand;

const hostedCommand = {
  site: 'github',
  name: 'issues',
  aliases: ['issue-list'],
  command: 'github/issues',
  description: 'List repository issues',
  access: 'read',
  strategy: 'COOKIE',
  browser: true,
  args: args.map((arg) => ({ ...arg })),
  columns: ['number', 'title'],
  domain: 'github.com',
  defaultFormat: 'yaml',
} satisfies HostedCommand;

describe('shared command presentation', () => {
  it('filters commands by one exact case-insensitive tag', () => {
    const commands = [
      { name: 'a', tags: ['search'] },
      { name: 'b', tags: ['write'] },
    ];

    expect(filterCommandsByTag(commands, 'SEARCH').map((command) => command.name)).toEqual(['a']);
    expect(filterCommandsByTag(commands)).toEqual(commands);
    expect(filterCommandsByTag(commands, 'searches')).toEqual([]);
  });

  it('renders byte-identical root help for equal local and hosted surfaces', () => {
    const local: RootHelpPresentation = {
      description: 'Make any website your CLI. Zero setup. AI-powered.',
      commands: [
        { name: 'list', description: 'List all available CLI commands' },
        { name: 'setup', description: 'Configure local or hosted mode' },
      ],
      options: [
        { flags: '--profile <name>', description: 'Browser profile/context alias' },
        { flags: '-h, --help', description: 'Display help for command' },
      ],
    };
    const hosted: RootHelpPresentation = JSON.parse(JSON.stringify(local)) as RootHelpPresentation;

    expect(formatRootHelp(hosted)).toBe(formatRootHelp(local));
  });

  it('normalizes local and hosted metadata to byte-identical site and command help', () => {
    const local = toPresentableCommand(localCommand);
    const hosted = toPresentableCommand(hostedCommand);

    expect(formatSiteHelp('github', [hosted])).toBe(formatSiteHelp('github', [local]));
    expect(formatCommandHelp(hosted)).toBe(formatCommandHelp(local));
  });

  it('states the background default in adapter browser help', () => {
    expect(formatCommandHelp(toPresentableCommand(localCommand))).toContain(
      'Browser window mode: foreground or background (default: background)',
    );
  });

  it('builds byte-identical structured and display list rows', () => {
    const local = toPresentableCommand(localCommand);
    const hosted = toPresentableCommand(hostedCommand);

    expect(commandListRows([hosted], true)).toEqual(commandListRows([local], true));
    expect(commandListRows([hosted], false)).toEqual(commandListRows([local], false));
  });

  it('preserves independent search metadata in presentable structured rows', () => {
    const tags = ['search'];
    const keywords = ['lookup', 'discovery'];
    const presentable = toPresentableCommand({ ...localCommand, tags, keywords });
    tags.push('changed');
    keywords.push('changed');
    const [row] = commandListRows([presentable], true);

    expect(presentable.tags).toEqual(['search']);
    expect(presentable.keywords).toEqual(['lookup', 'discovery']);
    expect(row).toMatchObject({ tags: ['search'], keywords: ['lookup', 'discovery'] });
    expect(row.tags).not.toBe(presentable.tags);
    expect(row.keywords).not.toBe(presentable.keywords);
  });

  it('builds byte-identical canonical grouped list displays', () => {
    const local = toPresentableCommand(localCommand);
    const hosted = toPresentableCommand(hostedCommand);
    const externalClis = [{ label: 'gh', installed: true, description: 'GitHub CLI' }];
    const expected = [
      '',
      '  webcmd — available commands',
      '',
      '  Site adapters',
      '',
      '  github',
      '    issues [cookie] (aliases: issue-list) — List repository issues',
      '',
      '  external CLIs',
      '    gh [installed] — GitHub CLI',
      '',
      '  1 built-in commands across 0 apps + 1 sites, 1 external CLIs',
      '',
    ];

    expect(commandListPresentation([hosted], 'table', { externalClis }).displayLines)
      .toEqual(commandListPresentation([local], 'table', { externalClis }).displayLines);
    expect(commandListPresentation([local], 'table', { externalClis }).displayLines).toEqual(expected);
  });

  it('hints at plugin search/install when no site plugins are registered', () => {
    const { displayLines } = commandListPresentation([], 'table', { externalClis: [] });

    expect(displayLines).toContain(
      "  No site plugins installed. Find one with 'webcmd plugin search <site>'"
      + " and install it with 'webcmd plugin install <installSource>'.",
    );
  });

  it('omits the plugin hint once at least one site is registered', () => {
    const local = toPresentableCommand(localCommand);
    const { displayLines } = commandListPresentation([local], 'table', { externalClis: [] });

    expect(displayLines?.some((line) => line.includes('No site plugins installed'))).toBe(false);
  });

  it('builds byte-identical root, site, and alias completion candidates', () => {
    const local = [toPresentableCommand(localCommand)];
    const hosted = [toPresentableCommand(hostedCommand)];
    const builtins = ['completion', 'list', 'setup'];

    expect(getCommandCompletionCandidates(hosted, [], 1, builtins))
      .toEqual(getCommandCompletionCandidates(local, [], 1, builtins));
    expect(getCommandCompletionCandidates(hosted, ['github'], 2, builtins))
      .toEqual(getCommandCompletionCandidates(local, ['github'], 2, builtins));
    expect(getCommandCompletionCandidates(hosted, ['github'], 2, builtins))
      .toEqual(['issue-list', 'issues']);
  });
});
