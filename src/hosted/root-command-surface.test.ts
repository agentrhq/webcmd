import { Writable } from 'node:stream';
import { Command, CommanderError } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { createProgram } from '../cli.js';
import { formatRootHelp } from '../command-presentation.js';
import { HOSTED_ROOT_HELP } from '../completion-shared.js';
import { CliError } from '../errors.js';
import { cli, getRegistry, Strategy } from '../registry.js';
import { PKG_VERSION } from '../version.js';
import { makeHostedConfig } from './config.js';
import {
  parseHostedRootCommandSurface,
  type HostedRootCommandSurface,
} from '../root-command-surface.js';
import { runHostedCli } from './runner.js';

function sink(): { stream: Writable; text: () => string } {
  let data = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        data += String(chunk);
        callback();
      },
    }),
    text: () => data,
  };
}

const manifest = {
  userId: 'user_demo',
  metadata: {
    contractSchemaVersion: 1,
    webcmdPackageVersion: PKG_VERSION,
    generatedAt: '2026-07-08T00:00:00.000Z',
  },
  commands: [{
    site: 'github',
    name: 'whoami',
    command: 'github/whoami',
    description: 'Show GitHub identity',
    access: 'read',
    strategy: 'PUBLIC',
    browser: false,
    args: [],
    columns: ['username'],
  }],
};

function manifestResponse(): Response {
  return new Response(JSON.stringify({ ok: true, manifest }), { status: 200 });
}

function executionResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    result: [],
    execution: { id: 'exec_success', command: 'github/whoami', status: 'succeeded' },
  }), { status: 200 });
}

type LocalRootResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  errorCode?: string;
  errorMessage?: string;
};

