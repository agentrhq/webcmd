import { Command, CommanderError } from 'commander';
import { ArgumentError, CliError, EXIT_CODES, type ErrorEnvelope } from './errors.js';
import type { Arg, CliCommand, CommandArgs } from './registry.js';

/** Canonical output format names accepted by the shared renderer. */
export const OUTPUT_FORMATS = ['table', 'plain', 'json', 'yaml', 'md', 'csv'] as const;
/** Accepted aliases that normalize onto the canonical names above. */
export const OUTPUT_FORMAT_ALIASES: Readonly<Record<string, string>> = { yml: 'yaml', markdown: 'md' };
/** Shared option description so every `-f/--format` flag advertises the same formats. */
export const OUTPUT_FORMAT_HELP = `Output format: ${OUTPUT_FORMATS.join(', ')}`;
/** Shared `--json` description so the flag is listed wherever `--format` is. */
export const JSON_FORMAT_ALIAS_HELP = 'Alias of --format json';
export const TRACE_MODES = ['off', 'on', 'retain-on-failure'] as const;

const BROWSER_WINDOW_MODES = ['foreground', 'background'] as const;
const SITE_SESSION_MODES = ['ephemeral', 'persistent'] as const;

export type OutputFormat = string;
export type TraceMode = typeof TRACE_MODES[number];

export interface CommandSurfaceMetadata {
  args: readonly Arg[];
  browser?: boolean;
  defaultFormat?: string | null;
  command?: string;
  site?: string;
  name?: string;
}

export interface ParsedCommandSurface {
  args: Record<string, unknown>;
  optionSources: Record<string, 'cli' | 'default'>;
  format: OutputFormat;
  formatExplicit: boolean;
  trace: TraceMode;
  profile?: string;
  verbose: boolean;
  help: boolean;
}

/** Identifies the one parser failure whose public bytes are owned by Commander. */
export class MissingRequiredPositionalError extends ArgumentError {
  readonly argumentName: string;

  constructor(argumentName: string, help?: string) {
    super(`Argument "${argumentName}" is required.`, help);
    this.argumentName = argumentName;
  }
}

/** Raw structural failure bytes/status owned by Commander. */
export class CommanderStructuralError extends Error {
  constructor(
    readonly output: string,
    readonly exitCode: number,
    readonly appendErrorEnvelope = false,
    /** Machine-readable form of the same failure, when it is a usage mistake. */
    readonly envelope?: ErrorEnvelope,
  ) {
    super(output.trimEnd());
    this.name = 'CommanderStructuralError';
  }
}

/**
 * Commander structural failure codes that are user usage mistakes, mapped onto
 * the machine-readable `error.code` they report. Everything listed here exits
 * with EXIT_CODES.USAGE_ERROR so a typo is distinguishable from a runtime fault.
 */
export const USAGE_ERROR_CODES: Readonly<Record<string, string>> = {
  'commander.unknownCommand': 'UNKNOWN_COMMAND',
  'commander.unknownOption': 'UNKNOWN_OPTION',
  'commander.missingArgument': 'MISSING_ARGUMENT',
  'commander.missingMandatoryOptionValue': 'MISSING_OPTION',
  'commander.excessArguments': 'EXCESS_ARGUMENTS',
  'commander.invalidArgument': 'INVALID_ARGUMENT',
};

export function visibleCommandFlags(command: Command): string[] {
  const flags: string[] = [];
  const seen = new Set<string>();
  for (const option of command.options) {
    for (const flag of [option.short, option.long]) {
      if (!flag || seen.has(flag)) continue;
      seen.add(flag);
      flags.push(flag);
    }
  }
  return flags;
}

export function commandInvocationPath(command: Command): string {
  const names: string[] = [];
  for (let current: Command | null = command; current; current = current.parent) {
    const name = current.name();
    if (name) names.unshift(name);
  }
  return names.join(' ');
}

function visibleSubcommandNames(command: Command): string[] {
  try {
    return command.createHelp().visibleCommands(command).map(child => child.name());
  } catch {
    return command.commands.map(child => child.name());
  }
}

