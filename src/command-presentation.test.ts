import { describe, expect, it } from 'vitest';
import { Strategy, type CliCommand } from './registry.js';
import {
  commandHelpData,
  commandListPresentation,
  commandListRows,
  filterCommandsByTag,
  formatCommandHelp,
  formatRootHelp,
  formatSiteHelp,
  getCommandCompletionCandidates,
  ROOT_HELP_BANNER,
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

    expect(formatRootHelp(hosted, { color: false })).toBe(formatRootHelp(local, { color: false }));
  });

  it('groups root commands, shows the banner, and keeps dynamic adapter lists', () => {
    const help = formatRootHelp({
      description: 'Make any website your CLI. Zero setup. AI-powered.',
      usage: ['webcmd [options] [command]'],
      commands: [
        { name: 'list', description: 'List all available CLI commands' },
        { name: 'site', description: 'Read and write per-site memory' },
        { name: 'browser', description: 'Browser control' },
        { name: 'session', description: 'Create, list, and close browser Sessions' },
        { name: 'profile', description: 'Manage browser profiles' },
        { name: 'auth', description: 'Inspect authentication status' },
        { name: 'daemon', description: 'Manage the local Webcmd daemon' },
        { name: 'doctor', description: 'Diagnose readiness' },
        { name: 'update', description: 'Update the CLI' },
        { name: 'skills', description: 'Manage bundled skills' },
        { name: 'plugin', description: 'Manage plugins' },
        { name: 'adapter', description: 'Manage adapters' },
        { name: 'external', description: 'Manage external CLIs' },
        { name: 'validate', description: 'Validate definitions' },
        { name: 'verify', description: 'Smoke-test adapters' },
        { name: 'convention-audit', description: 'Audit conventions' },
        { name: 'completion <shell>', description: 'Output a shell completion script' },
        { name: 'setup', description: 'Configure local or hosted mode' },
      ],
      options: [
        { flags: '-V, --version', description: 'Output the version number' },
        { flags: '--profile <name>', description: 'Browser profile/context alias' },
        { flags: '--session <session-id>', description: 'Existing readable Session ID' },
        { flags: '-h, --help', description: 'Display help for command' },
      ],
      groups: [
        { label: 'SITES (2)', items: ['github', 'youtube'] },
        { label: 'EXTERNAL CLIs (1)', items: ['gh'] },
      ],
    }, { color: false, columns: 80 });

    expect(help).toContain(ROOT_HELP_BANNER);
    expect(help).toContain('CORE');
    expect(help).toContain('BROWSER');
    expect(help).toContain('SYSTEM');
    expect(help).toContain('EXTENSIONS');
    expect(help).toContain('DEVELOPMENT');
    expect(help).toContain('COMPLETION');
    expect(help).toContain('GLOBAL OPTIONS');
    expect(help).toContain('EXTERNAL CLIs (1)');
    expect(help).toContain('SITES (2)');
    expect(help).toContain('EXAMPLES');
    expect(help).toContain('AGENTS');
    expect(help.indexOf('CORE')).toBeLessThan(help.indexOf('BROWSER'));
    expect(help.indexOf('BROWSER')).toBeLessThan(help.indexOf('SYSTEM'));
    expect(help.indexOf('GLOBAL OPTIONS')).toBeLessThan(help.indexOf('SITES (2)'));
    expect(help.indexOf('SITES (2)')).toBeLessThan(help.indexOf('EXTERNAL CLIs (1)'));
    expect(help.indexOf('EXTERNAL CLIs (1)')).toBeLessThan(help.indexOf('EXAMPLES'));
    expect(help).not.toMatch(/\u001b\[/);
  });

  it('puts a visible Hangul-filler spacer between the banner and the tagline', () => {
    const description = 'Make any website your CLI. Zero setup. AI-powered.';
    const help = formatRootHelp({
      description,
      commands: [{ name: 'list', description: 'List all available CLI commands' }],
      options: [{ flags: '-h, --help', description: 'Display help for command' }],
    }, { color: false });

    expect(help.startsWith(`${ROOT_HELP_BANNER}\nㅤ\n  ${description}\n`)).toBe(true);
  });

  it('colors only CMD in the banner accent and leaves WEB white', () => {
    const help = formatRootHelp({
      description: 'Make any website your CLI. Zero setup. AI-powered.',
      commands: [{ name: 'list', description: 'List all available CLI commands' }],
      options: [{ flags: '-h, --help', description: 'Display help for command' }],
    }, { color: true });

    expect(help).toContain('\u001b[97m██╗    ██╗███████╗██████╗  \u001b[0m');
    expect(help).toContain('\u001b[38;2;86;197;255m██████╗███╗   ███╗██████╗\u001b[0m');
    expect(help).not.toMatch(/\u001b\[38;2;86;197;255m██╗    ██╗/);
  });

  it('degrades ANSI color cleanly when color is disabled', () => {
    const presentation: RootHelpPresentation = {
      description: 'Make any website your CLI. Zero setup. AI-powered.',
      commands: [{ name: 'list', description: 'List all available CLI commands' }],
      options: [{ flags: '-h, --help', description: 'Display help for command' }],
    };
    const plain = formatRootHelp(presentation, { color: false });
    const colored = formatRootHelp(presentation, { color: true });

    expect(plain).not.toMatch(/\u001b\[/);
    expect(colored).toMatch(/\u001b\[/);
    expect(colored.replace(/\u001b\[[0-9;]*m/g, '')).toBe(plain);
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

describe('help for a command that shadows a shared flag', () => {
  const shadowing = toPresentableCommand({
    site: 'demo',
    name: 'snapshot',
    access: 'read',
    description: 'Snapshot a thread',
    browser: false,
    args: [{ name: 'json', type: 'bool', default: false, help: 'Return only the snapshot string' }],
  });

  it('lists the shadowed flag once, with the adapter’s meaning', () => {
    const help = formatCommandHelp(shadowing);
    expect(help).toContain('Return only the snapshot string');
    // Advertising the alias would name a flag that is no longer registered.
    expect(help).not.toContain('Alias of --format json');
  });

  it('still lists the other shared options', () => {
    const help = formatCommandHelp(shadowing);
    expect(help).toContain('Common options:');
    expect(help).toContain('-f, --format <fmt>');
  });

  it('omits the shadowed flag from structured help too', () => {
    const data = commandHelpData(shadowing) as { common_options: Array<{ name: string }> };
    expect(data.common_options.map((option) => option.name)).not.toContain('json');
    expect(data.common_options.map((option) => option.name)).toContain('format');
  });

  it('leaves a command that shadows nothing unchanged', () => {
    const plain = toPresentableCommand({
      site: 'demo', name: 'search', access: 'read', description: 'Search',
      browser: false, args: [{ name: 'limit', type: 'int', default: 10 }],
    });
    expect(formatCommandHelp(plain)).toContain('Alias of --format json');
  });
});