async function runActualLocalRoot(argv: string[]): Promise<LocalRootResult> {
  let stdout = '';
  let stderr = '';
  const previousExitCode = process.exitCode;
  const previousArgv = process.argv;
  const previousStdoutWrite = process.stdout.write;
  const previousStderrWrite = process.stderr.write;
  const previousConsoleError = console.error;
  process.exitCode = undefined;
  process.argv = ['node', 'webcmd', ...argv];
  process.stdout.write = ((chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown) => {
    stdout += String(chunk);
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown) => {
    stderr += String(chunk);
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stderr.write;
  console.error = (...values: unknown[]) => { stderr += `${values.map(String).join(' ')}\n`; };
  const program = createProgram('', '');
  const configureTree = (command: Command): void => {
    command.exitOverride().configureOutput({
      writeOut: value => { stdout += value; },
      writeErr: value => { stderr += value; },
    });
    for (const child of command.commands) configureTree(child);
  };
  configureTree(program);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return { exitCode: Number(process.exitCode ?? 0), stdout, stderr };
  } catch (error) {
    if (error instanceof CommanderError) {
      return { exitCode: error.exitCode, stdout, stderr, errorCode: error.code };
    }
    if (error instanceof CliError) {
      return {
        exitCode: error.exitCode,
        stdout,
        stderr,
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
    throw error;
  } finally {
    process.exitCode = previousExitCode;
    process.argv = previousArgv;
    process.stdout.write = previousStdoutWrite;
    process.stderr.write = previousStderrWrite;
    console.error = previousConsoleError;
  }
}

async function runActualLocalKnownSite(argv: string[]): Promise<LocalRootResult> {
  const registry = getRegistry();
  const previous = new Map(registry);
  registry.clear();
  cli({
    site: 'github',
    name: 'whoami',
    description: 'Show GitHub identity',
    access: 'read',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['username'],
  });
  try {
    return await runActualLocalRoot(argv);
  } finally {
    registry.clear();
    for (const [name, command] of previous) registry.set(name, command);
  }
}

function classifyHosted(result: HostedRootCommandSurface): string {
  return result.kind;
}

const profileForms = [
  { name: 'no-profile', tokens: [] as string[], profile: undefined },
  { name: 'split-profile', tokens: ['--profile', 'work'], profile: 'work' },
  { name: 'equals-profile', tokens: ['--profile=work'], profile: 'work' },
  { name: 'dash-profile', tokens: ['--profile', '-dash'], profile: '-dash' },
];

const dispatchForms = [
  { name: 'setup', tokens: ['setup'] },
  { name: 'browser', tokens: ['browser', 'work', 'state'] },
  { name: 'site', tokens: ['github', 'whoami'] },
];

const generatedTerminalCorpus = profileForms.flatMap(profile =>
  dispatchForms.flatMap(dispatch => [
    { name: `${profile.name}/help/${dispatch.name}`, argv: [...profile.tokens, '--help', ...dispatch.tokens], kind: 'help' as const },
    { name: `${profile.name}/long-version/${dispatch.name}`, argv: [...profile.tokens, '--version', ...dispatch.tokens], kind: 'version' as const },
    { name: `${profile.name}/clustered-version/${dispatch.name}`, argv: [...profile.tokens, '-Vx', ...dispatch.tokens], kind: 'version' as const },
  ]),
);

describe('hosted root command surface', () => {
  it('advertises hosted profile management as a root command, not a local-only namespace', () => {
    expect(HOSTED_ROOT_HELP.commands).toContainEqual({
      name: 'profile',
      description: 'Manage hosted browser profiles',
    });
    expect(HOSTED_ROOT_HELP.localOnlyCommands?.some(command => command.name === 'profile')).toBe(false);
  });

  it.each([
    { name: 'no args', argv: [], expected: { kind: 'help', exitCode: 1 } },
    { name: 'profile only', argv: ['--profile', 'work'], expected: { kind: 'help', exitCode: 1 } },
    { name: 'empty equals profile', argv: ['--profile='], expected: { kind: 'help', exitCode: 1 } },
    { name: 'dash-leading profile', argv: ['--profile', '-dash'], expected: { kind: 'help', exitCode: 1 } },
    { name: 'help', argv: ['--help'], expected: { kind: 'help', exitCode: 0 } },
    { name: 'short help', argv: ['-h'], expected: { kind: 'help', exitCode: 0 } },
    { name: 'help beats preceding unknown', argv: ['--unknown', '--help'], expected: { kind: 'help', exitCode: 0 } },
    { name: 'help beats following unknown', argv: ['--help', '--unknown'], expected: { kind: 'help', exitCode: 0 } },
    { name: 'profile consumes help', argv: ['--profile', '--help'], expected: { kind: 'help', exitCode: 1 } },
    { name: 'version', argv: ['--version'], expected: { kind: 'version', output: `${PKG_VERSION}\n` } },
    { name: 'short version', argv: ['-V'], expected: { kind: 'version', output: `${PKG_VERSION}\n` } },
    { name: 'version-leading cluster', argv: ['-Vx'], expected: { kind: 'version', output: `${PKG_VERSION}\n` } },
    { name: 'version then help cluster', argv: ['-Vh'], expected: { kind: 'version', output: `${PKG_VERSION}\n` } },
    { name: 'site token', argv: ['github', 'whoami'], expected: { kind: 'dispatch', argv: ['github', 'whoami'], literal: false } },
    { name: 'root help after malformed prefix and site', argv: ['--unknown', 'github', '--help'], expected: { kind: 'help', exitCode: 0 } },
    { name: 'root help with complete trailing profile', argv: ['--help', 'github', '--profile', 'work'], expected: { kind: 'help', exitCode: 0 } },
    { name: 'site tail options stay at leaf', argv: ['github', 'whoami', '--profile', 'other'], expected: { kind: 'dispatch', argv: ['github', 'whoami', '--profile', 'other'], literal: false } },
    { name: 'profile before site', argv: ['--profile=work', 'github', 'whoami'], expected: { kind: 'dispatch', argv: ['github', 'whoami'], profile: 'work', literal: false } },
    { name: 'browser token', argv: ['browser', 'work', 'state'], expected: { kind: 'dispatch', argv: ['browser', 'work', 'state'], literal: false } },
    { name: 'setup token', argv: ['setup'], expected: { kind: 'dispatch', argv: ['setup'], literal: false } },
    { name: 'completion command is ordinary root dispatch', argv: ['completion', 'bash'], expected: { kind: 'dispatch', argv: ['completion', 'bash'], literal: false } },
    { name: 'bare separator', argv: ['--'], expected: { kind: 'help', exitCode: 1 } },
    { name: 'literal help', argv: ['--', '--help'], expected: { kind: 'dispatch', argv: ['--help'], literal: true } },
    { name: 'literal version', argv: ['--', '-V'], expected: { kind: 'dispatch', argv: ['-V'], literal: true } },
    { name: 'profile then literal site', argv: ['--profile', 'work', '--', 'github', '--profile', 'other'], expected: { kind: 'dispatch', argv: ['github', '--profile', 'other'], profile: 'work', literal: true } },
  ])('$name', ({ argv, expected }) => {
    expect(parseHostedRootCommandSurface(argv)).toEqual(expected);
  });

  it.each([
    { name: 'missing profile', argv: ['--profile'], stderr: "error: option '--profile <name>' argument missing\n", code: 'commander.optionMissingArgument' },
    { name: 'missing profile beats help', argv: ['--help', '--profile'], stderr: "error: option '--profile <name>' argument missing\n", code: 'commander.optionMissingArgument' },
    { name: 'missing profile beats unknown', argv: ['--unknown', '--profile'], stderr: "error: option '--profile <name>' argument missing\n", code: 'commander.optionMissingArgument' },
    { name: 'unknown long', argv: ['--unknown'], stderr: "error: unknown option '--unknown'\n", code: 'commander.unknownOption' },
    { name: 'unknown short', argv: ['-x'], stderr: "error: unknown option '-x'\n", code: 'commander.unknownOption' },
    { name: 'unknown reverse cluster', argv: ['-xV'], stderr: "error: unknown option '-xV'\n", code: 'commander.unknownOption' },
    { name: 'help-leading cluster is not split', argv: ['-hV'], stderr: "error: unknown option '-hV'\n", code: 'commander.unknownOption' },
    { name: 'attached long typo', argv: ['--profilework'], stderr: "error: unknown option '--profilework'\n", code: 'commander.unknownOption' },
    { name: 'trailing missing profile beats root help', argv: ['--help', 'github', '--profile'], stderr: "error: option '--profile <name>' argument missing\n", code: 'commander.optionMissingArgument' },
    { name: 'trailing missing profile beats malformed prefix', argv: ['--unknown', 'github', '--profile'], stderr: "error: option '--profile <name>' argument missing\n", code: 'commander.optionMissingArgument' },
  ])('matches actual local Commander root error bytes: $name', async ({ argv, stderr, code }) => {
    const local = await runActualLocalRoot(argv);
    expect(local).toMatchObject({ exitCode: 1, stderr, errorCode: code });
    expect(() => parseHostedRootCommandSurface(argv)).toThrowError(
      expect.objectContaining({ output: stderr, exitCode: 1 }),
    );
  });

  it.each([
    { argv: [], localCode: 'commander.help', hostedKind: 'help' },
    { argv: ['--profile', 'work'], localCode: 'commander.help', hostedKind: 'help' },
    { argv: ['--'], localCode: 'commander.help', hostedKind: 'help' },
    { argv: ['--help'], localCode: 'commander.helpDisplayed', hostedKind: 'help' },
    { argv: ['--unknown', '--help'], localCode: 'commander.helpDisplayed', hostedKind: 'help' },
    { argv: ['--unknown', 'list', '--help'], localCode: 'commander.helpDisplayed', hostedKind: 'help' },
    { argv: ['-V'], localCode: 'commander.version', hostedKind: 'version' },
    { argv: ['-Vx'], localCode: 'commander.version', hostedKind: 'version' },
  ])('has the same terminal root disposition as the actual local program: $argv', async ({ argv, localCode, hostedKind }) => {
    const local = await runActualLocalRoot(argv);
    const hosted = parseHostedRootCommandSurface(argv);
    expect(local.errorCode).toBe(localCode);
    expect(classifyHosted(hosted)).toBe(hostedKind);
    expect(local.exitCode).toBe(localCode === 'commander.help' ? 1 : 0);
    if (localCode === 'commander.help') {
      expect(local.stdout).toBe('');
      expect(local.stderr).not.toBe('');
    } else if (localCode === 'commander.helpDisplayed') {
      expect(local.stdout).not.toBe('');
      expect(local.stderr).toBe('');
    } else if (hostedKind === 'version') {
      expect(local.stdout).toBe(`${PKG_VERSION}\n`);
      expect(local.stderr).toBe('');
    }
  });

  it.each(generatedTerminalCorpus)(
    'matches actual local terminal disposition across $name',
    async ({ argv, kind }) => {
      const local = await runActualLocalRoot(argv);
      const hosted = parseHostedRootCommandSurface(argv);

      expect(hosted.kind).toBe(kind);
      expect(local.exitCode).toBe(0);
      expect(local.stderr).toBe('');
      if (kind === 'help') {
        expect(local.errorCode).toBe('commander.helpDisplayed');
        expect(local.stdout).not.toBe('');
      } else {
        expect(local.errorCode).toBe('commander.version');
        expect(local.stdout).toBe(`${PKG_VERSION}\n`);
      }
    },
  );

  it.each(profileForms.flatMap(profile => dispatchForms.map(dispatch => ({ profile, dispatch }))))(
    'preserves ordinary and separator dispatch across $profile.name/$dispatch.name',
    ({ profile, dispatch }) => {
      expect(parseHostedRootCommandSurface([...profile.tokens, ...dispatch.tokens])).toEqual({
        kind: 'dispatch',
        argv: dispatch.tokens,
        ...(profile.profile !== undefined ? { profile: profile.profile } : {}),
        literal: false,
      });
      expect(parseHostedRootCommandSurface([...profile.tokens, '--', ...dispatch.tokens])).toEqual({
        kind: 'dispatch',
        argv: dispatch.tokens,
        ...(profile.profile !== undefined ? { profile: profile.profile } : {}),
        literal: true,
      });
    },
  );

  it.each(profileForms.flatMap(profile => dispatchForms.map(dispatch => ({ profile, dispatch }))))(
    'gives completion priority across $profile.name/$dispatch.name',
    ({ profile, dispatch }) => {
      const argv = [...profile.tokens, ...dispatch.tokens, '--get-completions'];
      expect(parseHostedRootCommandSurface(argv)).toEqual({ kind: 'completion', argv });
    },
  );

  it.each([
    { name: 'plain', argv: ['--get-completions'] },
    { name: 'beats help', argv: ['--help', '--get-completions'] },
    { name: 'beats unknown', argv: ['--unknown', '--get-completions'] },
    { name: 'beats missing profile', argv: ['--profile', '--get-completions'] },
    { name: 'after separator', argv: ['--', '--get-completions'] },
    { name: 'after site tokens', argv: ['github', 'whoami', '--get-completions'] },
    { name: 'beats non-fast clustered version', argv: ['-Vx', '--get-completions'] },
  ])('matches the local main completion fast-path: $name', ({ argv }) => {
    expect(parseHostedRootCommandSurface(argv)).toEqual({ kind: 'completion', argv });
  });

  it('keeps the exact first-token version fast-path ahead of completion', () => {
    expect(parseHostedRootCommandSurface(['-V', '--get-completions'])).toEqual({
      kind: 'version',
      output: `${PKG_VERSION}\n`,
    });
  });
});

describe('hosted root preflight call order', () => {
  it.each([
    { name: 'no args', argv: [], exitCode: 1, stdout: '', stderr: formatRootHelp(HOSTED_ROOT_HELP) },
    { name: 'profile only', argv: ['--profile', 'work'], exitCode: 1, stdout: '', stderr: formatRootHelp(HOSTED_ROOT_HELP) },
    { name: 'bare separator', argv: ['--'], exitCode: 1, stdout: '', stderr: formatRootHelp(HOSTED_ROOT_HELP) },
    { name: 'help', argv: ['--help'], exitCode: 0, stdout: formatRootHelp(HOSTED_ROOT_HELP), stderr: '' },
    { name: 'help after malformed prefix and site', argv: ['--unknown', 'github', '--help'], exitCode: 0, stdout: formatRootHelp(HOSTED_ROOT_HELP), stderr: '' },
    { name: 'profile consumes help into implicit help', argv: ['--profile', '--help'], exitCode: 1, stdout: '', stderr: formatRootHelp(HOSTED_ROOT_HELP) },
    { name: 'version', argv: ['-Vx'], exitCode: 0, stdout: `${PKG_VERSION}\n`, stderr: '' },
    { name: 'missing profile', argv: ['--profile'], exitCode: 1, stdout: '', stderr: "error: option '--profile <name>' argument missing\n" },
    { name: 'trailing missing profile beats help', argv: ['--help', 'github', '--profile'], exitCode: 1, stdout: '', stderr: "error: option '--profile <name>' argument missing\n" },
    { name: 'trailing missing profile beats unknown', argv: ['--unknown', 'github', '--profile'], exitCode: 1, stdout: '', stderr: "error: option '--profile <name>' argument missing\n" },
    { name: 'unknown option', argv: ['-xV'], exitCode: 1, stdout: '', stderr: "error: unknown option '-xV'\n" },
  ])('$name terminates before Cloud discovery', async ({ argv, exitCode, stdout: expectedStdout, stderr: expectedStderr }) => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode });
    expect(stdout.text()).toBe(expectedStdout);
    expect(stderr.text()).toBe(expectedStderr);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['--get-completions'],
    ['--help', '--get-completions'],
    ['--unknown', '--get-completions'],
    ['--profile', '--get-completions'],
    ['--', '--get-completions'],
    ['-Vx', '--get-completions'],
  ])('completion preflight performs exactly one manifest request and no execute: %j', async (...argv) => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.example.com/v1/manifest');
  });

  it('dispatches a profiled site only after the root preflight', async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const result = await runHostedCli(['--profile', 'work', 'github', 'whoami'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
        });
        return String(url).endsWith('/v1/manifest') ? manifestResponse() : executionResponse();
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(calls.map(call => call.url)).toEqual([
      'https://api.example.com/v1/manifest',
      'https://api.example.com/v1/execute',
    ]);
    expect(calls[1]?.body?.profile).toBe('work');
  });

  it.each([
    { argv: ['missing', '--version'], label: 'long version' },
    { argv: ['missing', '-V'], label: 'short version' },
  ])('matches local trailing $label handling for an unknown site', async ({ argv }) => {
    const local = await runActualLocalRoot(argv);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const hosted = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(local).toMatchObject({ exitCode: 0, stdout: `${PKG_VERSION}\n`, stderr: '' });
    expect(hosted).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe(local.stderr);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves the literal separator for an unknown site help-shaped token', async () => {
    const stdout = sink();
    const stderr = sink();

    const result = await runHostedCli(['--', 'missing', '--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => manifestResponse(),
    });

    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(stderr.text()).toBe("error: unknown command 'missing'\n");
    expect(stdout.text()).toBe(formatRootHelp(HOSTED_ROOT_HELP));
  });

  it('preserves the literal separator when list receives a help-shaped excess argument', async () => {
    const local = await runActualLocalRoot(['--', 'list', '--help']);
    const stdout = sink();
    const stderr = sink();

    const hosted = await runHostedCli(['--', 'list', '--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => manifestResponse(),
    });

    expect(local).toMatchObject({
      exitCode: 1,
      stdout: '',
      stderr: "error: too many arguments for 'list'. Expected 0 arguments but got 1.\n",
      errorCode: 'commander.excessArguments',
    });
    expect(hosted).toEqual({ handled: true, exitCode: local.exitCode });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe(local.stderr);
  });

  it.each([
    { name: 'help', argv: ['list', '--help'] },
    { name: 'unknown option', argv: ['list', '--unknown'] },
    { name: 'missing format', argv: ['list', '--format'] },
    { name: 'excess argument', argv: ['list', 'extra'] },
  ])('matches local list structural grammar: $name', async ({ argv }) => {
    const local = await runActualLocalRoot(argv);
    const stdout = sink();
    const stderr = sink();

    const hosted = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => manifestResponse(),
    });

    expect(hosted).toEqual({ handled: true, exitCode: local.exitCode });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe(local.stderr);
  });

  it('matches the local missing completion shell error before Cloud discovery', async () => {
    const local = await runActualLocalRoot(['completion']);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const hosted = await runHostedCli(['completion'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(local).toMatchObject({
      exitCode: 1,
      stdout: '',
      stderr: "error: missing required argument 'shell'\n",
      errorCode: 'commander.missingArgument',
    });
    expect(hosted).toEqual({ handled: true, exitCode: local.exitCode });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe(local.stderr);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'unknown child help', argv: ['github', 'bogus', '--help'] },
    { name: 'unknown option then help', argv: ['github', '--unknown', '--help'] },
    { name: 'structured format then help', argv: ['github', '-f', 'yaml', '--help'] },
    { name: 'complete profile then help', argv: ['github', '--profile', 'x', '--help'] },
  ])('matches local known-site namespace help precedence: $name', async ({ argv }) => {
    const local = await runActualLocalKnownSite(argv);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const hosted = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(local).toMatchObject({ exitCode: 0, stderr: '', errorCode: 'commander.helpDisplayed' });
    expect(hosted).toEqual({ handled: true, exitCode: local.exitCode });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe(local.stderr);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.example.com/v1/manifest');
  });

  it('keeps known leaf help authoritative over site help', async () => {
    const local = await runActualLocalKnownSite(['github', 'whoami', '--help']);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const hosted = await runHostedCli(['github', 'whoami', '--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(local).toMatchObject({ exitCode: 0, stderr: '', errorCode: 'commander.helpDisplayed' });
    expect(hosted).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe('');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'help', argv: ['completion', '--help'] },
    { name: 'leaf version is unknown', argv: ['completion', '-V'] },
    { name: 'excess shell', argv: ['completion', 'bash', 'extra'] },
    { name: 'literal missing shell', argv: ['--', 'completion'] },
  ])('matches local completion structural grammar: $name', async ({ name, argv }) => {
    const local = await runActualLocalRoot(argv);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const hosted = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(hosted).toEqual({ handled: true, exitCode: local.exitCode });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe(local.stderr);
    if (name === 'help') expect(local.stdout).toHaveLength(181);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'unsupported shell', argv: ['completion', 'powershell'], shell: 'powershell' },
    { name: 'literal help-shaped shell', argv: ['--', 'completion', '--help'], shell: '--help' },
    { name: 'leaf separator help-shaped shell', argv: ['completion', '--', '--help'], shell: '--help' },
  ])('matches local completion runtime validation: $name', async ({ argv, shell }) => {
    const local = await runActualLocalRoot(argv);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const hosted = runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(local).toMatchObject({
      exitCode: 1,
      stdout: '',
      stderr: '',
      errorCode: 'UNSUPPORTED_SHELL',
      errorMessage: `Unsupported shell: ${shell}. Supported: bash, zsh, fish`,
    });
    await expect(hosted).rejects.toMatchObject({
      code: local.errorCode,
      message: local.errorMessage,
      exitCode: local.exitCode,
    });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe(local.stderr);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('matches local literal completion success bytes without Cloud discovery', async () => {
    const local = await runActualLocalRoot(['--', 'completion', 'bash']);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const hosted = await runHostedCli(['--', 'completion', 'bash'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(local).toMatchObject({ exitCode: 0, stderr: '' });
    expect(hosted).toEqual({ handled: true, exitCode: local.exitCode });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe(local.stderr);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'version before missing profile', argv: ['missing', '--version', '--profile'], disposition: 'version' },
    { name: 'profile consumes version', argv: ['missing', '--profile', '--version'], disposition: 'unknown' },
    { name: 'help before missing profile', argv: ['missing', '--help', '--profile'], disposition: 'missing-profile' },
    { name: 'profile then help', argv: ['missing', '--profile', 'x', '--help'], disposition: 'help' },
    { name: 'help then profile', argv: ['missing', '--help', '--profile', 'x'], disposition: 'help' },
    { name: 'help then version', argv: ['missing', '--help', '--version'], disposition: 'version' },
    { name: 'version then help', argv: ['missing', '--version', '--help'], disposition: 'version' },
  ])('matches local unknown-site option precedence: $name', async ({ argv, disposition }) => {
    const local = await runActualLocalRoot(argv);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const hosted = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(hosted.exitCode).toBe(local.exitCode);
    if (disposition === 'version') {
      expect(stdout.text()).toBe(local.stdout);
      expect(stderr.text()).toBe(local.stderr);
    } else if (disposition === 'missing-profile') {
      expect(stdout.text()).toBe('');
      expect(stderr.text()).toBe(local.stderr);
    } else if (disposition === 'help') {
      expect(stdout.text()).toBe(formatRootHelp(HOSTED_ROOT_HELP));
      expect(stderr.text()).toBe('');
      expect(local.stdout).not.toBe('');
      expect(local.stderr).toBe('');
    } else {
      expect(stdout.text()).toBe(formatRootHelp(HOSTED_ROOT_HELP));
      expect(stderr.text()).toBe("error: unknown command 'missing'\n");
      expect(local.stdout).not.toBe('');
      expect(local.stderr).toBe("error: unknown command 'missing'\n");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.example.com/v1/manifest');
  });

  it.each([
    { name: 'long help', argv: ['github', 'bogus', '--', '--help'] },
    { name: 'short help', argv: ['github', 'bogus', '--', '-h'] },
  ])('stops known-site terminal scanning at command-local separator: $name', async ({ argv }) => {
    const local = await runActualLocalKnownSite(argv);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const hosted = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(local).toMatchObject({ exitCode: 1, stdout: '', stderr: "error: unknown command 'bogus'\n" });
    expect(hosted).toEqual({ handled: true, exitCode: local.exitCode });
    expect(stdout.text()).toBe(local.stdout);
    expect(stderr.text()).toBe(local.stderr);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.example.com/v1/manifest');
  });

  it.each([
    { name: 'version', argv: ['missing', '--', '--version'] },
    { name: 'long help', argv: ['missing', '--', '--help'] },
    { name: 'short help', argv: ['missing', '--', '-h'] },
  ])('stops unknown-site terminal scanning at command-local separator: $name', async ({ argv }) => {
    const local = await runActualLocalRoot(argv);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const hosted = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(local).toMatchObject({ exitCode: 2, stderr: "error: unknown command 'missing'\n" });
    expect(local.stdout).not.toBe('');
    expect(hosted).toEqual({ handled: true, exitCode: local.exitCode });
    expect(stdout.text()).toBe(formatRootHelp(HOSTED_ROOT_HELP));
    expect(stderr.text()).toBe(local.stderr);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.example.com/v1/manifest');
  });
});
