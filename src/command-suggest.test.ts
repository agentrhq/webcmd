import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleProgramParseError } from './cli-error-report.js';
import { createProgram } from './cli.js';
import { editDistance, isHostedOnlyRootCommand, isReservedRootCommand, unknownRootCommandMessage, unknownSubcommandMessage } from './command-suggest.js';
import { HOSTED_ROOT_HELP } from './completion-shared.js';
import { WEBCMD_ROOT_COMMANDS } from './hooks.js';

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

  it('names hosted-only mode instead of sending artifact to a plugin hunt', () => {
    const message = unknownRootCommandMessage(createProgram('', ''), 'artifact');

    expect(message).toContain('"artifact" is a hosted-mode command');
    expect(message).toContain('choose hosted mode');
    // the plugin does not exist, so the old advice could only waste a turn
    expect(message).not.toContain('plugin search');
    expect(message).not.toContain('is not installed');
  });

  it('answers the same way regardless of the case typed', () => {
    const message = unknownRootCommandMessage(createProgram('', ''), 'Artifact');

    expect(message).toContain('"Artifact" is a hosted-mode command');
    expect(message).not.toContain('plugin search');
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

describe('reserved roots', () => {
  it('matches WEBCMD_ROOT_COMMANDS plus hosted root help, not stale extras', () => {
    for (const name of WEBCMD_ROOT_COMMANDS) expect(isReservedRootCommand(name)).toBe(true);
    for (const command of HOSTED_ROOT_HELP.commands) {
      expect(isReservedRootCommand(command.name.split(/\s/, 1)[0]!)).toBe(true);
    }
    expect(isReservedRootCommand('artifact')).toBe(true);
    expect(isReservedRootCommand('setup')).toBe(true);
    expect(isReservedRootCommand('tab')).toBe(false);
    expect(isReservedRootCommand('github')).toBe(false);
  });
});

describe('hosted-only roots', () => {
  it('is exactly the hosted surface local mode does not register', () => {
    // derived, not listed: a hosted command added later is covered for free
    for (const name of WEBCMD_ROOT_COMMANDS) expect(isHostedOnlyRootCommand(name)).toBe(false);
    expect(isHostedOnlyRootCommand('artifact')).toBe(true);
    expect(isHostedOnlyRootCommand('github')).toBe(false);
  });

  it('never claims a locally served command is hosted-only', () => {
    // `web` ships in both surfaces; calling it hosted-only would be a new lie
    expect(isHostedOnlyRootCommand('web')).toBe(false);
    expect(isHostedOnlyRootCommand('browser')).toBe(false);
    expect(isHostedOnlyRootCommand('doctor')).toBe(false);
    // `setup` is served locally by main.ts before Commander parses argv
    expect(isHostedOnlyRootCommand('setup')).toBe(false);
  });
});

describe('unknown namespace subcommand', () => {
  it('suggests adapter status and lists the valid subcommands', () => {
    const message = unknownSubcommandMessage(namespaceOf(createProgram('', ''), 'adapter'), 'list');

    expect(message).toContain("error: unknown command 'list'");
    expect(message).toContain('Did you mean: webcmd adapter status');
    expect(message).toContain('help: valid subcommands for `webcmd adapter`: override, path, reset, source, status');
  });

  it('lists valid subcommands even when nothing is close enough to suggest', () => {
    const message = unknownSubcommandMessage(namespaceOf(createProgram('', ''), 'plugin'), 'zzzqqqwww');

    expect(message).toContain('help: valid subcommands for `webcmd plugin`: catalog, create, install, list, search, uninstall, update');
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
      // Mirror runCli: a structural failure is thrown and rendered by
      // handleProgramParseError, never printed from inside the parser.
      await program.parseAsync(argv, { from: 'user' }).catch(handleProgramParseError);
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
