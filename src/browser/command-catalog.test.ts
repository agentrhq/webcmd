import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../cli.js';
import {
  BROWSER_AUTHORING_HELP_GROUP,
  BROWSER_SESSION_HELP_GROUP,
  browserCommandCatalog,
  browserHelpGroup,
  browserOptionFlags,
  browserOptionValueParser,
} from './command-catalog.js';

function browserCommand(): Command {
  const browser = createProgram('', '').commands.find(command => command.name() === 'browser');
  if (!browser) throw new Error('Local browser command is not registered');
  return browser;
}

describe('browserCommandCatalog', () => {
  it('exposes the raw browser session commands', () => {
    expect(browserCommandCatalog.map(command => command.command)).toEqual([
      'tabs',
      'init',
      'bind',
      'verify',
      'run',
      'snapshot',
      'close',
    ]);
  });

  it('does not expose the retired fork command', () => {
    expect(browserCommandCatalog.find(command => command.command === 'fork')).toBeUndefined();
  });

  it('keeps adapter authoring separate from the raw session catalog', () => {
    // Registration order drives help-group order, so the raw session surface the
    // namespace is named for comes first.
    expect(browserCommand().commands.map(command => command.name())).toEqual([
      'tabs',
      'bind',
      'run',
      'snapshot',
      'close',
      'init',
      'verify',
    ]);
  });

  it('exposes hosted adapter init and verify with the local verification flags', () => {
    const commands = new Map(browserCommandCatalog.map(command => [command.command, command]));
    expect(commands.get('init')).toMatchObject({ action: 'init', sessionPolicy: 'create-or-reuse' });
    expect(commands.get('verify')).toMatchObject({ action: 'verify', sessionPolicy: 'create-or-reuse' });
    expect(commands.get('verify')?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'noFixture' }),
      expect.objectContaining({ name: 'writeFixture' }),
      expect.objectContaining({ name: 'updateFixture' }),
      expect.objectContaining({ name: 'strictMemory' }),
      expect.objectContaining({ name: 'seedArgs' }),
      expect.objectContaining({ name: 'trace', default: 'off' }),
      expect.objectContaining({ name: 'maxTopLevelKeys', default: 12 }),
    ]));
    expect(browserOptionValueParser('verify', 'maxTopLevelKeys')?.('20')).toBe(20);
    expect(() => browserOptionValueParser('verify', 'maxTopLevelKeys')?.('0')).toThrow(/positive integer/);
    expect(() => browserOptionValueParser('verify', 'trace')?.('invalid')).toThrow(/off, on, retain-on-failure/);
  });

  it('requires a stable page id for bind and limits run to program options', () => {
    const commands = new Map(browserCommandCatalog.map(command => [command.command, command]));
    expect(commands.get('bind')?.options).toEqual([
      expect.objectContaining({ name: 'page', required: true }),
      expect.objectContaining({ name: 'verbose', type: 'boolean' }),
    ]);
    expect(commands.get('run')?.options.map(option => option.name)).toEqual([
      'stdin',
      'file',
      'timeout',
      'maxOutput',
      'snapshotMode',
      'noSnapshotDiff',
      'verbose',
    ]);
  });

  it('includes snapshot as the read-only browser inspection command', () => {
    const snapshot = browserCommandCatalog.find(command => command.command === 'snapshot');
    expect(snapshot).toMatchObject({ action: 'snapshot', sessionPolicy: 'require-existing' });
    expect(snapshot?.options.map(option => option.name)).toEqual(['snapshotMode', 'ref', 'maxOutput', 'verbose']);
  });

  // Verbose belongs to the bridge/CDP leaves only: the diagnostics behind it live
  // in the CDP client, so a filesystem-only leaf would be advertising a no-op (#174).
  it('exposes verbose on bridge leaves and withholds it from filesystem-only ones', () => {
    const optionNames = (name: string) => browserCommandCatalog
      .find(command => command.command === name)
      ?.options.map(option => option.name) ?? [];

    for (const leaf of ['tabs', 'bind', 'run', 'snapshot', 'close']) {
      expect(optionNames(leaf)).toContain('verbose');
    }
    for (const leaf of ['init', 'verify']) {
      expect(optionNames(leaf)).not.toContain('verbose');
    }
  });

  it('renders the verbose flag with its local short form', () => {
    const verbose = browserCommandCatalog
      .find(command => command.command === 'tabs')
      ?.options.find(option => option.name === 'verbose');

    expect(verbose).toBeDefined();
    expect(browserOptionFlags(verbose!, 'tabs')).toBe('-v, --verbose');
  });

  it('parses run snapshot mode as act or tree only', () => {
    expect(browserOptionValueParser('run', 'snapshotMode')?.('act')).toBe('act');
    expect(browserOptionValueParser('run', 'snapshotMode')?.('tree')).toBe('tree');
    expect(() => browserOptionValueParser('run', 'snapshotMode')?.('read')).toThrow(/act or tree/);
  });

  it('parses snapshot mode as act, tree, or read only', () => {
    const parse = browserOptionValueParser('snapshot', 'snapshotMode');
    expect(parse?.('act')).toBe('act');
    expect(parse?.('tree')).toBe('tree');
    expect(browserOptionValueParser('snapshot', 'snapshotMode')?.('read')).toBe('read');
    expect(() => parse?.('full')).toThrow('--snapshot-mode for snapshot must be act, tree, or read');
  });
});

describe('browser namespace help presentation', () => {
  it('groups every catalogued command as session control or adapter authoring', () => {
    const groups = new Map(browserCommandCatalog.map(command => [command.command, browserHelpGroup(command.command)]));

    expect([...groups].filter(([, group]) => group === BROWSER_SESSION_HELP_GROUP).map(([name]) => name))
      .toEqual(['tabs', 'bind', 'run', 'snapshot', 'close']);
    expect([...groups].filter(([, group]) => group === BROWSER_AUTHORING_HELP_GROUP).map(([name]) => name))
      .toEqual(['init', 'verify']);
  });

  it('leads with the raw session surface and drops the auto help entry', () => {
    const help = browserCommand().helpInformation();

    expect(help).toContain(BROWSER_SESSION_HELP_GROUP);
    expect(help).toContain(BROWSER_AUTHORING_HELP_GROUP);
    expect(help.indexOf(BROWSER_SESSION_HELP_GROUP)).toBeLessThan(help.indexOf(BROWSER_AUTHORING_HELP_GROUP));
    expect(help).not.toMatch(/^\s+help \[command\]/m);
  });

  it('does not register fork under browser; its local home is "webcmd adapter fork"', () => {
    const program = createProgram('', '');
    const browser = program.commands.find(command => command.name() === 'browser')!;
    const adapter = program.commands.find(command => command.name() === 'adapter')!;
    const override = adapter.commands.find(command => command.name() === 'override')!;

    expect(browser.commands.map(command => command.name())).not.toContain('fork');
    // The namespace summary the root help renders must not advertise it either.
    expect(browser.description()).toBe('bind, close, init, run, snapshot, tabs, verify');

    expect(override.aliases()).toContain('fork');
    expect(adapter.helpInformation()).toMatch(/^\s+override\|fork /m);
  });
});
