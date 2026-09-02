import { Command, Option } from 'commander';
import {
  BROWSER_RUN_HELP_TEXT,
  browserCommandCatalog,
  browserOptionFlags,
  browserOptionValueParser,
} from '../browser/command-catalog.js';
import { addOutputFormatOption, CommanderStructuralError } from '../command-surface.js';
import { CliError, EXIT_CODES } from '../errors.js';
import { configureRootCommandSurface } from '../root-command-surface.js';
import { requireSessionIdShape } from '../browser/session-identifiers.js';

export class HostedBrowserHelp extends Error {
  constructor(readonly output: string) {
    super('Hosted browser help requested');
    this.name = 'HostedBrowserHelp';
  }
}

export interface ParsedHostedBrowserStructure {
  commandName?: string;
  positionals: string[];
  options: Record<string, unknown>;
  session?: string;
  window?: string;
  profile?: string;
}

export function validateRawBrowserSession(value: unknown, profile?: string): string {
  const session = typeof value === 'string' ? value.trim() : '';
  const profileFlag = profile?.trim() ? ` --profile ${profile.trim()}` : '';
  const help = `Create one: webcmd${profileFlag} session create <name>\nList sessions: webcmd${profileFlag} session list`;
  if (!session) throw new CliError('SESSION_REQUIRED', 'A Session selector is required for browser commands.', help, EXIT_CODES.USAGE_ERROR);
  requireSessionIdShape(session);
  return session;
}

/**
 * Parse the hosted browser argv with the exact canonical Commander grammar.
 * The returned values are the values produced by Commander's action boundary;
 * callers must not reinterpret the original argv with a second parser.
 */
export function parseHostedBrowserStructure(argv: readonly string[]): ParsedHostedBrowserStructure {
  const root = configureRootCommandSurface(new Command('webcmd'));
  const browser = root
    .command('browser')
    .description('Run Playwright programs against an explicit browser Session')
    ;

  let parsed: ParsedHostedBrowserStructure | undefined;
  const namespaces = new Map<string, Command>([['', browser]]);
  const namespaceDescriptions: Record<string, string> = {
    dialog: 'Handle a blocking JavaScript alert/confirm/prompt dialog',
    get: 'Get page properties',
    tab: 'Tab management — list, create, and close tabs in the browser session',
  };
  for (const contract of browserCommandCatalog) {
    const parts = contract.command.split('/');
    let parent = browser;
    let path = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      path = path ? `${path}/${parts[index]}` : parts[index]!;
      let namespace = namespaces.get(path);
      if (!namespace) {
        namespace = parent.command(parts[index]!);
        const description = namespaceDescriptions[path];
        if (description) namespace.description(description);
        namespaces.set(path, namespace);
      }
      parent = namespace;
    }

    const leafName = parts.at(-1)!;
    const leaf = parent.command(leafName).description(contract.description);
    for (const alias of contract.aliases) leaf.alias(alias);
    for (const positional of contract.positionals) {
      const suffix = positional.variadic ? '...' : '';
      leaf.argument(positional.required ? `<${positional.name}${suffix}>` : `[${positional.name}${suffix}]`, positional.description);
    }
    for (const option of contract.options) {
      const flags = browserOptionFlags(option, contract.command);
      if (option.type === 'boolean') {
        leaf.option(flags, option.description, option.default as boolean | undefined);
        continue;
      }
      const commanderOption = new Option(flags, option.description);
      if (option.required) commanderOption.makeOptionMandatory();
      if (option.choices?.length) commanderOption.choices(option.choices);
      if (option.default !== undefined) commanderOption.default(option.default);
      const valueParser = browserOptionValueParser(contract.command, option.name);
      if (valueParser) commanderOption.argParser(valueParser);
      leaf.addOption(commanderOption);
    }
    // Mirror the local grammar: the raw session leaves (the ones carrying `-v`)
    // have always emitted JSON, so `json` is their default format; `init` and
    // `verify` render like every other built-in.
    addOutputFormatOption(leaf, contract.options.some(option => option.name === 'verbose') ? 'json' : 'table');
    if (contract.command === 'run') {
      const originalHelpInformation = leaf.helpInformation.bind(leaf);
      leaf.helpInformation = ((contextOptions?: unknown) => (
        originalHelpInformation(contextOptions as never) + BROWSER_RUN_HELP_TEXT
      )) as Command['helpInformation'];
    }
    leaf.action((...actionArgs: unknown[]) => {
      const options = actionArgs[contract.positionals.length] as Record<string, unknown>;
      parsed = {
        commandName: contract.command,
        positionals: actionArgs.slice(0, contract.positionals.length).flatMap(value => {
          if (typeof value === 'string') return [value];
          if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
          return [];
        }),
        options: normalizeBrowserOptions(contract.command, options),
        ...readBrowserGlobals(root, browser),
      };
    });
  }

  let stderr = '';
  let stdout = '';
  const output = {
    writeErr: (value: string) => { stderr += value; },
    writeOut: (value: string) => { stdout += value; },
  };
  const configure = (command: Command): void => {
    command.exitOverride().configureOutput(output);
    for (const child of command.commands) configure(child);
  };
  configure(root);
  try {
    root.parse([...argv], { from: 'user' });
  } catch (error) {
    const commander = error as { code?: unknown; exitCode?: unknown; message?: unknown };
    if (commander.code === 'commander.helpDisplayed') throw new HostedBrowserHelp(stdout);
    throw new CommanderStructuralError(
      stderr || `${typeof commander.message === 'string' ? commander.message : String(error)}\n`,
      typeof commander.exitCode === 'number' ? commander.exitCode : 1,
    );
  }

  return parsed ?? {
    positionals: [],
    options: {},
    ...readBrowserGlobals(root, browser),
  };
}

function normalizeBrowserOptions(command: string, options: Record<string, unknown>): Record<string, unknown> {
  if (command !== 'run') return { ...options };
  const { json: _json, snapshotDiff, ...rest } = options;
  return snapshotDiff === false ? { ...rest, noSnapshotDiff: true } : rest;
}

function readBrowserGlobals(root: Command, browser: Command): Pick<
  ParsedHostedBrowserStructure,
  'session' | 'window' | 'profile'
> {
  const rootOptions = root.opts<Record<string, unknown>>();
  const browserOptions = browser.opts<Record<string, unknown>>();
  return {
    ...(typeof rootOptions.session === 'string' ? { session: rootOptions.session } : {}),
    ...(typeof browserOptions.window === 'string' ? { window: browserOptions.window } : {}),
    ...(typeof rootOptions.profile === 'string' ? { profile: rootOptions.profile } : {}),
  };
}
