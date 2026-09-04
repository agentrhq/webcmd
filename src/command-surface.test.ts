import { describe, expect, it } from 'vitest';
import { Command, CommanderError } from 'commander';
import {
  CommanderStructuralError,
  coerceCommandArguments,
  configureCommandSurface,
  parseCommandSurface,
  parseOutputFormat,
  structuralErrorFromCommander,
  type CommandSurfaceMetadata,
  type OutputFormat,
  type TraceMode,
} from './command-surface.js';

const metadata = {
  command: 'demo/search',
  browser: false,
  defaultFormat: 'plain',
  args: [
    { name: 'query', positional: true, required: true, type: 'string' },
    { name: 'scope', positional: true, type: 'string' },
    { name: 'limit', type: 'int', default: 10 },
    { name: 'ratio', type: 'number' },
    { name: 'mode', type: 'string', choices: ['open', 'closed'] },
    { name: 'enabled', type: 'boolean', default: false },
    { name: 'label', type: 'string', valueRequired: true },
  ],
} satisfies CommandSurfaceMetadata;

describe('parseCommandSurface', () => {
  it.each([
    {
      name: 'required and optional positionals',
      argv: ['needle', 'issues'],
      args: { query: 'needle', scope: 'issues', limit: 10, enabled: false },
      sources: { query: 'cli', scope: 'cli', limit: 'default', enabled: 'default' },
    },
    {
      name: 'a leading-dash positional after the option separator',
      argv: ['--', '-opaque-id'],
      args: { query: '-opaque-id', limit: 10, enabled: false },
      sources: { query: 'cli', limit: 'default', enabled: 'default' },
    },
    {
      name: 'separate and inline named option values',
      argv: ['needle', '--label', 'triage', '--limit=12'],
      args: { query: 'needle', label: 'triage', limit: 12, enabled: false },
      sources: { query: 'cli', label: 'cli', limit: 'cli', enabled: 'default' },
    },
    {
      name: 'a required option value beginning with a dash',
      argv: ['needle', '--label', '-opaque'],
      args: { query: 'needle', label: '-opaque', limit: 10, enabled: false },
      sources: { query: 'cli', label: 'cli', limit: 'default', enabled: 'default' },
    },
    {
      name: 'a valueless boolean flag',
      argv: ['needle', '--enabled'],
      args: { query: 'needle', limit: 10, enabled: true },
      sources: { query: 'cli', limit: 'default', enabled: 'cli' },
    },
    {
      name: 'an explicit separate boolean value',
      argv: ['needle', '--enabled', 'false'],
      args: { query: 'needle', limit: 10, enabled: false },
      sources: { query: 'cli', limit: 'default', enabled: 'cli' },
    },
    {
      name: 'an explicit inline boolean value',
      argv: ['needle', '--enabled=true'],
      args: { query: 'needle', limit: 10, enabled: true },
      sources: { query: 'cli', limit: 'default', enabled: 'cli' },
    },
    {
      name: 'a finite number and a valid choice',
      argv: ['needle', '--ratio=-1.25', '--mode', 'closed'],
      args: { query: 'needle', limit: 10, ratio: -1.25, mode: 'closed', enabled: false },
      sources: { query: 'cli', limit: 'default', ratio: 'cli', mode: 'cli', enabled: 'default' },
    },
  ])('parses $name', ({ argv, args, sources }) => {
    expect(parseCommandSurface(metadata, argv)).toEqual({
      args,
      optionSources: sources,
      format: 'plain',
      formatExplicit: false,
      trace: 'off',
      verbose: false,
      help: false,
    });
  });

  it('treats --json as an explicit --format json alias', () => {
    expect(parseCommandSurface(metadata, ['needle', '--json'])).toMatchObject({
      format: 'json',
      formatExplicit: true,
    });
  });

  it.each([
    ['needle', '--json', '--format', 'yaml'],
    ['needle', '--format', 'yaml', '--json'],
  ])('lets an explicit --format win over --json for %j', (...argv) => {
    expect(parseCommandSurface(metadata, argv)).toMatchObject({
      format: 'yaml',
      formatExplicit: true,
    });
  });

  it.each<{ input: string; normalized: OutputFormat }>([
    { input: 'table', normalized: 'table' },
    { input: 'plain', normalized: 'plain' },
    { input: 'json', normalized: 'json' },
    { input: 'yaml', normalized: 'yaml' },
    { input: 'yml', normalized: 'yaml' },
    { input: 'md', normalized: 'md' },
    { input: 'markdown', normalized: 'md' },
    { input: 'csv', normalized: 'csv' },
  ])('accepts and normalizes the %s output format', ({ input, normalized }) => {
    expect(parseCommandSurface(metadata, ['needle', `--format=${input}`])).toMatchObject({
      format: normalized,
      formatExplicit: true,
    });
  });

  it.each(['xml', 'html', 'jsonl', 'yamlml'])('rejects the unsupported %s output format', (format) => {
    expect(() => parseCommandSurface(metadata, ['needle', '--format', format]))
      .toThrow(/Unknown output format ".*". Supported formats: table, plain, json, yaml, md, csv/);
  });

  it.each(['JSON', 'YAML', 'Yml', 'Markdown', 'Md'])('accepts the %s output format case-insensitively', (format) => {
    expect(() => parseCommandSurface(metadata, ['needle', '--format', format])).not.toThrow();
    expect(parseOutputFormat(format).toLowerCase()).toBe(
      parseOutputFormat(format.toLowerCase()),
    );
  });

  it.each<TraceMode>(['off', 'on', 'retain-on-failure'])('accepts the %s trace mode', (trace) => {
    expect(parseCommandSurface(metadata, ['needle', '--trace', trace])).toMatchObject({ trace });
  });

  it('lets Commander help terminate before action-level global values are observed', () => {
    expect(parseCommandSurface(metadata, ['--verbose', '--help'])).toMatchObject({
      verbose: false,
      help: true,
    });
  });

  it.each([
    { name: 'a missing required positional', argv: [], message: /missing required argument 'query'/i },
    { name: 'an extra positional', argv: ['needle', 'issues', 'extra'], message: /too many arguments.*search/i },
    { name: 'a missing required option value', argv: ['needle', '--label'], message: /--label.*argument missing/i },
    { name: 'an unknown flag', argv: ['needle', '--unknown'], message: /unknown option/i },
    { name: 'a partial integer', argv: ['needle', '--limit', '12x'], message: /limit.*number/i },
    { name: 'an invalid choice', argv: ['needle', '--mode', 'merged'], message: /mode.*one of.*open.*closed/i },
    { name: 'an invalid boolean', argv: ['needle', '--enabled=maybe'], message: /enabled.*boolean/i },
    { name: 'an invalid trace mode', argv: ['needle', '--trace', 'always'], message: /trace.*one of/i },
  ])('rejects $name', ({ argv, message }) => {
    expect(() => parseCommandSurface(metadata, argv)).toThrow(message);
  });
});

