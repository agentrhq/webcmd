import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import {
  coerceCommandArguments,
  configureCommandSurface,
  parseCommandSurface,
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

  it.each<OutputFormat>(['table', 'plain', 'json', 'yaml', 'yml', 'md', 'markdown', 'csv'])(
    'accepts the %s output format',
    (format) => {
      expect(parseCommandSurface(metadata, ['needle', `--format=${format}`])).toMatchObject({
        format,
        formatExplicit: true,
      });
    },
  );

  it.each<TraceMode>(['off', 'on', 'retain-on-failure'])('accepts the %s trace mode', (trace) => {
    expect(parseCommandSurface(metadata, ['needle', '--trace', trace])).toMatchObject({ trace });
  });

  it('parses profile, verbose, and help globals', () => {
    expect(parseCommandSurface(metadata, ['--profile=work', '--verbose', '--help'])).toMatchObject({
      profile: 'work',
      verbose: true,
      help: true,
    });
  });

  it.each([
    { name: 'a missing required positional', argv: [], message: /query.*required/i },
    { name: 'an extra positional', argv: ['needle', 'issues', 'extra'], message: /unexpected positional/i },
    { name: 'a missing required option value', argv: ['needle', '--label'], message: /--label.*requires a value/i },
    { name: 'an unknown flag', argv: ['needle', '--unknown'], message: /unknown option/i },
    { name: 'a partial integer', argv: ['needle', '--limit', '12x'], message: /limit.*integer/i },
    { name: 'a fractional integer', argv: ['needle', '--limit', '1.5'], message: /limit.*integer/i },
    { name: 'a non-finite number', argv: ['needle', '--ratio', 'Infinity'], message: /ratio.*number/i },
    { name: 'an invalid choice', argv: ['needle', '--mode', 'merged'], message: /mode.*one of.*open.*closed/i },
    { name: 'an invalid boolean', argv: ['needle', '--enabled=maybe'], message: /enabled.*boolean/i },
    { name: 'an invalid format', argv: ['needle', '--format', 'xml'], message: /format.*one of/i },
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

  it('coerces defaults through the same type and choice rules as CLI values', () => {
    expect(coerceCommandArguments([
      { name: 'limit', type: 'int', default: '10' },
      { name: 'mode', choices: ['open', 'closed'], default: 'open' },
    ], {})).toEqual({ limit: 10, mode: 'open' });
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
      '--trace',
      '--verbose',
    ]));
    expect(command.registeredArguments.map((argument) => argument.name())).toEqual(['query', 'scope']);
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
