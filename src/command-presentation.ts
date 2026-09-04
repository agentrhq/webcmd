import { CLI_COMMAND } from './brand.js';
import { JSON_FORMAT_ALIAS_HELP, OUTPUT_FORMAT_HELP, OUTPUT_FORMATS } from './command-surface.js';
import type { Arg } from './registry.js';

export interface PresentableCommand {
  site: string;
  name: string;
  aliases: string[];
  description: string;
  access: 'read' | 'write';
  strategy: string;
  availability?: string;
  browser: boolean;
  args: readonly Arg[];
  columns: readonly string[];
  tags?: readonly string[];
  keywords?: readonly string[];
  defaultFormat?: string;
  domain?: string;
  example?: string;
  siteSession?: string;
  origin?: string;
}

export interface PresentableCommandSource {
  site: string;
  name: string;
  aliases?: readonly string[];
  description: string;
  access: string;
  strategy?: string;
  browser?: boolean;
  args: readonly Arg[];
  columns?: readonly string[];
  tags?: readonly string[];
  keywords?: readonly string[];
  defaultFormat?: string | null;
  domain?: string | null;
  example?: string;
  siteSession?: string;
}

export interface RootHelpCommand {
  name: string;
  description: string;
}

export interface RootHelpOption {
  flags: string;
  description: string;
}

export interface RootHelpGroup {
  label: string;
  items: readonly string[];
}

export interface RootHelpPresentation {
  description: string;
  usage?: readonly string[];
  commands: readonly RootHelpCommand[];
  options: readonly RootHelpOption[];
  /**
   * @deprecated Ignored by formatRootHelp. Kept so older callers that still
   * attach Commander base text compile until they drop the field.
   */
  baseText?: string;
  groups?: readonly RootHelpGroup[];
  examples?: readonly string[];
  agents?: readonly string[];
  footer?: readonly string[];
  localOnlyCommands?: readonly RootHelpCommand[];
  localOnlyExplanation?: string;
}

export interface FormatRootHelpOptions {
  /** Force ANSI color on/off. Defaults to TTY + NO_COLOR/FORCE_COLOR rules. */
  color?: boolean;
  /** Terminal width for wrapping dynamic lists. Defaults to process.stdout.columns. */
  columns?: number;
}

/** Banner from ascii.md — WEB (white) + CMD (#56C5FF) when color is on. */
export const ROOT_HELP_BANNER_PARTS = [
  ['ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ', 'ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ'],
  ['██╗    ██╗███████╗██████╗  ', '██████╗███╗   ███╗██████╗'],
  ['██║    ██║██╔════╝██╔══██╗', '██╔════╝████╗ ████║██╔══██╗'],
  ['██║ █╗ ██║█████╗  ██████╔╝', '██║     ██╔████╔██║██║  ██║'],
  ['██║███╗██║██╔══╝  ██╔══██╗', '██║     ██║╚██╔╝██║██║  ██║'],
  ['╚███╔███╔╝███████╗██████╔╝', '╚██████╗██║ ╚═╝ ██║██████╔╝'],
  [' ╚══╝╚══╝ ╚══════╝╚═════╝  ', '╚═════╝╚═╝     ╚═╝╚═════╝'],
] as const;

export const ROOT_HELP_BANNER = ROOT_HELP_BANNER_PARTS
  .map(([web, cmd]) => `${web}${cmd}`)
  .join('\n');

interface RootHelpCommandSection {
  title: string;
  order: readonly string[];
}

const ROOT_HELP_COMMAND_SECTIONS: readonly RootHelpCommandSection[] = [
  { title: 'CORE', order: ['site', 'list', 'web'] },
  { title: 'BROWSER', order: ['browser', 'session', 'profile', 'tab'] },
  { title: 'SYSTEM', order: ['auth', 'daemon', 'doctor', 'update', 'setup', 'artifact'] },
  { title: 'EXTENSIONS', order: ['skills', 'plugin', 'adapter', 'external'] },
  { title: 'DEVELOPMENT', order: ['validate', 'verify', 'convention-audit'] },
  { title: 'COMPLETION', order: ['completion'] },
];

/** Brand accent from docs theme (`colors.light`). */
const ACCENT_RGB = { r: 0x56, g: 0xc5, b: 0xff } as const;

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  white: '\u001b[97m',
  accent: `\u001b[38;2;${ACCENT_RGB.r};${ACCENT_RGB.g};${ACCENT_RGB.b}m`,
} as const;