describe('coerceCommandArguments', () => {
  it('applies typed defaults and preserves non-definition compatibility metadata', () => {
    expect(coerceCommandArguments(metadata.args, {
      query: 'needle',
      __webcmdOptionSources: { limit: 'cli' },
    })).toEqual({
      query: 'needle',
      limit: 10,
      enabled: false,
      __webcmdOptionSources: { limit: 'cli' },
    });
  });

  it('preserves adapter-owned defaults without coercing them again', () => {
    expect(coerceCommandArguments([
      { name: 'limit', type: 'int', default: '10' },
      { name: 'mode', choices: ['open', 'closed'], default: 'open' },
    ], {})).toEqual({ limit: '10', mode: 'open' });
  });

  it('preserves legacy numeric coercion', () => {
    expect(coerceCommandArguments([
      { name: 'count', type: 'int' },
      { name: 'ratio', type: 'number' },
    ], { count: '1.5', ratio: 'Infinity' })).toEqual({ count: 1.5, ratio: Infinity });
  });
});

describe('configureCommandSurface', () => {
  it.each([
    { browser: false, expected: [] },
    { browser: true, expected: ['--window', '--site-session', '--keep-tab'] },
  ])('registers browser globals only when browser is $browser', ({ browser, expected }) => {
    const command = new Command('search');
    configureCommandSurface(command, { ...metadata, browser });

    const longFlags = command.options.map((option) => option.long);
    for (const flag of expected) expect(longFlags).toContain(flag);
    if (browser) {
      expect(command.options.find((option) => option.long === '--window')?.description)
        .toBe('Browser window mode: foreground or background (default: background)');
    }
    if (!browser) {
      expect(longFlags).not.toContain('--window');
      expect(longFlags).not.toContain('--site-session');
      expect(longFlags).not.toContain('--keep-tab');
    }
    expect(longFlags).toEqual(expect.arrayContaining([
      '--limit',
      '--ratio',
      '--mode',
      '--enabled',
      '--label',
      '--format',
      '--json',
      '--trace',
      '--verbose',
    ]));
    expect(command.registeredArguments.map((argument) => argument.name())).toEqual(['query', 'scope']);
  });
});

