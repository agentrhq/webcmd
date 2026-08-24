import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Command } from 'commander';
import { createProgram } from './cli.js';
import { getRegistry } from './registry.js';

/**
 * One output-format grammar for the whole CLI.
 *
 * Agents learn `--json` on one command and reuse it everywhere; when half the
 * tree rejected it they burned turns guessing. Walking the finished Commander
 * tree keeps a command added later from quietly reintroducing the split.
 */
function walk(command: Command, path: string[] = []): { path: string; command: Command }[] {
  return command.commands.flatMap((child) => {
    const childPath = [...path, child.name()];
    return [{ path: childPath.join(' '), command: child }, ...walk(child, childPath)];
  });
}

function flagsOf(command: Command): Set<string> {
  const flags = new Set<string>();
  for (const option of command.options) {
    if (option.short) flags.add(option.short);
    if (option.long) flags.add(option.long);
  }
  return flags;
}

describe('output format contract', () => {
  const commands = walk(createProgram('', ''));

  it('registers commands to check', () => {
    expect(commands.length).toBeGreaterThan(30);
  });

  it('accepts -f/--format and --json on every command', () => {
    const missing = commands
      .filter(({ command }) => {
        // Namespace commands only print help; external CLI passthrough forwards
        // argv untouched to the wrapped binary.
        if (command.commands.length > 0) return false;
        if ((command as Command & { _allowUnknownOption?: boolean })._allowUnknownOption === true) return false;
        const flags = flagsOf(command);
        return !flags.has('--format') || !flags.has('--json') || !flags.has('-f');
      })
      .map(({ path }) => path);
    expect(missing).toEqual([]);
  });

  it('renders a structured result instead of prose for an action command', async () => {
    const key = 'format-contract/search';
    const source = path.join(os.tmpdir(), 'webcmd-format-contract.js');
    fs.writeFileSync(source, 'export default {};');
    getRegistry().set(key, {
      site: 'format-contract', name: 'search', access: 'read', description: 'fixture', args: [], source,
    } as never);
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value: unknown) => { logged.push(String(value)); });
    try {
      await createProgram('', '').parseAsync(['node', 'webcmd', 'adapter', 'path', key]);
      expect(logged).toEqual([source]);

      logged.length = 0;
      await createProgram('', '').parseAsync(['node', 'webcmd', 'adapter', 'path', key, '--json']);
      expect(JSON.parse(logged[0]!)).toEqual({ ok: true, command: key, path: source });
    } finally {
      spy.mockRestore();
      getRegistry().delete(key);
      fs.rmSync(source, { force: true });
    }
  });
});