/** The `help:` body offered alongside a structural `error:` line — no prefix, no newline. */
export function structuralHelpText(code: string, command: Command): string | undefined {
  const path = commandInvocationPath(command);
  if (code === 'commander.unknownOption') {
    const flags = visibleCommandFlags(command);
    return flags.length > 0 ? `valid flags for \`${path}\`: ${flags.join(', ')}` : undefined;
  }
  if (code === 'commander.unknownCommand') {
    const names = visibleSubcommandNames(command);
    return names.length > 0 ? `valid subcommands for \`${path}\`: ${names.join(', ')}` : undefined;
  }
  return `usage: ${path} ${command.usage()}`.trimEnd();
}

/** Human-readable rendering of one Commander structural failure. */
export function formatStructuralError(err: CommanderError, command: Command): string {
  const help = structuralHelpText(err.code, command);
  const message = err.message.replace(/^error:\s*/i, '');
  return `error: ${message}\n${help ? `help: ${help}\n` : ''}`;
}

export function structuralErrorFromCommander(
  error: CommanderError,
  command: Command,
  capturedStderr = '',
  opts: { appendErrorEnvelope?: boolean; includeCapturedStderrForUnknownOption?: boolean } = {},
): CommanderStructuralError {
  const code = USAGE_ERROR_CODES[error.code];
  if (!code) {
    return new CommanderStructuralError(
      capturedStderr || `${error.message}\n`,
      error.exitCode,
      opts.appendErrorEnvelope === true,
    );
  }
  const prefix = error.code === 'commander.unknownOption' && opts.includeCapturedStderrForUnknownOption
    ? capturedStderr
    : '';
  const help = structuralHelpText(error.code, command);
  const envelope: ErrorEnvelope = {
    ok: false,
    error: {
      code,
      message: error.message.replace(/^error:\s*/i, ''),
      ...(help ? { help } : {}),
      exitCode: EXIT_CODES.USAGE_ERROR,
    },
  };
  return new CommanderStructuralError(
    `${prefix}${formatStructuralError(error, command)}`,
    EXIT_CODES.USAGE_ERROR,
    // `appendErrorEnvelope` is the legacy hosted fallback that tacks an
    // UNKNOWN/exit-1 envelope onto the human bytes. A usage error carries its
    // own envelope, so that fallback must not fire on top of it.
    false,
    envelope,
  );
}

/**
 * Route every Commander structural failure through the shared envelope path.
 *
 * Commander's default `outputError` writes to stderr *before* `exitOverride`
 * throws, so capturing `writeErr` here is what keeps the caller from printing
 * the same line a second time. Output we do not own is replayed verbatim.
 */
export function applyUnknownOptionContract(command: Command): void {
  let captured = '';
  command
    .configureOutput({ writeErr: (value: string) => { captured += value; } })
    .exitOverride((err) => {
      const replay = captured;
      captured = '';
      if (USAGE_ERROR_CODES[err.code]) throw structuralErrorFromCommander(err, command);
      if (replay) process.stderr.write(replay);
      throw err;
    });
  for (const child of command.commands) applyUnknownOptionContract(child);
}

export function resolveCommandFromArgv(root: Command, argv: readonly string[]): Command {
  let current = root;
  for (const token of argv) {
    if (token === '--') break;
    if (token.startsWith('-')) continue;
    const child = current.commands.find(candidate => candidate.name() === token || candidate.aliases().includes(token));
    if (!child) break;
    current = child;
  }
  return current;
}

/** Register the adapter argument grammar and its shared execution options. */
export function configureCommandSurface(command: Command, metadata: CommandSurfaceMetadata): void {
  for (const arg of metadata.args) {
    if (arg.positional) {
      const bracket = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
      command.argument(bracket, arg.help ?? '');
      continue;
    }

    const expectsValue = arg.required || arg.valueRequired;
    const flag = expectsValue ? `--${arg.name} <value>` : `--${arg.name} [value]`;
    if (arg.required) command.requiredOption(flag, arg.help ?? '');
    else if (arg.default != null) command.option(flag, arg.help ?? '', String(arg.default));
    else command.option(flag, arg.help ?? '');
  }

  addOutputFormatOption(command)
    .option('--trace <mode>', `Trace capture: ${TRACE_MODES.join(', ')}`, 'off')
    .option('-v, --verbose', 'Debug output', false);

  if (metadata.browser) {
    command
      .option('--window <mode>', `Browser window mode: ${BROWSER_WINDOW_MODES.join(' or ')} (default: background)`)
      .option('--site-session <mode>', `Adapter site session lifecycle: ${SITE_SESSION_MODES.join(' or ')}`)
      .option('--keep-tab <bool>', 'Keep the browser tab lease after the command finishes');
  }
}