describe('unknown option contract', () => {
  it('enumerates the command flags and exits 2', () => {
    try {
      parseCommandSurface(metadata, ['needle', '--unknown']);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CommanderStructuralError);
      const error = err as CommanderStructuralError;
      expect(error.exitCode).toBe(2);
      expect(error.output).toContain("error: unknown option '--unknown'");
      expect(error.output).toContain('help: valid flags for `webcmd demo search`:');
      expect(error.output).toContain('--format');
      expect(error.output).toContain('--json');
      expect(error.output).toContain('--trace');
    }
  });
});

type ParseOutcome =
  | { kind: 'success'; args: Record<string, unknown> }
  | { kind: 'unknown' | 'missing' | 'invalid' };

function classifyError(error: unknown): Exclude<ParseOutcome, { kind: 'success' }> {
  const message = error instanceof Error ? error.message : String(error);
  if (/unknown option/i.test(message)) return { kind: 'unknown' };
  if (/argument missing|requires a value/i.test(message)) return { kind: 'missing' };
  return { kind: 'invalid' };
}

async function parseWithCommander(
  surface: CommandSurfaceMetadata,
  argv: string[],
): Promise<ParseOutcome> {
  const command = new Command('parity')
    .exitOverride()
    .configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
  configureCommandSurface(command, surface);
  const positionals = surface.args.filter((argument) => argument.positional);
  let parsed: Record<string, unknown> | undefined;
  command.action((...actionArgs: unknown[]) => {
    const options = actionArgs[positionals.length] as Record<string, unknown>;
    const raw: Record<string, unknown> = {};
    for (let index = 0; index < positionals.length; index += 1) {
      if (actionArgs[index] !== undefined) raw[positionals[index]!.name] = actionArgs[index];
    }
    for (const argument of surface.args) {
      if (argument.positional) continue;
      const camelName = argument.name.replace(/-([a-z])/g, (_match, character: string) => character.toUpperCase());
      const value = options[argument.name] ?? options[camelName];
      if (value !== undefined) raw[argument.name] = value;
    }
    parsed = coerceCommandArguments(surface.args, raw);
  });

  try {
    await command.parseAsync(argv, { from: 'user' });
    return { kind: 'success', args: parsed ?? {} };
  } catch (error) {
    return classifyError(error);
  }
}

function parseWithShared(surface: CommandSurfaceMetadata, argv: string[]): ParseOutcome {
  try {
    return { kind: 'success', args: parseCommandSurface(surface, argv).args };
  } catch (error) {
    return classifyError(error);
  }
}

