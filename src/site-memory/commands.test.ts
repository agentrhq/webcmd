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
    expect(store.show.mock.calls.length + store.list.mock.calls.length).toBeGreaterThan(0);
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

describe('readSitePutSource', () => {
  it('enumerates the valid input shape when neither path nor --stdin is given', async () => {
    await expect(readSitePutSource({})).rejects.toBeInstanceOf(ArgumentError);
    await expect(readSitePutSource({})).rejects.toThrow(/--stdin/);
  });
});
