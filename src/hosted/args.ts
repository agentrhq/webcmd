import { ArgumentError } from '../errors.js';
import type { HostedCommand } from './types.js';

export interface ParsedHostedInvocation {
  args: Record<string, unknown>;
  format: string;
  trace: string;
  profile?: string;
  help: boolean;
}

export function parseHostedInvocation(command: HostedCommand, argv: string[]): ParsedHostedInvocation {
  const args: Record<string, unknown> = {};
  const positional = command.args.filter((arg) => arg.positional);
  const named = new Map(command.args.filter((arg) => !arg.positional).map((arg) => [arg.name, arg]));
  let positionalIndex = 0;
  let format = String(command.defaultFormat || 'table');
  let trace = 'off';
  let profile: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--') {
      for (const rest of argv.slice(i + 1)) {
        const arg = positional[positionalIndex++];
        if (!arg) throw new ArgumentError(`Unexpected positional argument: ${rest}`);
        args[arg.name] = coerceValue(rest, arg.type);
      }
      break;
    }
    if (token === '-h' || token === '--help') {
      help = true;
      continue;
    }
    if (token === '-f' || token === '--format') {
      format = readValue(argv, ++i, token);
      continue;
    }
    if (token === '--trace') {
      trace = readValue(argv, ++i, token);
      continue;
    }
    if (token === '--profile') {
      profile = readValue(argv, ++i, token);
      continue;
    }
    if (token.startsWith('--')) {
      const eqIndex = token.indexOf('=');
      const rawName = token.slice(2, eqIndex === -1 ? undefined : eqIndex);
      const arg = named.get(rawName);
      if (!arg) throw new ArgumentError(`Unknown option for hosted command ${command.command}: --${rawName}`);
      const inlineValue = eqIndex === -1 ? undefined : token.slice(eqIndex + 1);
      if (arg.type === 'bool' || arg.type === 'boolean') {
        args[arg.name] = inlineValue === undefined ? true : coerceValue(inlineValue, arg.type);
      } else {
        args[arg.name] = coerceValue(inlineValue ?? readValue(argv, ++i, token), arg.type);
      }
      continue;
    }
    const arg = positional[positionalIndex++];
    if (!arg) throw new ArgumentError(`Unexpected positional argument: ${token}`);
    args[arg.name] = coerceValue(token, arg.type);
  }

  for (const arg of command.args) {
    if (args[arg.name] === undefined && arg.default !== undefined) args[arg.name] = arg.default;
    if (arg.required && args[arg.name] === undefined) {
      throw new ArgumentError(`Missing required argument for hosted command ${command.command}: ${arg.name}`);
    }
  }

  return {
    args,
    format,
    trace,
    ...(profile ? { profile } : {}),
    help,
  };
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new ArgumentError(`${flag} requires a value.`);
  }
  return value;
}

function coerceValue(value: string, type: string | undefined): unknown {
  if (type === 'int') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) throw new ArgumentError(`Expected integer value, got "${value}".`);
    return parsed;
  }
  if (type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new ArgumentError(`Expected number value, got "${value}".`);
    return parsed;
  }
  if (type === 'bool' || type === 'boolean') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    throw new ArgumentError(`Expected boolean value, got "${value}".`);
  }
  return value;
}