/** Parse one adapter invocation without requiring a local Commander program. */
export function parseCommandSurface(
  metadata: CommandSurfaceMetadata,
  argv: string[],
): ParsedCommandSurface {
  const positionals = metadata.args.filter((arg) => arg.positional);
  const defaultFormat = metadata.defaultFormat || 'table';
  const input: Record<string, unknown> = {};
  const optionSources: Record<string, 'cli' | 'default'> = {};
  const { root, command, parseArgv } = makeStructuralCommand(metadata, argv);
  let parsedOptions: Record<string, unknown> = {};
  let actionRan = false;
  let stderr = '';

  const commanderOutput = {
      writeErr: (value: string) => { stderr += value; },
      // Hosted mode owns help presentation; Commander is used only for its
      // grammar, precedence, exact structural errors, and exit status.
      writeOut: (_value: string) => undefined,
  };
  for (let current: Command | null = command; current; current = current.parent) {
    current.exitOverride().configureOutput(commanderOutput);
  }

  command.action((...actionArgs: unknown[]) => {
    actionRan = true;
    parsedOptions = actionArgs[positionals.length] as Record<string, unknown>;
    for (let index = 0; index < positionals.length; index += 1) {
      const value = actionArgs[index];
      if (value !== undefined) {
        input[positionals[index]!.name] = value;
        optionSources[positionals[index]!.name] = 'cli';
      }
    }
    for (const definition of metadata.args) {
      if (definition.positional) continue;
      const camelName = definition.name.replace(/-([a-z])/g, (_match, character: string) => character.toUpperCase());
      const value = parsedOptions[definition.name] ?? parsedOptions[camelName];
      if (value !== undefined) input[definition.name] = value;
      const source = command.getOptionValueSource(camelName) ?? command.getOptionValueSource(definition.name);
      if (source === 'cli' || source === 'default') {
        optionSources[definition.name] = source as 'cli' | 'default';
      }
    }
  });

  try {
    root.parse(parseArgv, { from: 'user' });
  } catch (error) {
    const commander = error as { code?: unknown; exitCode?: unknown; message?: unknown };
    if (commander.code === 'commander.helpDisplayed') {
      return {
        args: {},
        optionSources: {},
        format: parseOutputFormat(defaultFormat),
        formatExplicit: false,
        trace: 'off',
        verbose: false,
        help: true,
      };
    }
    if (error instanceof CommanderError) {
      throw structuralErrorFromCommander(error, command, stderr);
    }
    const output = stderr || `${typeof commander.message === 'string' ? commander.message : String(error)}\n`;
    throw new CommanderStructuralError(
      output,
      typeof commander.exitCode === 'number' ? commander.exitCode : 1,
    );
  }
  if (!actionRan) {
    throw new CommanderStructuralError(`error: command '${command.name()}' did not run\n`, 1);
  }

  // Match the local action boundary: adapter argument coercion occurs before
  // format validation, and trace validation occurs inside executeCommand after
  // both. Commander has already enforced required positionals/options.
  const args = coerceCommandArguments(metadata.args, input);
  const formatExplicit = outputFormatIsExplicit(command);
  const format = parseOutputFormat(formatExplicit ? requestedOutputFormat(command, parsedOptions.format) : defaultFormat);
  const trace = parseTraceMode(parsedOptions.trace ?? 'off');
  const verbose = parsedOptions.verbose === true;

  return {
    args,
    optionSources,
    format,
    formatExplicit,
    trace,
    verbose,
    help: false,
  };
}

function makeStructuralCommand(
  metadata: CommandSurfaceMetadata,
  argv: readonly string[],
): { root: Command; command: Command; parseArgv: string[] } {
  const pathParts = (metadata.command ?? '').split('/').filter(Boolean);
  const site = metadata.site ?? (pathParts.length > 1 ? pathParts[0] : undefined);
  const name = metadata.name ?? pathParts.at(-1) ?? 'command';
  if (!site) {
    const command = new Command(name);
    configureCommandSurface(command, metadata);
    return { root: command, command, parseArgv: [...argv] };
  }
  const root = new Command('webcmd');
  const siteCommand = root.command(site);
  const command = siteCommand.command(name);
  configureCommandSurface(command, metadata);
  return { root, command, parseArgv: [site, name, ...argv] };
}