describe('Commander parity for dash-prefixed numeric tokens', () => {
  it.each([
    {
      name: 'integer positional accepts a negative integer',
      args: [{ name: 'count', positional: true, required: true, type: 'int' }],
      argv: ['-1'],
      kind: 'success',
    },
    {
      name: 'number positional accepts a negative decimal',
      args: [{ name: 'ratio', positional: true, required: true, type: 'number' }],
      argv: ['-1.25'],
      kind: 'success',
    },
    {
      name: 'required string positional accepts a strict negative number operand',
      args: [{ name: 'label', positional: true, required: true, type: 'string' }],
      argv: ['-1'],
      kind: 'success',
    },
    {
      name: 'optional string positional accepts a strict negative number operand',
      args: [{ name: 'label', positional: true, type: 'string' }],
      argv: ['-1'],
      kind: 'success',
    },
    {
      name: 'untyped positional accepts a strict negative number operand',
      args: [{ name: 'label', positional: true, required: true }],
      argv: ['-1'],
      kind: 'success',
    },
    {
      name: 'integer positional rejects a malformed numeric prefix as an unknown option',
      args: [{ name: 'count', positional: true, required: true, type: 'int' }],
      argv: ['-1x'],
      kind: 'unknown',
    },
    {
      name: 'string positional rejects a malformed numeric prefix as an unknown option',
      args: [{ name: 'label', positional: true, required: true, type: 'string' }],
      argv: ['-1x'],
      kind: 'unknown',
    },
    {
      name: 'option separator preserves a malformed dash token as a string positional',
      args: [{ name: 'label', positional: true, required: true, type: 'string' }],
      argv: ['--', '-1x'],
      kind: 'success',
    },
    {
      name: 'required integer option consumes a valid negative value',
      args: [{ name: 'count', type: 'int', valueRequired: true }],
      argv: ['--count', '-1'],
      kind: 'success',
    },
    {
      name: 'required integer option consumes then validates a malformed dash value',
      args: [{ name: 'count', type: 'int', valueRequired: true }],
      argv: ['--count', '-1x'],
      kind: 'invalid',
    },
    {
      name: 'optional integer option consumes a valid negative value',
      args: [{ name: 'count', type: 'int' }],
      argv: ['--count', '-1'],
      kind: 'success',
    },
    {
      name: 'optional integer option leaves a malformed dash value as an unknown option',
      args: [{ name: 'count', type: 'int' }],
      argv: ['--count', '-1x'],
      kind: 'unknown',
    },
    {
      name: 'required string option consumes a dash-prefixed value',
      args: [{ name: 'label', type: 'string', valueRequired: true }],
      argv: ['--label', '-opaque'],
      kind: 'success',
    },
    {
      name: 'optional string option leaves a dash-prefixed token as an unknown option',
      args: [{ name: 'label', type: 'string' }],
      argv: ['--label', '-opaque'],
      kind: 'unknown',
    },
    {
      name: 'required option without a following value reports a missing value',
      args: [{ name: 'count', type: 'int', valueRequired: true }],
      argv: ['--count'],
      kind: 'missing',
    },
  ] as const)('$name', async ({ args, argv, kind }) => {
    const surface = { args } satisfies CommandSurfaceMetadata;
    const commander = await parseWithCommander(surface, [...argv]);
    const shared = parseWithShared(surface, [...argv]);

    expect(commander.kind).toBe(kind);
    expect(shared).toEqual(commander);
  });
});

type ExactSurfaceOutcome =
  | { kind: 'success'; args: Record<string, unknown>; format: string; trace: string }
  | { kind: 'help' }
  | { kind: 'structural'; stderr: string; exitCode: number }
  | { kind: 'semantic'; message: string };