function formatRootHelpBanner(color: boolean): string {
  if (!color) return ROOT_HELP_BANNER;
  return ROOT_HELP_BANNER_PARTS
    .map(([web, cmd]) => `${paint(web, true, ANSI.white)}${paint(cmd, true, ANSI.accent)}`)
    .join('\n');
}

function rootHelpColorEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR === '0') return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '') return true;
  return process.stdout.isTTY === true;
}

function paint(text: string, enabled: boolean, ...codes: string[]): string {
  if (!enabled || codes.length === 0) return text;
  return `${codes.join('')}${text}${ANSI.reset}`;
}

function commandRootName(name: string): string {
  return name.trim().split(/\s+/, 1)[0] ?? name;
}

function sortCommandsForSection(
  commands: readonly RootHelpCommand[],
  preferredOrder: readonly string[],
): RootHelpCommand[] {
  const rank = new Map(preferredOrder.map((name, index) => [name, index]));
  return [...commands].sort((left, right) => {
    const leftRoot = commandRootName(left.name);
    const rightRoot = commandRootName(right.name);
    const leftRank = rank.get(leftRoot) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(rightRoot) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.name.localeCompare(right.name);
  });
}

function groupRootHelpCommands(
  commands: readonly RootHelpCommand[],
): { title: string; commands: RootHelpCommand[] }[] {
  const remaining = new Map<string, RootHelpCommand[]>();
  for (const command of commands) {
    const root = commandRootName(command.name);
    const bucket = remaining.get(root) ?? [];
    bucket.push(command);
    remaining.set(root, bucket);
  }

  const sections: { title: string; commands: RootHelpCommand[] }[] = [];
  for (const section of ROOT_HELP_COMMAND_SECTIONS) {
    const matched: RootHelpCommand[] = [];
    for (const name of section.order) {
      const items = remaining.get(name);
      if (!items) continue;
      matched.push(...items);
      remaining.delete(name);
    }
    if (matched.length) sections.push({ title: section.title, commands: sortCommandsForSection(matched, section.order) });
  }

  if (remaining.size > 0) {
    const other = [...remaining.values()].flat().sort((a, b) => a.name.localeCompare(b.name));
    sections.push({ title: 'OTHER', commands: other });
  }
  return sections;
}

function defaultRootHelpExamples(): string[] {
  return [
    `${CLI_COMMAND} list`,
    `${CLI_COMMAND} <site> --help`,
    `${CLI_COMMAND} --session <session-id> browser tabs`,
    `${CLI_COMMAND} github whoami -f yaml`,
  ];
}

function defaultRootHelpAgents(): string[] {
  return [
    `${CLI_COMMAND} <site> --help -f yaml`,
    `${CLI_COMMAND} list -f yaml`,
    `${CLI_COMMAND} <site> <command> -f yaml`,
  ];
}

export interface CommandListPresentation {
  rows: Record<string, unknown>[];
  columns: string[];
  structured: boolean;
  displayLines?: string[];
}

export interface PresentableExternalCli {
  label: string;
  installed: boolean;
  description?: string;
}

export interface CompletableCommand {
  site: string;
  name: string;
  aliases?: readonly string[];
}

const COMMON_OPTIONS = [
  {
    flags: '-f, --format <fmt>',
    name: 'format',
    help: OUTPUT_FORMAT_HELP,
    default: 'table',
    choices: [...OUTPUT_FORMATS],
  },
  {
    flags: '--json',
    name: 'json',
    help: JSON_FORMAT_ALIAS_HELP,
    default: false,
  },
  {
    flags: '--trace <mode>',
    name: 'trace',
    help: 'Trace capture: off, on, retain-on-failure',
    default: 'off',
    choices: ['off', 'on', 'retain-on-failure'],
  },
  {
    flags: '-v, --verbose',
    name: 'verbose',
    help: 'Debug output',
    default: false,
  },
  {
    flags: '-h, --help',
    name: 'help',
    help: 'display help for command',
  },
] as const;

