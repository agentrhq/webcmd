import { Command } from 'commander';
import { ArgumentError } from './errors.js';
import type { Arg } from './registry.js';

/** Canonical output format names accepted by the shared renderer. */
export const OUTPUT_FORMATS = ['table', 'plain', 'json', 'yaml', 'md', 'csv'] as const;
/** Accepted aliases that normalize onto the canonical names above. */
export const OUTPUT_FORMAT_ALIASES: Readonly<Record<string, string>> = { yml: 'yaml', markdown: 'md' };
/** Shared option description so every `-f/--format` flag advertises the same formats. */
export const OUTPUT_FORMAT_HELP = `Output format: ${OUTPUT_FORMATS.join(', ')}`;
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
  ) {
    super(output.trimEnd());
    this.name = 'CommanderStructuralError';
  }
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

  command
    .option('-f, --format <fmt>', OUTPUT_FORMAT_HELP, 'table')
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
  const formatExplicit = command.getOptionValueSource('format') === 'cli';
  const format = parseOutputFormat(formatExplicit ? parsedOptions.format : defaultFormat);
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

export function parseOutputFormat(value: unknown): OutputFormat {
  const raw = String(value);
  const normalized = Object.prototype.hasOwnProperty.call(OUTPUT_FORMAT_ALIASES, raw)
    ? OUTPUT_FORMAT_ALIASES[raw]!
    : raw;
  if (!OUTPUT_FORMATS.includes(normalized as (typeof OUTPUT_FORMATS)[number])) {
    throw new ArgumentError(`Unknown output format "${raw}". Supported formats: ${OUTPUT_FORMATS.join(', ')}.`);
  }
  return normalized;
}

function parseTraceMode(value: unknown): TraceMode {
  if (TRACE_MODES.includes(value as TraceMode)) return value as TraceMode;
  throw new ArgumentError(`--trace must be one of: ${TRACE_MODES.join(', ')}. Received: "${String(value)}"`);
}
