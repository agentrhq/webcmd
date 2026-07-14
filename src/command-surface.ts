import { Command } from 'commander';
import { ArgumentError } from './errors.js';
import type { Arg } from './registry.js';

export const OUTPUT_FORMATS = ['table', 'plain', 'json', 'yaml', 'yml', 'md', 'markdown', 'csv'] as const;
export const TRACE_MODES = ['off', 'on', 'retain-on-failure'] as const;

const BROWSER_WINDOW_MODES = ['foreground', 'background'] as const;
const SITE_SESSION_MODES = ['ephemeral', 'persistent'] as const;

export type OutputFormat = typeof OUTPUT_FORMATS[number];
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
    .option('-f, --format <fmt>', `Output format: ${OUTPUT_FORMATS.join(', ')}`, 'table')
    .option('--trace <mode>', `Trace capture: ${TRACE_MODES.join(', ')}`, 'off')
    .option('-v, --verbose', 'Debug output', false);

  if (metadata.browser) {
    command
      .option('--window <mode>', `Browser window mode: ${BROWSER_WINDOW_MODES.join(' or ')}`)
      .option('--site-session <mode>', `Adapter site session lifecycle: ${SITE_SESSION_MODES.join(' or ')}`)
      .option('--keep-tab <bool>', 'Keep the browser tab lease after the command finishes');
  }
}

/** Parse one adapter invocation without requiring a local Commander program. */
export function parseCommandSurface(
  metadata: CommandSurfaceMetadata,
  argv: string[],
): ParsedCommandSurface {
  const input: Record<string, unknown> = {};
  const optionSources: Record<string, 'cli' | 'default'> = {};
  const positionals = metadata.args.filter((arg) => arg.positional);
  const named = new Map(metadata.args.filter((arg) => !arg.positional).map((arg) => [arg.name, arg]));
  let positionalIndex = 0;
  let format = parseOutputFormat(metadata.defaultFormat || 'table');
  let formatExplicit = false;
  let trace: TraceMode = 'off';
  let profile: string | undefined;
  let verbose = false;
  let help = false;

  const assignPositional = (value: string): void => {
    const definition = positionals[positionalIndex++];
    if (!definition) throw new ArgumentError(`Unexpected positional argument: ${value}`);
    input[definition.name] = value;
    optionSources[definition.name] = 'cli';
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--') {
      for (const rest of argv.slice(index + 1)) assignPositional(rest);
      break;
    }
    if (token === '-h' || token === '--help') {
      help = true;
      continue;
    }
    if (token === '-v' || token === '--verbose') {
      verbose = true;
      continue;
    }
    if (token === '-f' || token === '--format') {
      format = parseOutputFormat(readRequiredValue(argv, ++index, token));
      formatExplicit = true;
      continue;
    }
    if (token.startsWith('--format=')) {
      format = parseOutputFormat(token.slice('--format='.length));
      formatExplicit = true;
      continue;
    }
    if (token.startsWith('-f') && token.length > 2) {
      format = parseOutputFormat(token.slice(2));
      formatExplicit = true;
      continue;
    }
    if (token === '--trace') {
      trace = parseTraceMode(readRequiredValue(argv, ++index, token));
      continue;
    }
    if (token.startsWith('--trace=')) {
      trace = parseTraceMode(token.slice('--trace='.length));
      continue;
    }
    if (token === '--profile') {
      profile = readRequiredValue(argv, ++index, token);
      continue;
    }
    if (token.startsWith('--profile=')) {
      profile = token.slice('--profile='.length);
      continue;
    }
    if (token.startsWith('--')) {
      const equalsIndex = token.indexOf('=');
      const name = token.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
      const definition = named.get(name);
      if (!definition) throw new ArgumentError(`Unknown option for ${commandName(metadata)}: --${name}`);

      const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);
      const expectsValue = definition.required || definition.valueRequired;
      let value: unknown;
      if (inlineValue !== undefined) {
        value = inlineValue;
      } else if (expectsValue) {
        value = readRequiredValue(argv, ++index, token);
      } else {
        const next = argv[index + 1];
        if (next !== undefined && next !== '--'
          && (!isOptionToken(next) || isNegativeNumberToken(next))) {
          value = next;
          index += 1;
        } else {
          value = true;
        }
      }
      input[definition.name] = value;
      optionSources[definition.name] = 'cli';
      continue;
    }
    if (isOptionToken(token)) {
      const positionalAvailable = positionals[positionalIndex] !== undefined;
      if (!positionalAvailable || !isNegativeNumberToken(token)) {
        throw new ArgumentError(`Unknown option for ${commandName(metadata)}: ${token}`);
      }
    }
    assignPositional(token);
  }

  for (const definition of metadata.args) {
    if (optionSources[definition.name] === undefined && definition.default !== undefined) {
      optionSources[definition.name] = 'default';
    }
  }

  const definitions = help
    ? metadata.args.map((definition) => definition.required ? { ...definition, required: false } : definition)
    : metadata.args;
  const args = coerceCommandArguments(definitions, input);

  return {
    args,
    optionSources,
    format,
    formatExplicit,
    trace,
    ...(profile ? { profile } : {}),
    verbose,
    help,
  };
}

/** Apply the adapter's required/default/type/choice contract to raw values. */
export function coerceCommandArguments(
  definitions: readonly Arg[],
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...input };

  for (const definition of definitions) {
    let value = result[definition.name];
    if (definition.required && (value === undefined || value === null || value === '')) {
      throw new ArgumentError(
        `Argument "${definition.name}" is required.`,
        definition.help ?? `Provide a value for --${definition.name}`,
      );
    }

    if (value === undefined || value === null) {
      if (definition.default === undefined) continue;
      result[definition.name] = definition.default;
      value = definition.default;
    }

    if (definition.type === 'int') {
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) {
        throw new ArgumentError(`Argument "${definition.name}" must be a valid integer. Received: "${String(value)}"`);
      }
      result[definition.name] = parsed;
    } else if (definition.type === 'number') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
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
  }

  return result;
}

function commandName(metadata: CommandSurfaceMetadata): string {
  return metadata.command ?? ([metadata.site, metadata.name].filter(Boolean).join('/') || 'command');
}

function isOptionToken(value: string): boolean {
  return value.length > 1 && value.startsWith('-');
}

function isNegativeNumberToken(value: string): boolean {
  return /^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/.test(value);
}

function readRequiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) {
    throw new ArgumentError(`${flag} requires a value.`);
  }
  return value;
}

function parseOutputFormat(value: unknown): OutputFormat {
  if (OUTPUT_FORMATS.includes(value as OutputFormat)) return value as OutputFormat;
  throw new ArgumentError(`--format must be one of: ${OUTPUT_FORMATS.join(', ')}. Received: "${String(value)}"`);
}

function parseTraceMode(value: unknown): TraceMode {
  if (TRACE_MODES.includes(value as TraceMode)) return value as TraceMode;
  throw new ArgumentError(`--trace must be one of: ${TRACE_MODES.join(', ')}. Received: "${String(value)}"`);
}