const BROWSER_COMMON_OPTIONS = [
  {
    flags: '--window <mode>',
    name: 'window',
    help: 'Browser window mode: foreground or background (default: background)',
    choices: ['foreground', 'background'],
  },
  {
    flags: '--site-session <mode>',
    name: 'site-session',
    help: 'Adapter site session lifecycle: ephemeral or persistent',
    choices: ['ephemeral', 'persistent'],
  },
  {
    flags: '--keep-tab <bool>',
    name: 'keep-tab',
    help: 'Keep the browser tab lease after the command finishes',
    choices: ['true', 'false'],
  },
] as const;

export function toPresentableCommand(command: PresentableCommandSource): PresentableCommand {
  return {
    site: command.site,
    name: command.name,
    aliases: [...(command.aliases ?? [])],
    description: command.description,
    access: command.access === 'write' ? 'write' : 'read',
    strategy: (command.strategy ?? 'public').toLowerCase(),
    browser: command.browser === true,
    args: command.args.map((arg) => ({ ...arg, ...(arg.choices ? { choices: [...arg.choices] } : {}) })),
    columns: [...(command.columns ?? [])],
    ...(command.tags?.length ? { tags: [...command.tags] } : {}),
    ...(command.keywords?.length ? { keywords: [...command.keywords] } : {}),
    ...(command.defaultFormat ? { defaultFormat: command.defaultFormat } : {}),
    ...(command.domain ? { domain: command.domain } : {}),
    ...(command.example ? { example: command.example } : {}),
    ...(command.siteSession ? { siteSession: command.siteSession } : {}),
  };
}

