import { Command, type Argument as CommanderArgument, type Option as CommanderOption } from 'commander';
import yaml from 'js-yaml';
import type { CliCommand } from './registry.js';
import { CLI_COMMAND } from './brand.js';
import {
  classifyAdapterDomain,
  commandHelpData as buildCommandHelpData,
  formatBrowserCommonOptionsHelp,
  formatCommandHelp,
  formatCommandListTerm as buildCommandListTerm,
  formatCommonOptionsHelp,
  formatSiteCommandDescription as buildSiteCommandDescription,
  formatSiteHelp,
  formatRootHelp,
  siteHelpData as buildSiteHelpData,
  toPresentableCommand,
  type RootHelpPresentation,
  wrapCommaList as wrapPresentationCommaList,
} from './command-presentation.js';

export type StructuredHelpFormat = 'yaml' | 'json';

export interface ArgSpec {
  name: string;
  required?: true;
  variadic?: true;
  help?: string;
  default?: unknown;
  choices?: string[];
}

export interface OptionSpec {
  name: string;
  flags: string;
  help?: string;
  takes_value?: 'required' | 'optional';
  required?: true;
  default?: unknown;
  choices?: string[];
  negate?: true;
}

function normalizeStructuredHelpFormat(value: string | undefined): StructuredHelpFormat | undefined {
  const normalized = value?.toLowerCase();
  if (normalized === 'yaml' || normalized === 'yml') return 'yaml';
  if (normalized === 'json') return 'json';
  return undefined;
}

export function getRequestedHelpFormat(argv: readonly string[] = process.argv): StructuredHelpFormat | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-f' || token === '--format') {
      return normalizeStructuredHelpFormat(argv[i + 1]);
    }
    if (token.startsWith('--format=')) {
      return normalizeStructuredHelpFormat(token.slice('--format='.length));
    }
    if (token.startsWith('-f') && token.length > 2) {
      return normalizeStructuredHelpFormat(token.slice(2));
    }
  }
  return undefined;
}

export function renderStructuredHelp(data: unknown, format: StructuredHelpFormat): string {
  if (format === 'json') return `${JSON.stringify(data, null, 2)}\n`;
  return yaml.dump(data, { sortKeys: false, lineWidth: 120, noRefs: true });
}

export function wrapCommaList(
  items: readonly string[],
  opts: { width?: number; indent?: string } = {},
): string {
  return wrapPresentationCommaList(items, opts);
}

/**
 * Adapter category for help-text grouping.
 *
 * - `site`: web site adapter (real DNS-style domain, e.g. `www.youtube.com`)
 * - `app`: desktop app adapter (Electron/osascript, signaled by `domain: 'localhost'`
 *   or other non-DNS/local endpoint string like `'127.0.0.1'` / `'custom-app'`)
 *
 * Classification is derived from the adapter's `domain` field — no new schema
 * required. Adapters without a `domain` field default to `site` (most are
 * public web scrapers).
 */
export type AdapterKind = 'site' | 'app';

export function classifyAdapter(domain: string | undefined): AdapterKind {
  return classifyAdapterDomain(domain);
}

export interface RootAdapterGroups {
  /** Externally-registered CLIs (docker, gh, vercel, ...) — passthrough binaries */
  external: readonly RootExternalCli[];
  /** Desktop-app adapters (chatgpt-app, chatwise, codex, ...) */
  apps: readonly string[];
  /** Web-site adapters (youtube, reddit, github, ...) */
  sites: readonly string[];
}

export interface RootExternalCli {
  name: string;
  label: string;
}

const installedRootHelpPresentations = new WeakMap<Command, RootHelpPresentation>();

export function buildRootHelpPresentation(program: Command, groups: RootAdapterGroups): RootHelpPresentation {
  const adapterNames = new Set<string>([...groups.external.map((cli) => cli.name), ...groups.apps, ...groups.sites]);
  const commanderHelp = program.createHelp();
  const options = commanderHelp.visibleOptions(program).map((option) => ({
    flags: option.flags,
    description: option.description,
  }));
  return {
    description: program.description(),
    usage: [`${program.name()} [options] [command]`],
    baseText: commanderHelp.formatHelp(program, commanderHelp),
    options,
    commands: program.commands
      .filter((command) => !adapterNames.has(command.name()))
      .map((command) => ({ name: command.name(), description: command.description() })),
    groups: [
      { label: `External CLIs (${groups.external.length})`, items: groups.external.map((cli) => cli.label) },
      { label: `App adapters (${groups.apps.length})`, items: groups.apps },
      { label: `Site adapters (${groups.sites.length})`, items: groups.sites },
    ],
    footer: [
      `Run '${CLI_COMMAND} list' for full command details, or '${CLI_COMMAND} <site> --help' to inspect one site.`,
      `Agent tip: use '${CLI_COMMAND} <site> --help -f yaml' for all command args/options in one structured response.`,
    ],
  };
}

