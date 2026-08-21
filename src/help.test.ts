import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  classifyAdapter,
  commandHelpData,
  formatCommandHelpText,
  formatRootAdapterHelpText,
  formatSiteHelpText,
  getRequestedHelpFormat,
  hideAutoHelpCommands,
  siteHelpData,
  visibleChildCommands,
} from './help.js';
import {
  commandHelpData as sharedCommandHelpData,
  formatCommandHelp,
  formatSiteHelp,
  siteHelpData as sharedSiteHelpData,
  toPresentableCommand,
} from './command-presentation.js';
import { Strategy, type CliCommand } from './registry.js';

const presentableFixture: CliCommand = {
  site: 'github',
  name: 'issues',
  aliases: ['issue-list'],
  description: 'List repository issues',
  access: 'read',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [{ name: 'owner', positional: true, required: true, help: 'Repository owner' }],
  columns: ['number', 'title'],
  domain: 'github.com',
};

describe('classifyAdapter', () => {
  it('classifies DNS-style domains as site', () => {
    expect(classifyAdapter('www.youtube.com')).toBe('site');
    expect(classifyAdapter('chatgpt.com')).toBe('site');
    expect(classifyAdapter('claude.ai')).toBe('site');
    expect(classifyAdapter('grok.com')).toBe('site');
  });

  it('classifies localhost as app (Electron / osascript desktop integrations)', () => {
    expect(classifyAdapter('localhost')).toBe('app');
  });

  it('classifies non-DNS domain strings as app (e.g. literal "custom-app")', () => {
    expect(classifyAdapter('custom-app')).toBe('app');
  });

  it('defaults missing domain to site (most adapters without explicit domain are public web scrapers)', () => {
    expect(classifyAdapter(undefined)).toBe('site');
  });

  it('classifies local IPv4 addresses (127.x.x.x) as app, with or without port', () => {
    expect(classifyAdapter('127.0.0.1')).toBe('app');
    expect(classifyAdapter('127.0.0.1:3000')).toBe('app');
    expect(classifyAdapter('127.0.0.1:8080')).toBe('app');
  });

  it('classifies dotted domains as site even if they resemble IPs when not 127.x.x.x', () => {
    expect(classifyAdapter('news.ycombinator.com')).toBe('site');
    expect(classifyAdapter('192.168.1.1')).toBe('site');
  });
});

it('lets explicit --format win over --json in structured help', () => {
  expect(getRequestedHelpFormat(['webcmd', '--help', '--format', 'yaml', '--json'])).toBe('yaml');
});

describe('formatRootAdapterHelpText', () => {
  it('renders all three sections in External / App / Site order when populated', () => {
    const text = formatRootAdapterHelpText({
      external: [
        { name: 'gh', label: 'gh' },
        { name: 'vercel', label: 'vercel' },
      ],
      apps: ['chatwise', 'codex'],
      sites: ['youtube'],
    });
    expect(text).toContain('External CLIs (2):');
    expect(text).toContain('App adapters (2):');
    expect(text).toContain('Site adapters (1):');
    expect(text).toContain('vercel');
    expect(text.indexOf('External CLIs')).toBeLessThan(text.indexOf('App adapters'));
    expect(text.indexOf('App adapters')).toBeLessThan(text.indexOf('Site adapters'));
  });

  it('omits empty sections instead of rendering a (0) header', () => {
    const text = formatRootAdapterHelpText({
      external: [],
      apps: [],
      sites: ['youtube'],
    });
    expect(text).not.toContain('External CLIs');
    expect(text).not.toContain('App adapters');
    expect(text).toContain('Site adapters (1):');
  });

  it('returns empty string when all groups are empty', () => {
    expect(formatRootAdapterHelpText({ external: [], apps: [], sites: [] })).toBe('');
  });

  it('always renders the agent discovery hint when any section is populated', () => {
    const text = formatRootAdapterHelpText({
      external: [],
      apps: [],
      sites: ['youtube'],
    });
    expect(text).toContain("'webcmd <site> --help -f yaml'");
  });
});

describe('shared presentation delegation', () => {
  it('keeps local site and command text byte-identical to the pure model', () => {
    const presentable = toPresentableCommand(presentableFixture);

    expect(formatSiteHelpText('github', [presentableFixture])).toBe(formatSiteHelp('github', [presentable]));
    expect(formatCommandHelpText(presentableFixture)).toBe(formatCommandHelp(presentable));
  });

  it('keeps local structured help byte-identical to the pure model', () => {
    const presentable = toPresentableCommand(presentableFixture);

    expect(siteHelpData('github', [presentableFixture])).toEqual(sharedSiteHelpData('github', [presentable]));
    expect(commandHelpData(presentableFixture)).toEqual(sharedCommandHelpData(presentable));
  });
});

describe('namespace help command listing', () => {
  function namespace(): Command {
    const root = new Command('root');
    root.command('child').description('Child command').action(() => {});
    const group = root.command('group').description('Group command');
    group.command('leaf').description('Leaf command').action(() => {});
    return root;
  }

  it('lists registered children only, without Commander\'s auto help entry', () => {
    const root = namespace();
    expect(root.helpInformation()).toMatch(/^\s+help \[command\]/m);

    hideAutoHelpCommands(root);

    const help = root.helpInformation();
    expect(help).toMatch(/^\s+child\s+Child command$/m);
    expect(help).not.toMatch(/^\s+help \[command\]/m);
    expect(visibleChildCommands(root).map(command => command.name())).toEqual(['child', 'group']);
  });

  it('applies to nested groups and leaves the help command dispatchable', () => {
    const root = namespace();
    hideAutoHelpCommands(root);
    const group = root.commands.find(command => command.name() === 'group')!;
    expect(group.helpInformation()).not.toMatch(/^\s+help \[command\]/m);

    let out = '';
    const configure = (command: Command): void => {
      command.exitOverride().configureOutput({ writeOut: value => { out += value; } });
      for (const child of command.commands) configure(child);
    };
    configure(root);
    expect(() => root.parse(['help', 'child'], { from: 'user' }))
      .toThrow(expect.objectContaining({ code: 'commander.help' }));
    expect(out).toContain('Child command');
  });

  it('ignores commands that have no children', () => {
    const leaf = new Command('leaf').description('Leaf command');
    expect(() => hideAutoHelpCommands(leaf)).not.toThrow();
    expect(visibleChildCommands(leaf)).toEqual([]);
  });
});