export function formatRootHelp(
  presentation: RootHelpPresentation,
  opts: FormatRootHelpOptions = {},
): string {
  const color = rootHelpColorEnabled(opts.color);
  const wrapWidth = Math.max(opts.columns ?? process.stdout.columns ?? 100, 40);
  const usage = presentation.usage ?? [
    `${CLI_COMMAND} [options] [command]`,
    `${CLI_COMMAND} <site> <command> [args] [options]`,
    `${CLI_COMMAND} list [options]`,
  ];
  const examples = presentation.examples ?? defaultRootHelpExamples();
  const agents = presentation.agents ?? defaultRootHelpAgents();
  const sectionHeading = (title: string): string => paint(title, color, ANSI.bold, ANSI.accent);
  const dim = (text: string): string => paint(text, color, ANSI.dim);

  // Visible spacer between the ASCII banner and the tagline (Hangul filler).
  const banner = formatRootHelpBanner(color).replace(/(?:\r?\n[ \t]*)+$/g, '');
  const lines: string[] = [
    banner,
    'ㅤ',
    `  ${paint(presentation.description, color, ANSI.dim)}`,
    '',
    sectionHeading('USAGE'),
    ...usage.map((entry) => `  ${entry}`),
    '',
  ];

  for (const section of groupRootHelpCommands(presentation.commands)) {
    lines.push(sectionHeading(section.title));
    lines.push(...formatStyledRows(
      section.commands.map((command) => ({ left: command.name, right: command.description })),
      { color, emphasizeLeft: true },
    ));
    lines.push('');
  }

  if (presentation.options.length) {
    lines.push(sectionHeading('GLOBAL OPTIONS'));
    lines.push(...formatStyledRows(
      presentation.options.map((option) => ({ left: option.flags, right: option.description })),
      { color, emphasizeLeft: true },
    ));
    lines.push('');
  }

  if (presentation.localOnlyCommands?.length) {
    lines.push(sectionHeading('LOCAL-ONLY'));
    lines.push(...formatStyledRows(
      presentation.localOnlyCommands.map((command) => ({ left: command.name, right: command.description })),
      { color, emphasizeLeft: true },
    ));
    if (presentation.localOnlyExplanation) lines.push(`  ${dim(presentation.localOnlyExplanation)}`);
    lines.push('');
  }

  for (const group of presentation.groups ?? []) {
    if (group.items.length === 0) continue;
    lines.push(sectionHeading(group.label));
    lines.push(wrapCommaList(group.items, { width: wrapWidth, indent: '  ' }));
    lines.push('');
  }

  if (examples.length) {
    lines.push(sectionHeading('EXAMPLES'));
    for (const example of examples) lines.push(`  ${example}`);
    lines.push('');
  }

  if (agents.length) {
    lines.push(sectionHeading('AGENTS'));
    for (const tip of agents) lines.push(`  ${tip}`);
    lines.push('');
  }

  if (presentation.footer?.length) {
    for (const line of presentation.footer) lines.push(line);
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export function commandListRows(
  commands: readonly PresentableCommand[],
  structured: boolean,
): Record<string, unknown>[] {
  return uniqueCommands(commands).map((command) => {
    if (structured) {
      return {
        command: commandFullName(command),
        site: command.site,
        name: command.name,
        aliases: [...command.aliases],
        description: command.description,
        access: command.access,
        strategy: command.strategy,
        ...(command.availability ? { availability: command.availability } : {}),
        browser: command.browser,
        args: command.args.map(serializePresentableArg),
        columns: [...command.columns],
        ...(command.tags?.length ? { tags: [...command.tags] } : {}),
        ...(command.keywords?.length ? { keywords: [...command.keywords] } : {}),
        domain: command.domain ?? null,
        example: formatPresentableCommandExample(command),
        defaultFormat: command.defaultFormat ?? null,
        siteSession: command.siteSession ?? null,
        ...(command.origin ? { origin: command.origin } : {}),
      };
    }
    return {
      command: commandFullName(command),
      site: command.site,
      name: command.name,
      aliases: command.aliases.join(', '),
      description: command.description,
      access: command.access,
      strategy: command.strategy,
      ...(command.availability ? { availability: command.availability } : {}),
      browser: command.browser,
      args: formatArgumentSummary(command.args),
    };
  });
}

export function filterCommandsByTag<T extends { tags?: readonly string[] }>(
  commands: readonly T[],
  tag?: string,
): T[] {
  const wanted = tag?.trim().toLowerCase();
  if (!wanted) return [...commands];
  return commands.filter((command) =>
    command.tags?.some((value) => value.toLowerCase() === wanted));
}

export function commandListPresentation(
  commands: readonly PresentableCommand[],
  format: string,
  options: { externalClis?: readonly PresentableExternalCli[] } = {},
): CommandListPresentation {
  const structured = format === 'json' || format === 'yaml';
  const unique = uniqueCommands(commands);
  return {
    rows: commandListRows(unique, structured),
    columns: [
      'command',
      'site',
      'name',
      'aliases',
      'description',
      'access',
      'strategy',
      ...(unique.some((command) => command.availability) ? ['availability'] : []),
      'browser',
      'args',
      ...(unique.some((command) => command.origin) ? ['origin'] : []),
      ...(structured ? ['columns', 'domain'] : []),
    ],
    structured,
    ...(format === 'table'
      ? { displayLines: formatGroupedCommandList(unique, options.externalClis ?? []) }
      : {}),
  };
}

export type AdapterKind = 'site' | 'app';

function isLocalIpDomain(domain: string): boolean {
  if (domain === '::1' || domain === '[::1]') return true;
  const ipPart = domain.split(':')[0];
  const parts = ipPart.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
    && Number(parts[0]) === 127;
}

export function classifyAdapterDomain(domain: string | undefined): AdapterKind {
  if (!domain) return 'site';
  if (isLocalIpDomain(domain)) return 'app';
  return domain.includes('.') ? 'site' : 'app';
}

function formatGroupedCommandList(
  commands: readonly PresentableCommand[],
  externalClis: readonly PresentableExternalCli[],
): string[] {
  const appsBySite = new Map<string, PresentableCommand[]>();
  const sitesBySite = new Map<string, PresentableCommand[]>();
  for (const command of commands) {
    const target = classifyAdapterDomain(command.domain) === 'app' ? appsBySite : sitesBySite;
    const group = target.get(command.site) ?? [];
    group.push(command);
    target.set(command.site, group);
  }

  const lines = ['', `  ${CLI_COMMAND} — available commands`, ''];
  const appendAdapterSection = (label: string, groups: ReadonlyMap<string, PresentableCommand[]>): void => {
    if (groups.size === 0) return;
    lines.push(`  ${label}`, '');
    for (const [site, siteCommands] of groups) {
      lines.push(`  ${site}`);
      for (const command of siteCommands) {
        const aliases = command.aliases.length > 0 ? ` (aliases: ${command.aliases.join(', ')})` : '';
        lines.push(
          `    ${command.name} [${command.strategy}]${command.availability ? ` [${command.availability}]` : ''}${aliases}`
          + `${command.description ? ` — ${command.description}` : ''}`
          + `${command.origin ? ` [${command.origin}]` : ''}`,
        );
      }
      lines.push('');
    }
  };

  appendAdapterSection('App adapters', appsBySite);
  appendAdapterSection('Site adapters', sitesBySite);
  if (externalClis.length > 0) {
    lines.push('  external CLIs');
    for (const external of externalClis) {
      const tag = external.installed ? '[installed]' : '[auto-install]';
      lines.push(`    ${external.label} ${tag}${external.description ? ` — ${external.description}` : ''}`);
    }
    lines.push('');
  }
  lines.push(
    `  ${commands.length} built-in commands across ${appsBySite.size} apps + ${sitesBySite.size} sites, `
    + `${externalClis.length} external CLIs`,
    '',
  );
  if (sitesBySite.size === 0) {
    lines.push(
      `  No site plugins installed. Find one with '${CLI_COMMAND} plugin search <site>'`
      + ` and install it with '${CLI_COMMAND} plugin install <installSource>'.`,
      '',
    );
  }
  return lines;
}

export function getCommandCompletionCandidates(
  commands: readonly CompletableCommand[],
  words: readonly string[],
  cursor: number,
  builtins: readonly string[],
): string[] {
  if (cursor <= 1) {
    const sites = new Set(commands.map((command) => command.site));
    return [...builtins, ...sites].sort();
  }

  const site = words[0];
  if (!site || builtins.includes(site)) return [];
  if (cursor !== 2) return [];

  return [...new Set(commands
    .filter((command) => command.site === site)
    .flatMap((command) => [command.name, ...(command.aliases ?? [])]))]
    .sort();
}

export function formatCommandListTerm(command: PresentableCommand): string {
  const positionalText = formatPositionals(positionals(command));
  const optionText = commandOptions(command).length > 0 ? ' [options]' : '';
  return `${command.name}${positionalText ? ` ${positionalText}` : ''}${optionText}`;
}

export function siteHelpData(site: string, commands: readonly PresentableCommand[]): Record<string, unknown> {
  const unique = commandsForSite(site, commands);
  return {
    site,
    command_count: unique.length,
    commands: unique.map(compactCommand),
    common_options: COMMON_OPTIONS.map(compactCommonOption),
    ...(unique.some((command) => command.browser)
      ? { browser_common_options: BROWSER_COMMON_OPTIONS.map(compactCommonOption) }
      : {}),
    next: [
      `${CLI_COMMAND} ${site} <command> --help -f yaml`,
      `${CLI_COMMAND} ${site} <command> -f yaml`,
    ],
  };
}

export function commandHelpData(command: PresentableCommand): Record<string, unknown> {
  return {
    site: command.site,
    ...compactCommand(command),
    common_options: COMMON_OPTIONS.map(compactCommonOption),
    ...(command.browser ? { browser_common_options: BROWSER_COMMON_OPTIONS.map(compactCommonOption) } : {}),
    output_formats: ['table', 'plain', 'yaml', 'json', 'md', 'csv'],
  };
}

export function formatCommonOptionsHelp(): string {
  const rows = COMMON_OPTIONS.map((option) => {
    const details: string[] = [option.help];
    if ('default' in option) details.push(`default: ${option.default}`);
    if ('choices' in option) details.push(`choices: ${option.choices.join(', ')}`);
    return [option.flags, details.join('  ')] as [string, string];
  });
  return ['Common options:', ...formatRows(rows)].join('\n');
}

export function formatBrowserCommonOptionsHelp(): string {
  const rows = BROWSER_COMMON_OPTIONS.map((option) => {
    const details: string[] = [option.help];
    if ('choices' in option) details.push(`choices: ${option.choices.join(', ')}`);
    return [option.flags, details.join('  ')] as [string, string];
  });
  return ['Browser common options:', ...formatRows(rows)].join('\n');
}

export function formatSiteHelp(site: string, commands: readonly PresentableCommand[]): string {
  const unique = commandsForSite(site, commands);
  const lines: string[] = [
    `Usage: ${CLI_COMMAND} ${site} <command> [args] [options]`,
    '',
    wrapCommaList(unique.map((command) => command.name), { indent: '' }),
    '',
    'Commands:',
    ...formatRows(unique.map((command) => [formatCommandListTerm(command), formatSiteCommandDescription(command)])),
    '',
    formatCommonOptionsHelp(),
    ...(unique.some((command) => command.browser) ? ['', formatBrowserCommonOptionsHelp()] : []),
    '',
    `Agent tip: use '${CLI_COMMAND} ${site} --help -f yaml' to get all command args/options in one structured response.`,
    '',
  ];
  return lines.join('\n');
}

export function formatCommandHelp(command: PresentableCommand): string {
  const lines: string[] = [
    `Usage: ${formatUsage(command)}`,
    '',
    command.description,
    '',
  ];

  const positionalRows = positionals(command).map((arg) => [
    arg.name,
    formatArgHelp(arg),
  ] as [string, string]);
  if (positionalRows.length) lines.push('Arguments:', ...formatRows(positionalRows), '');

  const optionRows = commandOptions(command).map((arg) => [
    formatCommandOptionTerm(arg),
    formatArgHelp(arg),
  ] as [string, string]);
  if (optionRows.length) lines.push('Command options:', ...formatRows(optionRows), '');

  lines.push(formatCommonOptionsHelp(), '');
  if (command.browser) lines.push(formatBrowserCommonOptionsHelp(), '');

  const meta = [
    `Access: ${command.access}`,
    `Browser: ${command.browser ? 'yes' : 'no'}`,
  ];
  if (command.domain) meta.push(`Domain: ${command.domain}`);
  if (command.defaultFormat) meta.push(`Default format: ${command.defaultFormat}`);
  if (command.aliases.length) meta.push(`Aliases: ${command.aliases.join(', ')}`);
  lines.push(meta.join(' | '));
  lines.push(`Example: ${formatPresentableCommandExample(command)}`);
  if (command.columns.length) lines.push(`Output columns: ${command.columns.join(', ')}`);
  lines.push("Agent tip: use '--help -f yaml' for structured args/options.", '');
  return lines.join('\n');
}

export function formatSiteCommandDescription(command: PresentableCommand): string {
  return `${command.access === 'write' ? '[write]' : '[read]'} ${command.description}`;
}

export function wrapCommaList(
  items: readonly string[],
  opts: { width?: number; indent?: string } = {},
): string {
  const width = Math.max(opts.width ?? process.stdout.columns ?? 100, 40);
  const indent = opts.indent ?? '  ';
  const sorted = [...items].sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];
  let line = indent;

  sorted.forEach((item, index) => {
    const token = `${item}${index < sorted.length - 1 ? ',' : ''}`;
    const prefix = line === indent ? '' : ' ';
    if (line.length + prefix.length + token.length > width && line.trim()) {
      lines.push(line);
      line = `${indent}${token}`;
    } else {
      line += `${prefix}${token}`;
    }
  });
  if (line.trim()) lines.push(line);
  return lines.join('\n');
}

function commandFullName(command: Pick<PresentableCommand, 'site' | 'name'>): string {
  return `${command.site}/${command.name}`;
}

function uniqueCommands(commands: readonly PresentableCommand[]): PresentableCommand[] {
  return [...new Map(commands.map((command) => [commandFullName(command), command])).values()]
    .sort((a, b) => commandFullName(a).localeCompare(commandFullName(b)));
}

function commandsForSite(site: string, commands: readonly PresentableCommand[]): PresentableCommand[] {
  return uniqueCommands(commands.filter((command) => command.site === site))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function positionals(command: PresentableCommand): Arg[] {
  return command.args.filter((arg) => arg.positional);
}

function commandOptions(command: PresentableCommand): Arg[] {
  return command.args.filter((arg) => !arg.positional);
}

function formatPositionals(args: readonly Arg[]): string {
  return args.map((arg) => arg.required ? `<${arg.name}>` : `[${arg.name}]`).join(' ');
}

function formatCommandOptionTerm(arg: Arg): string {
  return arg.required || arg.valueRequired ? `--${arg.name} <value>` : `--${arg.name} [value]`;
}

function formatUsage(command: PresentableCommand): string {
  const positionalText = formatPositionals(positionals(command));
  return `${CLI_COMMAND} ${command.site} ${command.name}${positionalText ? ` ${positionalText}` : ''} [options]`;
}

function compactCommand(command: PresentableCommand): Record<string, unknown> {
  return {
    name: command.name,
    command: `${CLI_COMMAND} ${command.site} ${command.name}`,
    usage: formatUsage(command),
    access: command.access,
    description: command.description,
    browser: command.browser,
    ...(command.domain ? { domain: command.domain } : {}),
    ...(command.aliases.length ? { aliases: [...command.aliases] } : {}),
    positionals: positionals(command).map(compactArg),
    command_options: commandOptions(command).map(compactArg),
    ...(command.browser ? { browser_common_options: BROWSER_COMMON_OPTIONS.map(compactCommonOption) } : {}),
    example: formatPresentableCommandExample(command),
    ...(command.siteSession ? { siteSession: command.siteSession } : {}),
    ...(command.defaultFormat ? { defaultFormat: command.defaultFormat } : {}),
    ...(command.columns.length ? { columns: [...command.columns] } : {}),
  };
}

function compactArg(arg: Arg): Record<string, unknown> {
  return {
    name: arg.name,
    ...(arg.type && arg.type !== 'string' ? { type: arg.type } : {}),
    ...(arg.positional ? { positional: true } : {}),
    ...(arg.required ? { required: true } : {}),
    ...(arg.valueRequired ? { valueRequired: true } : {}),
    ...(arg.default !== undefined ? { default: arg.default } : {}),
    ...(arg.choices?.length ? { choices: [...arg.choices] } : {}),
    ...(arg.help ? { help: arg.help } : {}),
  };
}

function compactCommonOption(option: typeof COMMON_OPTIONS[number] | typeof BROWSER_COMMON_OPTIONS[number]): Record<string, unknown> {
  return {
    name: option.name,
    flags: option.flags,
    help: option.help,
    ...('default' in option ? { default: option.default } : {}),
    ...('choices' in option ? { choices: [...option.choices] } : {}),
  };
}

export function serializePresentableArg(arg: Arg): Record<string, unknown> {
  return {
    name: arg.name,
    type: arg.type ?? 'string',
    required: !!arg.required,
    valueRequired: !!arg.valueRequired,
    positional: !!arg.positional,
    choices: [...(arg.choices ?? [])],
    default: arg.default ?? null,
    help: arg.help ?? '',
  };
}

export function formatArgumentSummary(args: readonly Arg[]): string {
  return args.map((arg) => {
    if (arg.positional) return arg.required ? `<${arg.name}>` : `[${arg.name}]`;
    return arg.required ? `--${arg.name}` : `[--${arg.name}]`;
  }).join(' ');
}

export function formatPresentableCommandExample(command: PresentableCommand): string {
  if (command.example?.trim()) return command.example.trim();
  const parts = [CLI_COMMAND, command.site, command.name];
  for (const arg of command.args) {
    if (arg.positional && arg.required) parts.push(`<${arg.name}>`);
  }
  for (const arg of command.args) {
    if (arg.positional || !arg.required) continue;
    parts.push(`--${arg.name}`);
    if (arg.type !== 'bool' && arg.type !== 'boolean') parts.push(`<${arg.name}>`);
  }
  parts.push('-f', 'yaml');
  return parts.join(' ');
}

function formatRows(rows: readonly (readonly [string, string])[]): string[] {
  if (rows.length === 0) return [];
  const width = Math.min(Math.max(...rows.map(([left]) => left.length)), 34);
  return rows.map(([left, right]) => `  ${left.padEnd(width + 2)}${right}`);
}

function formatStyledRows(
  rows: readonly { left: string; right: string }[],
  opts: { color: boolean; emphasizeLeft?: boolean },
): string[] {
  if (rows.length === 0) return [];
  const width = Math.min(Math.max(...rows.map((row) => row.left.length), 0), 34);
  return rows.map((row) => {
    const padded = row.left.padEnd(width + 2);
    const left = opts.emphasizeLeft ? paint(padded, opts.color, ANSI.bold) : padded;
    const right = paint(row.right, opts.color, ANSI.dim);
    return `  ${left}${right}`;
  });
}

function formatArgHelp(arg: Arg): string {
  const parts: string[] = [];
  if (arg.help) parts.push(arg.help);
  if (arg.default !== undefined) parts.push(`default: ${arg.default}`);
  if (arg.choices?.length) parts.push(`choices: ${arg.choices.join(', ')}`);
  return parts.join('  ');
}