/** Apply the adapter's required/default/type/choice contract to raw values. */
export function coerceCommandArguments(
  definitions: readonly Arg[],
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...input };

  for (const definition of definitions) {
    const value = result[definition.name];
    if (definition.required && (value === undefined || value === null || value === '')) {
      throw new ArgumentError(
        `Argument "${definition.name}" is required.`,
        definition.help ?? `Provide a value for --${definition.name}`,
      );
    }

    if (value !== undefined && value !== null) {
      if (definition.type === 'int' || definition.type === 'number') {
        const parsed = Number(value);
        if (Number.isNaN(parsed)) {
          throw new ArgumentError(`Argument "${definition.name}" must be a valid number. Received: "${String(value)}"`);
        }
        result[definition.name] = parsed;
      } else if (definition.type === 'boolean' || definition.type === 'bool') {
        if (typeof value === 'string') {
          const normalized = value.toLowerCase();
          if (normalized === 'true' || normalized === '1') result[definition.name] = true;
          else if (normalized === 'false' || normalized === '0') result[definition.name] = false;
          else {
            throw new ArgumentError(
              `Argument "${definition.name}" must be a boolean (true/false). Received: "${String(value)}"`,
            );
          }
        } else {
          result[definition.name] = Boolean(value);
        }
      }

      const coercedValue = result[definition.name];
      if (definition.choices && definition.choices.length > 0
        && !definition.choices.map(String).includes(String(coercedValue))) {
        throw new ArgumentError(
          `Argument "${definition.name}" must be one of: ${definition.choices.join(', ')}. Received: "${String(coercedValue)}"`,
        );
      }
    } else if (definition.default !== undefined) {
      // Preserve the historical local contract: defaults are adapter-owned
      // values and are not re-coerced or revalidated by the CLI boundary.
      result[definition.name] = definition.default;
    }
  }

  return result;
}

/** Apply the adapter's coercion and command-specific validation. */
export function prepareCommandArgs(
  cmd: CliCommand,
  rawKwargs: CommandArgs,
): CommandArgs {
  const kwargs = coerceCommandArguments(cmd.args, rawKwargs);
  cmd.validateArgs?.(kwargs);
  return kwargs;
}

export function parseOutputFormat(value: unknown): OutputFormat {
  const raw = String(value);
  const lower = raw.toLowerCase();
  const normalized = Object.prototype.hasOwnProperty.call(OUTPUT_FORMAT_ALIASES, lower)
    ? OUTPUT_FORMAT_ALIASES[lower]!
    : lower;
  if (!OUTPUT_FORMATS.includes(normalized as (typeof OUTPUT_FORMATS)[number])) {
    throw new ArgumentError(`Unknown output format "${raw}". Supported formats: ${OUTPUT_FORMATS.join(', ')}.`);
  }
  return normalized;
}

/** Validate and normalize a local built-in command format. */
export function resolveOutputFormat(raw: string | undefined): OutputFormat | null {
  try {
    return parseOutputFormat(raw);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`error: ${err.message}`);
      process.exitCode = EXIT_CODES.USAGE_ERROR;
      return null;
    }
    throw err;
  }
}

/** Register `-f/--format` plus the `--json` alias on one command. */
export function addOutputFormatOption(command: Command, defaultFormat = 'table'): Command {
  return command
    .option('-f, --format <fmt>', OUTPUT_FORMAT_HELP, defaultFormat)
    .option('--json', JSON_FORMAT_ALIAS_HELP, false);
}

export function outputFormatIsExplicit(command: Command): boolean {
  return command.getOptionValueSource('format') === 'cli' || command.getOptionValueSource('json') === 'cli';
}

/** Resolve `--json` onto `--format json` unless `--format` was also passed. */
export function requestedOutputFormat(command: Command, format: unknown): unknown {
  return command.getOptionValueSource('json') === 'cli' && command.getOptionValueSource('format') !== 'cli'
    ? 'json'
    : format;
}

export function resolveCommandOutputFormat(command: Command, format: unknown): OutputFormat | null {
  const raw = requestedOutputFormat(command, format);
  return resolveOutputFormat(raw === undefined ? undefined : String(raw));
}

function parseTraceMode(value: unknown): TraceMode {
  if (TRACE_MODES.includes(value as TraceMode)) return value as TraceMode;
  throw new ArgumentError(`--trace must be one of: ${TRACE_MODES.join(', ')}. Received: "${String(value)}"`);
}
