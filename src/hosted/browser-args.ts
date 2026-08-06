import { Command, Option } from 'commander';
import {
  browserCommandCatalog,
  browserOptionFlags,
  browserOptionValueParser,
} from '../browser/command-catalog.js';
import { CommanderStructuralError } from '../command-surface.js';

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

/**
 * Parse the hosted browser argv with the exact canonical Commander grammar.
 * The returned values are the values produced by Commander's action boundary;
 * callers must not reinterpret the original argv with a second parser.
 */
export function parseHostedBrowserStructure(argv: readonly string[]): ParsedHostedBrowserStructure {
  const root = new Command('webcmd')
    .option('--profile <name>', 'Chrome profile/context alias for browser runtime commands')
    .enablePositionalOptions();
  const browser = root
    .command('browser')
    .addOption(new Option('--session <name>', 'Internal — set automatically from the <session> positional').hideHelp())
    .description('Run Playwright programs against named browser sessions')
    .usage('<session> <command> [options]')
    .addHelpText('after', `
<session> is a required positional: pass the name of the browser session every subcommand should operate on. Reuse the same name across calls to keep the tab/state alive; pick a different name to isolate parallel browser work.

Examples:
  $ webcmd browser work tabs
  $ webcmd browser work bind --page page-123
  $ printf 'await page.goto("https://example.com")' | webcmd browser work run --stdin
`);

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
      if (option.default !== undefined) commanderOption.default(String(option.default));
      const valueParser = browserOptionValueParser(contract.command, option.name);
      if (valueParser) commanderOption.argParser(valueParser);
      leaf.addOption(commanderOption);
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
  const browserAwareUsage = (command: Command): string => {
    const ancestors: string[] = [];
    let ancestor = command.parent;
    while (ancestor) {
      ancestors.unshift(ancestor === browser ? `${ancestor.name()} <session>` : ancestor.name());
      ancestor = ancestor.parent;
    }
    return [...ancestors, command.name(), command.usage()].filter(Boolean).join(' ').trim();
  };
  const configureBrowserUsage = (command: Command): void => {
    command.configureHelp({ commandUsage: browserAwareUsage });
    for (const child of command.commands) configureBrowserUsage(child);
  };
  configureBrowserUsage(browser);

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
  if (command !== 'run' || options.snapshotDiff !== false) return { ...options };
  const { snapshotDiff: _snapshotDiff, ...rest } = options;
  return { ...rest, noSnapshotDiff: true };
}

function readBrowserGlobals(root: Command, browser: Command): Pick<
  ParsedHostedBrowserStructure,
  'session' | 'window' | 'profile'
> {
  const rootOptions = root.opts<Record<string, unknown>>();
  const browserOptions = browser.opts<Record<string, unknown>>();
  return {
    ...(typeof browserOptions.session === 'string' ? { session: browserOptions.session } : {}),
    ...(typeof browserOptions.window === 'string' ? { window: browserOptions.window } : {}),
    ...(typeof rootOptions.profile === 'string' ? { profile: rootOptions.profile } : {}),
  };
}