export function getInstalledRootHelpPresentation(command: Command): RootHelpPresentation | undefined {
  return installedRootHelpPresentations.get(command);
}

export function installRootPresentationHelp(
  command: Command,
  data: () => unknown,
  presentation: RootHelpPresentation,
): void {
  installedRootHelpPresentations.set(command, presentation);
  command.helpInformation = (() => {
    const format = getRequestedHelpFormat();
    if (format) return renderStructuredHelp(data(), format);
    return formatRootHelp(presentation);
  }) as Command['helpInformation'];
}

function formatGroupSection(label: string, names: readonly string[]): string[] {
  if (names.length === 0) return [];
  return [
    `${label} (${names.length}):`,
    wrapCommaList(names),
    '',
  ];
}

export function formatRootAdapterHelpText(groups: RootAdapterGroups): string {
  const total = groups.external.length + groups.apps.length + groups.sites.length;
  if (total === 0) return '';
  const lines: string[] = [''];
  lines.push(...formatGroupSection('External CLIs', groups.external.map(cli => cli.label)));
  lines.push(...formatGroupSection('App adapters', groups.apps));
  lines.push(...formatGroupSection('Site adapters', groups.sites));
  lines.push(`Run '${CLI_COMMAND} list' for full command details, or '${CLI_COMMAND} <site> --help' to inspect one site.`);
  lines.push(`Agent tip: use '${CLI_COMMAND} <site> --help -f yaml' for all command args/options in one structured response.`);
  lines.push('');
  return lines.join('\n');
}

function compactCommanderArgument(arg: CommanderArgument): ArgSpec {
  return {
    name: arg.name(),
    ...(arg.required ? { required: true } : {}),
    ...(arg.variadic ? { variadic: true } : {}),
    ...(arg.description ? { help: arg.description } : {}),
    ...(arg.defaultValue !== undefined ? { default: arg.defaultValue } : {}),
    ...(arg.argChoices?.length ? { choices: [...arg.argChoices] } : {}),
  };
}

function compactCommanderOption(option: CommanderOption): OptionSpec | null {
  if (option.hidden) return null;
  return {
    name: option.attributeName(),
    flags: option.flags,
    ...(option.description ? { help: option.description } : {}),
    ...(option.required ? { takes_value: 'required' as const } : {}),
    ...(option.optional ? { takes_value: 'optional' as const } : {}),
    ...(option.mandatory ? { required: true } : {}),
    ...(option.defaultValue !== undefined ? { default: option.defaultValue } : {}),
    ...(option.argChoices?.length ? { choices: [...option.argChoices] } : {}),
    ...(option.negate ? { negate: true } : {}),
  };
}

function compactCommanderOptions(options: readonly CommanderOption[]): OptionSpec[] {
  return options
    .map(compactCommanderOption)
    .filter((option): option is OptionSpec => option !== null);
}

/**
 * Extracts a positional placeholder that should appear immediately after this
 * command's name in user-facing path strings. Reads the leading positional
 * (e.g. `<session>`) from a `.usage()` override; commands without a positional
 * override return `null` so the path stays as-is.
 *
 * Example: `browser` declares `.usage('<session> <command> [options]')`,
 * so `commanderPath(browserClickCmd)` becomes
 * `['webcmd', 'browser', '<session>', 'click']`.
 */
export function leadingPositionalFromUsage(command: Command): string | null {
  const usage = (command as Command & { _usage?: string })._usage;
  if (!usage) return null;
  const match = usage.match(/^\s*(<[^>]+>)/);
  return match ? match[1] : null;
}

function commanderPath(command: Command): string[] {
  const parts: string[] = [];
  let current: Command | null = command;
  while (current) {
    const name = current.name();
    if (name) {
      parts.push(name);
      // If this command declares a leading-positional usage override AND we
      // have already collected a child name below it, the positional must
      // appear between this command and the child (i.e. before the names
      // already collected). parts is in reverse order, so push to the end.
      const positional = leadingPositionalFromUsage(current);
      if (positional && parts.length > 1) {
        // We collected child names first (reverse order). Move them up by one
        // and put the positional at index `parts.length - 2` so reverse()
        // places it between this command and the first child name.
        parts.splice(parts.length - 1, 0, positional);
      }
    }
    current = current.parent;
  }
  return parts.reverse();
}

