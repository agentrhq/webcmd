import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { applyUnknownOptionContract, CommanderStructuralError } from '../command-surface.js';
import { ArgumentError } from '../errors.js';
import { readSitePutSource, registerSiteCommands, type SiteMemoryBackend } from './commands.js';

function backend(overrides: Partial<SiteMemoryBackend> = {}): SiteMemoryBackend {
  return {
    show: vi.fn(async () => [{ path: 'notes.md', body: '# notes' }]),
    list: vi.fn(async () => [{ path: 'notes.md', byteSize: 7, updatedAt: '2026-01-01T00:00:00.000Z', sha256: 'abc' }]),
    note: vi.fn(async () => undefined),
    endpoint: vi.fn(async () => undefined),
    stale: vi.fn(async () => undefined),
    fieldMap: vi.fn(async () => undefined),
    fixture: vi.fn(async () => '{"args":{}}'),
    putFixture: vi.fn(async () => undefined),
    sample: vi.fn(async () => undefined),
    ...overrides,
  };
}

function program(store: SiteMemoryBackend, io?: { readStdin?: () => Promise<string> }): Command {
  const root = new Command('webcmd').exitOverride();
  registerSiteCommands(root, store, undefined, io);
  applyUnknownOptionContract(root);
  return root;
}

describe('site memory format flags', () => {
  it('documents the site argument grammar in site-memory help', () => {
    const help = program(backend()).commands.find(command => command.name() === 'site')!.helpInformation();

    expect(help).toContain('webcmd site <group> <verb> <site>');
    expect(help).toContain('Right: webcmd site field-map add example.com price');
    expect(help).toContain("Agent tip: use '--help -f yaml'");
  });

  it('accepts -f json on site fixture get', async () => {
    const store = backend();
    await program(store).parseAsync(['site', 'fixture', 'get', 'quotes-toscrape/list', '-f', 'json'], { from: 'user' });
    expect(store.fixture).toHaveBeenCalledWith('quotes-toscrape', 'list');
  });

  it.each([
    ['site', 'memory', 'show', 'quotes-toscrape', '--kind', 'endpoints', '-f', 'json'],
    ['site', 'memory', 'list', 'quotes-toscrape', '-f', 'json'],
    ['site', 'note', 'list', 'quotes-toscrape', '--json'],
    ['site', 'endpoint', 'list', 'quotes-toscrape', '-f', 'json'],
  ])('accepts format flags on %s %s %s', async (...argv) => {
    const store = backend();
    await program(store).parseAsync(argv, { from: 'user' });
    expect(vi.mocked(store.show).mock.calls.length + vi.mocked(store.list).mock.calls.length).toBeGreaterThan(0);
  });

  it.each([
    { argv: ['site', 'note', 'add', 'quotes-toscrape', '--text', 'hi'], expected: { ok: true, action: 'note add', site: 'quotes-toscrape' } },
    { argv: ['site', 'endpoint', 'stale', 'quotes-toscrape', 'listing'], expected: { ok: true, action: 'endpoint stale', site: 'quotes-toscrape', endpoint: 'listing' } },
    { argv: ['site', 'field-map', 'add', 'quotes-toscrape', 'q', '--meaning', 'quote', '--source', 'dom'], expected: { ok: true, action: 'field-map add', site: 'quotes-toscrape', key: 'q' } },
  ])('renders a structured result for write command $argv.1 $argv.2', async ({ argv, expected }) => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value: unknown) => { logged.push(value); });
    try {
      await program(backend()).parseAsync(argv, { from: 'user' });
      expect(logged).toEqual([]);
      await program(backend()).parseAsync([...argv, '--json'], { from: 'user' });
      expect(JSON.parse(String(logged[0]))).toEqual(expected);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects unknown flags with the valid set including --format and --json', async () => {
    try {
      await program(backend()).parseAsync(['site', 'memory', 'show', 'quotes-toscrape', '--nope'], { from: 'user' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CommanderStructuralError);
      const output = (error as CommanderStructuralError).output;
      expect(output).toContain("unknown option '--nope'");
      expect(output).toContain('--format');
      expect(output).toContain('--json');
    }
  });
});

describe('site fixture put --stdin', () => {
  it('reads stdin when --stdin is set', async () => {
    const store = backend();
    await program(store, { readStdin: async () => '{"args":{}}' })
      .parseAsync(['site', 'fixture', 'put', 'quotes-toscrape/list', '--stdin'], { from: 'user' });
    expect(store.putFixture).toHaveBeenCalledWith('quotes-toscrape', 'list', '{"args":{}}');
  });

  it('reads stdin when the path is -', async () => {
    const store = backend();
    await program(store, { readStdin: async () => '{"ok":true}' })
      .parseAsync(['site', 'sample', 'add', 'quotes-toscrape/list', '-'], { from: 'user' });
    expect(store.sample).toHaveBeenCalledWith('quotes-toscrape', 'list', '{"ok":true}');
  });
});

describe('site command help coverage', () => {
  function walk(command: Command): Command[] {
    return command.commands
      .filter(child => child.name() !== 'help')
      .flatMap(child => [child, ...walk(child)]);
  }

  const site = program(backend()).commands.find(command => command.name() === 'site')!;

  it('gives every command in the site tree a description', () => {
    const missing = walk(site).filter(command => command.description().trim() === '');
    expect(missing.map(command => command.name())).toEqual([]);
  });

  it('gives every site option and positional a help string', () => {
    const missing: string[] = [];
    for (const command of walk(site)) {
      for (const option of command.options) {
        if (!option.description) missing.push(`${command.name()} ${option.flags}`);
      }
      for (const arg of command.registeredArguments) {
        if (!arg.description) missing.push(`${command.name()} <${arg.name()}>`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('documents --text and the site-before-flags order on site note add', () => {
    const help = site.commands.find(command => command.name() === 'note')!
      .commands.find(command => command.name() === 'add')!
      .helpInformation();

    expect(help).toContain('--text <markdown>');
    expect(help).toMatch(/Usage: .*note add \[options\] <site>/);
    expect(help).toContain('Example: webcmd site note add example.com --text');
  });
});

describe('readSitePutSource', () => {
  it('enumerates the valid input shape when neither path nor --stdin is given', async () => {
    await expect(readSitePutSource({})).rejects.toBeInstanceOf(ArgumentError);
    await expect(readSitePutSource({})).rejects.toThrow(/--stdin/);
  });
});