const precedenceSurface = {
  command: 'parity/check',
  site: 'parity',
  name: 'check',
  args: [
    { name: 'account', positional: true, required: true, type: 'string' },
    { name: 'scope', positional: true, type: 'string' },
    { name: 'token', required: true, valueRequired: true, type: 'string' },
    { name: 'mode', type: 'string', choices: ['valid'] },
  ],
} satisfies CommandSurfaceMetadata;

function captureReferenceSurface(argv: string[]): ExactSurfaceOutcome {
  let stderr = '';
  let outcome: ExactSurfaceOutcome | undefined;
  const root = new Command('webcmd')
    .exitOverride()
    .configureOutput({ writeErr: value => { stderr += value; }, writeOut: () => undefined });
  const command = root.command(precedenceSurface.site).command(precedenceSurface.name);
  configureCommandSurface(command, precedenceSurface);
  const positionals = precedenceSurface.args.filter(argument => argument.positional);
  command.action((...actionArgs: unknown[]) => {
    try {
      const options = actionArgs[positionals.length] as Record<string, unknown>;
      const raw: Record<string, unknown> = {};
      for (let index = 0; index < positionals.length; index += 1) {
        if (actionArgs[index] !== undefined) raw[positionals[index]!.name] = actionArgs[index];
      }
      for (const argument of precedenceSurface.args) {
        if (argument.positional) continue;
        const value = options[argument.name];
        if (value !== undefined) raw[argument.name] = value;
      }
      const args = coerceCommandArguments(precedenceSurface.args, raw);
      const format = parseOutputFormat(options.format ?? 'table');
      const trace = String(options.trace ?? 'off');
      if (!['off', 'on', 'retain-on-failure'].includes(trace)) {
        throw new Error(`--trace must be one of: off, on, retain-on-failure. Received: "${trace}"`);
      }
      outcome = { kind: 'success', args, format, trace };
    } catch (error) {
      outcome = { kind: 'semantic', message: error instanceof Error ? error.message : String(error) };
    }
  });

  try {
    root.parse([precedenceSurface.site, precedenceSurface.name, ...argv], { from: 'user' });
    return outcome ?? { kind: 'success', args: {}, format: 'table', trace: 'off' };
  } catch (error) {
    if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') return { kind: 'help' };
    if (error instanceof CommanderError) {
      const structural = structuralErrorFromCommander(error, command, stderr);
      return { kind: 'structural', stderr: structural.output, exitCode: structural.exitCode };
    }
    const commander = error as { code?: string; exitCode?: number };
    return { kind: 'structural', stderr, exitCode: commander.exitCode ?? 1 };
  }
}

function captureSharedSurface(argv: string[]): ExactSurfaceOutcome {
  try {
    const parsed = parseCommandSurface(precedenceSurface, argv);
    if (parsed.help) return { kind: 'help' };
    return { kind: 'success', args: parsed.args, format: parsed.format, trace: parsed.trace };
  } catch (error) {
    if (error instanceof CommanderStructuralError) {
      return { kind: 'structural', stderr: error.output, exitCode: error.exitCode };
    }
    return { kind: 'semantic', message: error instanceof Error ? error.message : String(error) };
  }
}

