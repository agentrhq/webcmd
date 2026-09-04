import { describe, it, expect } from 'vitest';
import {
  classifyAdapter,
  commandHelpData,
  formatCommandHelpText,
  formatRootAdapterHelpText,
  formatSiteHelpText,
  getRequestedHelpFormat,
  siteHelpData,
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
  it('renders all three sections in SITES / APP / EXTERNAL order when populated', () => {
    const text = formatRootAdapterHelpText({
      external: [
        { name: 'gh', label: 'gh' },
        { name: 'vercel', label: 'vercel' },
      ],
      apps: ['chatwise', 'codex'],
      sites: ['youtube'],
    });
    expect(text).toContain('EXTERNAL CLIs (2)');
    expect(text).toContain('APP ADAPTERS (2)');
    expect(text).toContain('SITES (1)');
    expect(text).toContain('vercel');
    expect(text.indexOf('SITES')).toBeLessThan(text.indexOf('APP ADAPTERS'));
    expect(text.indexOf('APP ADAPTERS')).toBeLessThan(text.indexOf('EXTERNAL CLIs'));
  });

  it('omits empty sections instead of rendering a (0) header', () => {
    const text = formatRootAdapterHelpText({
      external: [],
      apps: [],
      sites: ['youtube'],
    });
    expect(text).not.toContain('EXTERNAL CLIs');
    expect(text).not.toContain('APP ADAPTERS');
    expect(text).toContain('SITES (1)');
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
