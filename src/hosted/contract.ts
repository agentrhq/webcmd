import { commandHelpData } from '../help.js';
import type { Arg, CliCommand } from '../registry.js';
import { browserCommandCatalog } from '../browser/command-catalog.js';
import {
  deriveBrowserAvailability,
  deriveHostedAvailability,
  type HostedAvailability,
} from './availability.js';

export const HOSTED_CONTRACT_SCHEMA_VERSION = 1 as const;

export type { HostedAvailability } from './availability.js';

export interface FileArgumentContract {
  direction: 'input' | 'output';
  pathKind: 'file' | 'directory';
  multiple?: boolean;
  separator?: ',';
  contentTypes?: string[];
  maxBytes?: number;
}

export interface HostedFileArgumentContract {
  name: string;
  direction: 'input' | 'output';
  pathKind: 'file' | 'directory';
  multiple: boolean;
  required: boolean;
  separator?: ',';
  contentTypes?: string[];
  maxBytes?: number;
}

export interface HostedArgumentContract {
  name: string;
  type: 'string' | 'int' | 'number' | 'boolean';
  description: string;
  positional: boolean;
  required: boolean;
  variadic: boolean;
  default?: unknown;
  choices?: string[];
}

export interface HostedOptionContract extends HostedArgumentContract {
  name: string;
  flags: string;
  positional: false;
}

export type HostedSessionPolicy =
  | 'create-or-reuse'
  | 'require-existing'
  | 'close-existing'
  | 'local-only';

export interface HostedBrowserCommandContract {
  command: string;
  aliases: string[];
  description: string;
  positionals: HostedArgumentContract[];
  options: HostedArgumentContract[];
  sessionPolicy: HostedSessionPolicy;
  action?: string;
}

export interface HostedContractCommand {
  command: string;
  site: string;
  name: string;
  description: string;
  access: 'read' | 'write';
  strategy: 'PUBLIC' | 'COOKIE' | 'INTERCEPT' | 'UI' | 'LOCAL';
  browser: boolean;
  domain?: string;
  positionals: HostedArgumentContract[];
  options: HostedArgumentContract[];
  columns: string[];
  aliases: string[];
  defaultFormat: string;
  example?: string;
  fileArguments: HostedFileArgumentContract[];
  sessionPolicy: HostedSessionPolicy;
  availability: HostedAvailability;
}

export interface HostedContract {
  schemaVersion: typeof HOSTED_CONTRACT_SCHEMA_VERSION;
  webcmdVersion: string;
  outputFormats: Array<'table' | 'plain' | 'json' | 'yaml' | 'md' | 'csv'>;
  traceModes: Array<'off' | 'on' | 'retain-on-failure'>;
  commonOptions: HostedOptionContract[];
  commands: HostedContractCommand[];
  browserCommands: HostedBrowserCommandContract[];
}

export interface HostedContractCommandInput {
  site: string;
  name: string;
  aliases?: string[];
  description: string;
  access: 'read' | 'write';
  example?: string;
  domain?: string;
  strategy?: string;
  browser?: boolean;
  args: Arg[];
  columns?: string[];
  defaultFormat?: CliCommand['defaultFormat'];
}

type SharedOption = {
  name: string;
  flags: string;
  help?: string;
  default?: unknown;
  choices?: string[];
};

const KNOWN_SESSION_POLICIES = new Set<HostedSessionPolicy>([
  'create-or-reuse',
  'require-existing',
  'close-existing',
  'local-only',
]);