describe('complete Commander structural grammar and precedence parity', () => {
  it.each([
    { name: 'help before unknown option', argv: ['--help', '--unknown'] },
    { name: 'unknown option before help', argv: ['--unknown', '--help'] },
    { name: 'help with a missing format value', argv: ['--help', '-f'] },
    { name: 'help with excess positionals', argv: ['--help', 'one', 'two', 'three'] },
    { name: 'help with invalid choice, format, and trace', argv: ['--help', '--mode', 'bad', '-f', 'xml', '--trace', 'bad'] },
    { name: 'missing required named with invalid format', argv: ['account', '-f', 'xml'] },
    { name: 'missing required named with invalid trace', argv: ['account', '--trace', 'bad'] },
    { name: 'missing required named with invalid choice', argv: ['account', '--mode', 'bad'] },
    { name: 'missing positional with invalid format', argv: ['--token', 'secret', '-f', 'xml'] },
    { name: 'missing positional with invalid trace', argv: ['--token', 'secret', '--trace', 'bad'] },
    { name: 'missing positional with invalid choice', argv: ['--token', 'secret', '--mode', 'bad'] },
    { name: 'invalid choice precedes invalid format and trace', argv: ['account', '--token', 'secret', '--mode', 'bad', '-f', 'xml', '--trace', 'bad'] },
    { name: 'invalid format precedes invalid trace', argv: ['account', '--token', 'secret', '-f', 'xml', '--trace', 'bad'] },
    { name: 'ordinary unknown option', argv: ['account', '--token', 'secret', '--unknown'] },
    { name: 'ordinary missing required option value', argv: ['account', '--token'] },
    { name: 'ordinary excess positional', argv: ['account', 'scope', 'extra', '--token', 'secret'] },
    { name: 'dash-leading positional after separator', argv: ['--token', 'secret', '--', '-account'] },
  ])('$name', ({ argv }) => {
    expect(captureSharedSurface(argv)).toEqual(captureReferenceSurface(argv));
  });
});

describe('shared options an adapter shadows', () => {
  // linkedin/thread-snapshot ships exactly this: an argument named `json`.
  // Registering webcmd's own `--json` alias on top of it made Commander throw
  // while the CLI was still being built, so every command crashed at startup
  // — including the `plugin uninstall` needed to remove the plugin.
  const shadowing = {
    command: 'demo/snapshot',
    browser: true,
    defaultFormat: 'table',
    args: [
      { name: 'thread-url', required: true, type: 'string' },
      { name: 'json', type: 'boolean', default: false },
    ],
  } satisfies CommandSurfaceMetadata;

  it.each(['json', 'format', 'trace', 'verbose', 'window', 'site-session', 'keep-tab'])(
    'registers a command whose argument is named %s without throwing',
    (name) => {
      const metadataFor = {
        command: `demo/${name}-arg`,
        browser: true,
        args: [{ name, type: 'boolean', default: false }],
      } satisfies CommandSurfaceMetadata;
      expect(() => configureCommandSurface(new Command('demo'), metadataFor)).not.toThrow();
    },
  );

  it('registers every shared option when nothing collides', () => {
    const command = new Command('demo');
    configureCommandSurface(command, { command: 'demo/plain', browser: true, args: [] });
    const flags = command.options.map((option) => option.long);
    expect(flags).toEqual(expect.arrayContaining([
      '--format', '--json', '--trace', '--verbose', '--window', '--site-session', '--keep-tab',
    ]));
  });

  it('keeps the adapter argument rather than webcmd’s alias when they collide', () => {
    const command = new Command('demo');
    configureCommandSurface(command, shadowing);
    const jsonOptions = command.options.filter((option) => option.long === '--json');
    expect(jsonOptions).toHaveLength(1);
    expect(jsonOptions[0]!.description).not.toBe('Alias of --format json');
  });

  it('does not treat a shadowed --json as a request for JSON output', () => {
    // Argv preprocessing already resolves this collision in the adapter's
    // favour, so format resolution has to agree or --json means two things.
    expect(parseCommandSurface(shadowing, ['--thread-url', 'https://example.com/t/1', '--json']))
      .toMatchObject({ format: 'table', formatExplicit: false });
  });

  it('passes a shadowed --json through to the adapter', () => {
    const parsed = parseCommandSurface(shadowing, ['--thread-url', 'https://example.com/t/1', '--json']);
    expect(parsed.args.json).toBe(true);
  });

  it('still honours -f json on a command that shadows --json', () => {
    expect(parseCommandSurface(shadowing, ['--thread-url', 'https://example.com/t/1', '-f', 'json']))
      .toMatchObject({ format: 'json', formatExplicit: true });
  });
});
