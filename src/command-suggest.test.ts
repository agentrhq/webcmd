import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createProgram } from './cli.js';
import { editDistance, unknownRootCommandMessage, unknownSubcommandMessage } from './command-suggest.js';

function namespaceOf(program: ReturnType<typeof createProgram>, name: string) {
  return program.commands.find(command => command.name() === name)!;
}

describe('editDistance', () => {
  it('counts single edits', () => {
    expect(editDistance('adapters', 'adapter')).toBe(1);
    expect(editDistance('fetch', 'fetch')).toBe(0);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('unknown root command', () => {
  it('suggests the real command instead of a plugin hunt for a near miss', () => {
    const message = unknownRootCommandMessage(createProgram('', ''), 'adapters');

    expect(message).toContain('Unknown command "adapters".');
    expect(message).toContain('webcmd adapter');
    expect(message).not.toContain('plugin search');
  });

  it('reaches subcommand leaves so a bare verb finds its namespace', () => {
    const message = unknownRootCommandMessage(createProgram('', ''), 'fetch');

    expect(message).toContain('Did you mean: webcmd web fetch');
  });

  it('keeps the hardcoded intent overrides ahead of edit distance', () => {
    const message = unknownRootCommandMessage(createProgram('', ''), 'marketplace');

    expect(message).toContain('Did you mean: webcmd plugin search <query>');
  });

  it('still guides a genuinely unknown token to plugin search', () => {
    const message = unknownRootCommandMessage(createProgram('', ''), 'zzzqqqwww');

    expect(message).toContain('Site "zzzqqqwww" is not installed.');
    expect(message).toContain('webcmd plugin search zzzqqqwww');
  });

  it('says the adapter failed to load when its directory is on disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-suggest-'));
    const installed = path.join(root, 'zzzqqqwww');
    fs.mkdirSync(installed);
    try {
      const message = unknownRootCommandMessage(createProgram('', ''), 'zzzqqqwww', [root]);

      expect(message).toContain(`Site "zzzqqqwww" is installed at ${installed}`);
      expect(message).toContain('failed to load');
      expect(message).not.toContain('is not installed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('unknown namespace subcommand', () => {
  it('suggests adapter status and lists the valid subcommands', () => {
    const message = unknownSubcommandMessage(namespaceOf(createProgram('', ''), 'adapter'), 'list');

    expect(message).toContain("error: unknown command 'list'");
    expect(message).toContain('Did you mean: webcmd adapter status');
    expect(message).toContain('Valid webcmd adapter commands: override, path, reset, source, status');
  });

  it('lists valid subcommands even when nothing is close enough to suggest', () => {
    const message = unknownSubcommandMessage(namespaceOf(createProgram('', ''), 'plugin'), 'zzzqqqwww');

    expect(message).toContain('Valid webcmd plugin commands: catalog, create, install, list, search, uninstall, update');
  });

  it('names the replacement for a retired subcommand', () => {
    const message = unknownSubcommandMessage(namespaceOf(createProgram('', ''), 'browser'), 'fork');

    expect(message).toContain('webcmd adapter override <site>/<command>');
  });
});

describe('error paths write nothing to stdout', () => {
  async function captureStdout(argv: string[]): Promise<{ stdout: string; exitCode: unknown }> {
    const program = createProgram('', '');
    const previousExitCode = process.exitCode;
    let stdout = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdout += String(chunk);
      return true;
    });
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdout += args.join(' ');
    });
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await program.parseAsync(argv, { from: 'user' });
      return { stdout, exitCode: process.exitCode };
    } finally {
      process.exitCode = previousExitCode;
      write.mockRestore();
      log.mockRestore();
      stderr.mockRestore();
    }
  }

  it('does not print root help to stdout for an unknown root command', async () => {
    expect(await captureStdout(['adapters', '--json'])).toEqual({ stdout: '', exitCode: 2 });
  });

  it('does not print help to stdout for an unknown subcommand', async () => {
    expect(await captureStdout(['adapter', 'list', 'rest'])).toEqual({ stdout: '', exitCode: 2 });
  });
});