function sharedContractOptions(): {
  outputFormats: HostedContract['outputFormats'];
  traceModes: HostedContract['traceModes'];
  commonOptions: HostedOptionContract[];
} {
  const metadata = commandHelpData({
    site: '__contract__',
    name: '__contract__',
    description: '',
    access: 'read',
    strategy: 'public',
    browser: false,
    args: [],
  } as CliCommand);
  const common = metadata.common_options as SharedOption[];
  const format = common.find(option => option.name === 'format');
  const trace = common.find(option => option.name === 'trace');
  if (!format?.choices || !trace?.choices) {
    throw new Error('Shared format and trace option choices are required');
  }

  return {
    outputFormats: [...format.choices] as HostedContract['outputFormats'],
    traceModes: [...trace.choices] as HostedContract['traceModes'],
    commonOptions: common.map(option => ({
      name: option.name,
      flags: option.flags,
      type: option.flags.includes('<') || option.flags.includes('[') ? 'string' : 'boolean',
      description: option.help ?? '',
      positional: false,
      required: false,
      variadic: false,
      ...(option.default !== undefined ? { default: option.default } : {}),
      ...(option.choices?.length ? { choices: [...option.choices] } : {}),
    })),
  };
}

function normalizeArgumentType(type: string | undefined): HostedArgumentContract['type'] {
  switch ((type ?? 'string').toLowerCase()) {
    case 'str':
    case 'string':
      return 'string';
    case 'bool':
    case 'boolean':
      return 'boolean';
    case 'int':
    case 'integer':
      return 'int';
    case 'number':
    case 'float':
      return 'number';
    default:
      throw new Error(`Unsupported hosted argument type: ${type}`);
  }
}

function normalizeArgument(arg: Arg): HostedArgumentContract {
  return {
    name: arg.name,
    type: normalizeArgumentType(arg.type),
    description: arg.help ?? '',
    positional: arg.positional === true,
    required: arg.required === true,
    variadic: false,
    ...(arg.default !== undefined ? { default: arg.default } : {}),
    ...(arg.choices?.length ? { choices: [...arg.choices] } : {}),
  };
}

function normalizeStrategy(command: HostedContractCommandInput): HostedContractCommand['strategy'] {
  const raw = command.strategy ?? (command.browser === false ? 'public' : 'cookie');
  const strategy = raw.toUpperCase();
  if (strategy === 'PUBLIC' || strategy === 'COOKIE' || strategy === 'INTERCEPT'
    || strategy === 'UI' || strategy === 'LOCAL') {
    return strategy;
  }
  throw new Error(`Unsupported hosted strategy for ${command.site}/${command.name}: ${raw}`);
}

function normalizeDefaultFormat(format: CliCommand['defaultFormat']): string {
  if (format === 'yml') return 'yaml';
  if (format === 'markdown') return 'md';
  return format ?? 'table';
}

function normalizeFileArguments(command: HostedContractCommandInput): HostedFileArgumentContract[] {
  return command.args.flatMap((arg) => {
    if (!arg.file) return [];
    if (arg.file.direction !== 'input' && arg.file.direction !== 'output') {
      throw new Error(`File argument ${command.site}/${command.name} ${arg.name} must declare direction`);
    }
    if (arg.file.pathKind !== 'file' && arg.file.pathKind !== 'directory') {
      throw new Error(`File argument ${command.site}/${command.name} ${arg.name} must declare pathKind`);
    }
    if (arg.file.separator !== undefined && arg.file.separator !== ',') {
      throw new Error(`File argument ${command.site}/${command.name} ${arg.name} declares unsupported separator`);
    }
    return [{
      name: arg.name,
      direction: arg.file.direction,
      pathKind: arg.file.pathKind,
      multiple: arg.file.multiple === true,
      required: arg.required === true,
      ...(arg.file.separator !== undefined ? { separator: arg.file.separator } : {}),
      ...(arg.file.contentTypes?.length ? { contentTypes: [...arg.file.contentTypes] } : {}),
      ...(arg.file.maxBytes !== undefined ? { maxBytes: arg.file.maxBytes } : {}),
    }];
  });
}