function commandPathFromRoot(namespaceRoot: Command, command: Command): string[] {
  const rootPath = commanderPath(namespaceRoot);
  const commandPath = commanderPath(command);
  // Strip placeholder positional segments (e.g. `<session>`) from the relative
  // name so agents can still address subcommands by their leaf name. Display
  // paths in `command` / `usage` still include the placeholders.
  return commandPath.slice(rootPath.length).filter(part => !/^<.+>$/.test(part));
}

function collectLeafCommands(command: Command): Command[] {
  if (command.commands.length === 0) return [command];
  return command.commands.flatMap(child => collectLeafCommands(child));
}

function collectDescendantCommands(command: Command): Command[] {
  return command.commands.flatMap(child => [child, ...collectDescendantCommands(child)]);
}

function formatCommanderPositionals(args: readonly CommanderArgument[]): string {
  return args
    .map(arg => {
      const name = `${arg.name()}${arg.variadic ? '...' : ''}`;
      return arg.required ? `<${name}>` : `[${name}]`;
    })
    .join(' ');
}

function formatCommanderUsage(
  command: Command,
  opts: { namespaceRoot?: Command; globalCommand?: Command } = {},
): string {
  const path = commanderPath(command).join(' ');
  const positionalText = formatCommanderPositionals(command.registeredArguments);
  const hasOptions = compactCommanderOptions(command.options).length > 0
    || (opts.namespaceRoot ? compactCommanderOptions(opts.namespaceRoot.options).length > 0 : false)
    || (opts.globalCommand ? compactCommanderOptions(opts.globalCommand.options).length > 0 : false);
  const optionText = hasOptions ? ' [options]' : '';
  return `${path}${positionalText ? ` ${positionalText}` : ''}${optionText}`;
}

function compactCommanderCommand(
  namespaceRoot: Command,
  command: Command,
  opts: { globalCommand?: Command } = {},
): Record<string, unknown> {
  const relativePath = commandPathFromRoot(namespaceRoot, command);
  return {
    name: relativePath.join(' '),
    command: commanderPath(command).join(' '),
    usage: formatCommanderUsage(command, { namespaceRoot, globalCommand: opts.globalCommand }),
    description: command.description(),
    ...(command.aliases().length ? { aliases: command.aliases() } : {}),
    positionals: command.registeredArguments.map(compactCommanderArgument),
    command_options: compactCommanderOptions(command.options),
  };
}

export function commanderNamespaceHelpData(
  namespaceRoot: Command,
  opts: { globalCommand?: Command; description?: string } = {},
): Record<string, unknown> {
  const leaves = collectLeafCommands(namespaceRoot)
    .filter(command => command !== namespaceRoot)
    .sort((a, b) => commandPathFromRoot(namespaceRoot, a).join(' ').localeCompare(commandPathFromRoot(namespaceRoot, b).join(' ')));
  // Respect commander's `.usage()` override (e.g. `<session> <command> [options]`
  // on `browser`); fall back to the generic `<command> [args] [options]` form.
  // Read the private `_usage` field directly because `.usage()` returns the
  // auto-generated form if no override was set.
  const commandPath = commanderPath(namespaceRoot).join(' ');
  const usageOverride = (namespaceRoot as Command & { _usage?: string })._usage;
  const usage = usageOverride
    ? `${commandPath} ${usageOverride}`
    : `${commandPath} <command> [args] [options]`;
  return {
    namespace: namespaceRoot.name(),
    command: commandPath,
    usage,
    description: opts.description ?? namespaceRoot.description(),
    command_count: leaves.length,
    commands: leaves.map(command => compactCommanderCommand(namespaceRoot, command, opts)),
    namespace_options: compactCommanderOptions(namespaceRoot.options),
    ...(opts.globalCommand ? { global_options: compactCommanderOptions(opts.globalCommand.options) } : {}),
    structured_help: {
      formats: ['yaml', 'json'],
      usage: `${commandPath} --help -f yaml`,
    },
  };
}

export function commanderCommandHelpData(
  namespaceRoot: Command,
  command: Command,
  opts: { globalCommand?: Command } = {},
): Record<string, unknown> {
  return {
    namespace: namespaceRoot.name(),
    ...compactCommanderCommand(namespaceRoot, command, opts),
    namespace_options: compactCommanderOptions(namespaceRoot.options),
    ...(opts.globalCommand ? { global_options: compactCommanderOptions(opts.globalCommand.options) } : {}),
    structured_help: {
      formats: ['yaml', 'json'],
      usage: `${commanderPath(command).join(' ')} --help -f yaml`,
    },
  };
}

