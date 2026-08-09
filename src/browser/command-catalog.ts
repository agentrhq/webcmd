import { InvalidArgumentError } from 'commander';
import type {
  HostedArgumentContract,
  HostedBrowserCommandContract,
  HostedSessionPolicy,
} from '../hosted/contract.js';

type ArgumentMetadata = {
  required?: boolean;
  default?: unknown;
};

function option(
  name: string,
  description: string,
  metadata: ArgumentMetadata = {},
): HostedArgumentContract {
  return {
    name,
    type: 'string',
    description,
    positional: false,
    required: metadata.required === true,
    variadic: false,
    ...(metadata.default !== undefined ? { default: metadata.default } : {}),
  };
}

function flag(name: string, description: string): HostedArgumentContract {
  return { name, type: 'boolean', description, positional: false, required: false, variadic: false };
}

function command(
  commandPath: string,
  description: string,
  action: NonNullable<HostedBrowserCommandContract['action']>,
  positionals: HostedArgumentContract[] = [],
  options: HostedArgumentContract[] = [],
  sessionPolicy: HostedSessionPolicy,
): HostedBrowserCommandContract {
  return { command: commandPath, aliases: [], description, action, positionals, options, sessionPolicy };
}

function runSnapshotModeParser(value: string): 'act' | 'tree' {
  if (value === 'act' || value === 'tree') return value;
  throw new InvalidArgumentError(`--snapshot-mode for run must be act or tree (got "${value}")`);
}

function snapshotModeParser(value: string): 'act' | 'tree' | 'read' {
  if (value === 'act' || value === 'tree' || value === 'read') return value;
  throw new InvalidArgumentError(`--snapshot-mode for snapshot must be act, tree, or read (got "${value}")`);
}

function positiveIntegerParser(optionName: string): (value: string) => number {
  return (value: string): number => {
    if (!/^\d+$/.test(value) || Number.parseInt(value, 10) <= 0) {
      throw new InvalidArgumentError(`--${optionName} must be a positive integer (got "${value}")`);
    }
    return Number.parseInt(value, 10);
  };
}

/** Exact local Commander flags for every catalogued browser option. */
export function browserOptionFlags(option: HostedArgumentContract, commandPath?: string): string {
  const longName = option.name.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
  if (option.type === 'boolean') return `--${longName}`;
  const valueName = option.name === 'page' ? 'id'
    : option.name === 'file' ? 'path'
      : option.name === 'timeout' && commandPath === 'run' ? 'seconds'
        : option.name === 'maxOutput' ? 'characters'
          : option.name === 'snapshotMode' ? 'mode'
          : option.name;
  return `--${longName} <${valueName}>`;
}

/** Shared positive-integer parser for browser-run limits. */
export function browserOptionValueParser(
  commandPath: string,
  optionName: string,
): ((value: string) => unknown) | undefined {
  if (commandPath === 'bind' && optionName === 'page') {
    return (value: string): string => {
      const page = value.trim();
      if (!page) throw new InvalidArgumentError('--page must be a non-empty stable page id');
      return page;
    };
  }
  if (optionName === 'snapshotMode' && commandPath === 'run') return runSnapshotModeParser;
  if (optionName === 'snapshotMode' && commandPath === 'snapshot') return snapshotModeParser;
  if ((commandPath === 'run' && ['timeout', 'maxOutput'].includes(optionName))
    || (commandPath === 'snapshot' && optionName === 'maxOutput')) {
    return positiveIntegerParser(optionName === 'maxOutput' ? 'max-output' : optionName);
  }
  return undefined;
}

export const browserCommandCatalog: readonly HostedBrowserCommandContract[] = [
  command('tabs', 'List pages in the existing browser session', 'tabs', [], [], 'require-existing'),
  command('bind', 'Bind this session to an existing page', 'bind', [], [
    option('page', 'Stable page id returned by tabs', { required: true }),
  ], 'require-existing'),
  command('fork', 'Fork an installed plugin command into a private copy', 'fork', [{
    name: 'name',
    type: 'string',
    description: 'Command to fork in site/command format',
    positional: true,
    required: true,
    variadic: false,
  }], [], 'require-existing'),
  command('run', 'Run JavaScript with Playwright', 'run', [], [
    flag('stdin', 'Read the program from stdin'),
    option('file', 'Read the program from a file'),
    option('timeout', 'Execution timeout in seconds'),
    option('maxOutput', 'Maximum returned characters'),
    option('snapshotMode', 'Snapshot mode for automatic diff: act or tree', { default: 'act' }),
    flag('noSnapshotDiff', 'Skip the automatic before/after snapshot diff'),
  ], 'create-or-reuse'),
  command('snapshot', 'Inspect the current page with a compact accessibility snapshot', 'snapshot', [], [
    option('snapshotMode', 'Snapshot mode: act, tree, or read', { default: 'act' }),
    option('ref', 'Render only the subtree rooted at this snapshot ref'),
    option('maxOutput', 'Maximum returned characters'),
  ], 'require-existing'),
  command('close', 'Close or detach this browser session', 'close-window', [], [], 'close-existing'),
] as const;