function assertUniqueAdapterCommands(commands: readonly HostedContractCommandInput[]): void {
  const canonical = new Set<string>();
  for (const command of commands) {
    const key = `${command.site}/${command.name}`;
    if (canonical.has(key)) throw new Error(`Duplicate canonical command: ${key}`);
    canonical.add(key);
  }

  const invocations = new Set(canonical);
  for (const command of commands) {
    for (const alias of command.aliases ?? []) {
      const key = `${command.site}/${alias}`;
      if (invocations.has(key)) throw new Error(`Duplicate command alias: ${key}`);
      invocations.add(key);
    }
  }
}

function normalizeBrowserCatalog(
  browserCatalog: readonly HostedBrowserCommandContract[],
): HostedBrowserCommandContract[] {
  const canonical = new Set<string>();
  for (const browserCommand of browserCatalog) {
    if (canonical.has(browserCommand.command)) {
      throw new Error(`Duplicate canonical browser command: ${browserCommand.command}`);
    }
    canonical.add(browserCommand.command);
    if (!KNOWN_SESSION_POLICIES.has(browserCommand.sessionPolicy)) {
      throw new Error(`Browser command ${browserCommand.command} must declare a known session policy`);
    }
    const availability = deriveBrowserAvailability(browserCommand.command);
    if (availability.mode === 'local-only' && browserCommand.sessionPolicy !== 'local-only') {
      throw new Error(`Browser command ${browserCommand.command} must use local-only session policy`);
    }
  }

  const invocations = new Set(canonical);
  for (const browserCommand of browserCatalog) {
    for (const alias of browserCommand.aliases ?? []) {
      if (invocations.has(alias)) throw new Error(`Duplicate browser command alias: ${alias}`);
      invocations.add(alias);
    }
  }

  return browserCatalog
    .map(browserCommand => ({
      command: browserCommand.command,
      aliases: [...(browserCommand.aliases ?? [])],
      description: browserCommand.description,
      positionals: browserCommand.positionals.map(arg => ({ ...arg })),
      options: browserCommand.options.map(arg => ({ ...arg })),
      sessionPolicy: browserCommand.sessionPolicy,
      ...(browserCommand.action !== undefined ? { action: browserCommand.action } : {}),
    }))
    .sort((a, b) => a.command.localeCompare(b.command));
}

export function buildHostedContract(
  commands: readonly HostedContractCommandInput[],
  browserCatalogInput: readonly HostedBrowserCommandContract[],
  packageVersion: string,
): HostedContract {
  assertUniqueAdapterCommands(commands);
  const browserCatalog = browserCatalogInput.length > 0
    ? browserCatalogInput
    : browserCommandCatalog;
  const shared = sharedContractOptions();
  const contractCommands = commands.map((command): HostedContractCommand => {
    const availability = deriveHostedAvailability(command);
    return {
      command: `${command.site}/${command.name}`,
      site: command.site,
      name: command.name,
      description: command.description,
      access: command.access,
      strategy: normalizeStrategy(command),
      browser: command.browser !== false,
      ...(command.domain !== undefined ? { domain: command.domain } : {}),
      positionals: command.args.filter(arg => arg.positional).map(normalizeArgument),
      options: command.args.filter(arg => !arg.positional).map(normalizeArgument),
      columns: [...(command.columns ?? [])],
      aliases: [...(command.aliases ?? [])],
      defaultFormat: normalizeDefaultFormat(command.defaultFormat),
      ...(command.example !== undefined ? { example: command.example } : {}),
      fileArguments: normalizeFileArguments(command),
      sessionPolicy: availability.mode === 'hosted' ? 'create-or-reuse' : 'local-only',
      availability,
    };
  }).sort((a, b) => a.command.localeCompare(b.command));

  return {
    schemaVersion: HOSTED_CONTRACT_SCHEMA_VERSION,
    webcmdVersion: packageVersion,
    outputFormats: shared.outputFormats,
    traceModes: shared.traceModes,
    commonOptions: shared.commonOptions,
    commands: contractCommands,
    browserCommands: normalizeBrowserCatalog(browserCatalog),
  };
}

export function serializeHostedContract(contract: HostedContract): string {
  return `${JSON.stringify(contract, null, 2)}\n`;
}