export function commanderGroupHelpData(
  namespaceRoot: Command,
  groupCommand: Command,
  opts: { globalCommand?: Command } = {},
): Record<string, unknown> {
  const leaves = collectLeafCommands(groupCommand)
    .filter(command => command !== groupCommand)
    .sort((a, b) => commandPathFromRoot(namespaceRoot, a).join(' ').localeCompare(commandPathFromRoot(namespaceRoot, b).join(' ')));
  return {
    namespace: namespaceRoot.name(),
    group: commandPathFromRoot(namespaceRoot, groupCommand).join(' '),
    command: commanderPath(groupCommand).join(' '),
    usage: `${commanderPath(groupCommand).join(' ')} <command> [args] [options]`,
    description: groupCommand.description(),
    command_count: leaves.length,
    commands: leaves.map(command => compactCommanderCommand(namespaceRoot, command, opts)),
    namespace_options: compactCommanderOptions(namespaceRoot.options),
    ...(opts.globalCommand ? { global_options: compactCommanderOptions(opts.globalCommand.options) } : {}),
    structured_help: {
      formats: ['yaml', 'json'],
      usage: `${commanderPath(groupCommand).join(' ')} --help -f yaml`,
    },
  };
}

export function installCommanderNamespaceStructuredHelp(
  namespaceRoot: Command,
  opts: { globalCommand?: Command; description?: string } = {},
): void {
  installStructuredHelp(namespaceRoot, () => commanderNamespaceHelpData(namespaceRoot, opts));
  for (const command of collectDescendantCommands(namespaceRoot)) {
    if (command.commands.length > 0) {
      installStructuredHelp(command, () => commanderGroupHelpData(namespaceRoot, command, opts));
    } else {
      installStructuredHelp(command, () => commanderCommandHelpData(namespaceRoot, command, opts));
    }
  }
}

export function formatCommandListTerm(cmd: CliCommand): string {
  return buildCommandListTerm(toPresentableCommand(cmd));
}

export function rootHelpData(program: Command, groups: RootAdapterGroups): Record<string, unknown> {
  const adapterNames = new Set<string>([...groups.external.map(cli => cli.name), ...groups.apps, ...groups.sites]);
  const commands = program.commands
    .filter(command => !adapterNames.has(command.name()))
    .map(command => ({
      name: command.name(),
      description: command.description(),
    }));

  const sortLocale = (a: string, b: string) => a.localeCompare(b);
  return {
    name: program.name(),
    description: program.description(),
    commands,
    external_clis: {
      count: groups.external.length,
      clis: groups.external.map(cli => cli.name).sort(sortLocale),
      display: groups.external.map(cli => cli.label).sort(sortLocale),
    },
    app_adapters: {
      count: groups.apps.length,
      apps: [...groups.apps].sort(sortLocale),
    },
    site_adapters: {
      count: groups.sites.length,
      sites: [...groups.sites].sort(sortLocale),
    },
    next: [
      `${CLI_COMMAND} <site> --help -f yaml`,
      `${CLI_COMMAND} list -f yaml`,
      `${CLI_COMMAND} <site> <command> -f yaml`,
    ],
  };
}

export function siteHelpData(site: string, commands: readonly CliCommand[]): Record<string, unknown> {
  return buildSiteHelpData(site, commands.map(toPresentableCommand));
}

export function commandHelpData(cmd: CliCommand): Record<string, unknown> {
  return buildCommandHelpData(toPresentableCommand(cmd));
}

export function formatCommonOptionsHelpText(): string {
  return formatCommonOptionsHelp();
}

export function formatBrowserCommonOptionsHelpText(): string {
  return formatBrowserCommonOptionsHelp();
}

export function formatSiteHelpText(site: string, commands: readonly CliCommand[]): string {
  return formatSiteHelp(site, commands.map(toPresentableCommand));
}

export function formatCommandHelpText(cmd: CliCommand): string {
  return formatCommandHelp(toPresentableCommand(cmd));
}

export function installStructuredHelp(
  command: Command,
  data: () => unknown,
  textSuffix?: string | (() => string),
): void {
  const original = command.helpInformation.bind(command);
  command.helpInformation = ((contextOptions?: unknown) => {
    const format = getRequestedHelpFormat();
    if (format) return renderStructuredHelp(data(), format);
    const suffix = typeof textSuffix === 'function' ? textSuffix() : textSuffix ?? '';
    return original(contextOptions as never) + suffix;
  }) as Command['helpInformation'];
}

export function formatSiteCommandDescription(cmd: CliCommand): string {
  return buildSiteCommandDescription(toPresentableCommand(cmd));
}
