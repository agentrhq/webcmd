import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import {
  configureCompletionCommandSurface,
  configureListCommandSurface,
  configurePluginInstallSurface,
  configurePluginListSurface,
  configurePluginSearchSurface,
  configurePluginUninstallSurface,
  configurePluginUpdateSurface,
} from '../builtin-command-surface.js';
import { BrowserSessionArgvError, rejectMisplacedSessionSelectorArgv, rejectPositionalBrowserSessionArgv } from '../cli-argv-preprocess.js';
import { CommanderStructuralError, MissingRequiredPositionalError, OUTPUT_FORMAT_HELP, parseOutputFormat } from '../command-surface.js';
import { filterCommandsByTag, formatRootHelp, getCommandCompletionCandidates } from '../command-presentation.js';
import {
  HOSTED_BUILTIN_COMMANDS,
  HOSTED_ROOT_HELP,
  LOCAL_ONLY_COMMAND_HELP,
} from '../completion-shared.js';
import { CliError, ConfigError, EXIT_CODES, toEnvelope } from '../errors.js';
import { getRequestedHelpFormat, renderStructuredHelp } from '../help.js';
import { findPackageRoot } from '../package-paths.js';
import { formatErrorEnvelope, render as renderOutput } from '../output.js';
import { StreamWriteError, writeToStream } from '../stream-write.js';
import { PKG_VERSION } from '../version.js';
import { getCompletionScriptFast } from '../completion-fast.js';
import { browserCommandCatalog } from '../browser/command-catalog.js';
import { loadBrowserRunSource } from '../browser/run/input.js';
import { BrowserRunError } from '../browser/run/types.js';
import { CLI_COMMAND } from '../brand.js';
import { missingPluginGuidance } from '../discovery.js';
import { HostedClient, HostedClientError, resolveWorkspace } from './client.js';
import { HOSTED_SESSION_PROTOCOL_VERSION } from './types.js';
import { parseHostedInvocation } from './args.js';
import { HostedBrowserHelp, parseHostedBrowserStructure, validateRawBrowserSession } from './browser-args.js';
import { materializeHostedOutputs, prepareHostedFiles, rewriteHostedOutputResultPaths } from './files.js';
import {
  findHostedCommand,
  hostedCommandHelpData,
  hostedCommands,
  hostedListPresentation,
  hostedSiteHelpData,
  isLocalOnlyHostedCommand,
  renderHostedCommandHelp,
  renderHostedSiteHelp,
  withClientOwnedCommands,
} from './manifest.js';
import { isHostedConfig, loadWebcmdConfig, type WebcmdConfig } from './config.js';
import { resolveHostedApiKey, type HostedCredentialStore } from './credentials.js';
import { parseHostedRootCommandSurface } from '../root-command-surface.js';
import { registerSiteCommands, type SiteMemoryBackend } from '../site-memory/commands.js';
import type {
  HostedBrowserActionName,
  HostedBrowserRunActionResponse,
  HostedBrowserSnapshotActionResponse,
  HostedCommand,
  HostedManifest,
} from './types.js';
import type { HostedBrowserCommandContract } from './contract.js';

export interface HostedRunnerOptions {
  config?: WebcmdConfig;
  credentialStore?: HostedCredentialStore;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  randomUUID?: () => string;
  fetchImpl?: typeof fetch;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  now?: () => number;
}

export interface HostedRunResult {
  handled: boolean;
  exitCode: number;
}

class CommanderCompatibleError extends Error {
  constructor(
    readonly output: string,
    readonly exitCode: number,
    readonly stdoutOutput?: string,
  ) {
    super(output.trimEnd());
  }
}

/** Normalize a hosted built-in's format, preserving Commander-style usage errors. */
function validateHostedFormat(raw: string): string {
  try {
    return parseOutputFormat(raw);
  } catch (err) {
    if (err instanceof CliError) {
      throw new CommanderStructuralError(`error: ${err.message}\n`, EXIT_CODES.USAGE_ERROR);
    }
    throw err;
  }
}

const hostedBrowserCommandsByPath = new Map(browserCommandCatalog.map(command => [command.command, command]));

export async function runHostedCli(argv: string[], opts: HostedRunnerOptions = {}): Promise<HostedRunResult> {
  const config = opts.config ?? loadWebcmdConfig({ env: opts.env, homeDir: opts.homeDir });
  if (!isHostedConfig(config)) return { handled: false, exitCode: EXIT_CODES.SUCCESS };
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  try {
    argv = rejectMisplacedSessionSelectorArgv(rejectPositionalBrowserSessionArgv(argv));
    const credential = await resolveHostedApiKey(config, {
      credentialStore: opts.credentialStore,
      env: opts.env,
      homeDir: opts.homeDir,
      platform: opts.platform,
      randomUUID: opts.randomUUID,
      migrate: opts.config === undefined,
    });
    const client = new HostedClient({
      apiBaseUrl: config.hosted.apiBaseUrl,
      apiKey: credential.apiKey,
      workspace: resolveWorkspace(argv, opts.env ?? process.env),
      fetchImpl: opts.fetchImpl,
    });
    await dispatchHosted(argv, client, stdout, stderr, opts.now ?? Date.now, opts.homeDir ?? opts.env?.HOME ?? homedir());
    return { handled: true, exitCode: EXIT_CODES.SUCCESS };
  } catch (err) {
    if (err instanceof StreamWriteError) throw err;
    if (err instanceof BrowserSessionArgvError) {
      await writeToStream(stderr, `error: ${err.message}\n`);
      return { handled: true, exitCode: EXIT_CODES.USAGE_ERROR };
    }
    if (err instanceof CliError && err.code === 'UNSUPPORTED_SHELL') throw err;
    if (err instanceof CommanderStructuralError) {
      await writeToStream(stderr, err.output);
      return { handled: true, exitCode: err.exitCode };
    }
    if (err instanceof CommanderCompatibleError) {
      await writeToStream(stderr, err.output);
      if (err.stdoutOutput) await writeToStream(stdout, err.stdoutOutput);
      return { handled: true, exitCode: err.exitCode };
    }
    if (err instanceof MissingRequiredPositionalError) {
      await writeToStream(stderr, `error: missing required argument '${err.argumentName}'\n`);
      return { handled: true, exitCode: EXIT_CODES.GENERIC_ERROR };
    }
    await writeToStream(stderr, formatErrorEnvelope(toEnvelope(err), {
      cmdName: hostedCommandName(argv),
      traceMode: hostedTraceMode(argv),
    }));
    return {
      handled: true,
      exitCode: errorExitCode(err),
    };
  }
}

async function dispatchHosted(
  argv: string[],
  client: HostedClient,
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
  now: () => number,
  homeDir: string,
): Promise<void> {
  const normalized = parseHostedRootCommandSurface(argv);
  if (normalized.kind === 'help') {
    const help = formatRootHelp(HOSTED_ROOT_HELP);
    if (normalized.exitCode !== EXIT_CODES.SUCCESS) {
      throw new CommanderCompatibleError(help, normalized.exitCode);
    }
    await writeToStream(stdout, help);
    return;
  }
  if (normalized.kind === 'version') {
    await writeToStream(stdout, normalized.output);
    return;
  }
  if (normalized.kind === 'completion') {
    const manifest = await getPresentationManifest(client);
    await writeToStream(stdout, hostedCompletions(manifest, normalized.argv).join('\n') + '\n');
    return;
  }
  const args = normalized.argv;
  if (args[0] === 'completion') {
    const parsed = parseHostedCompletionSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    const script = getCompletionScriptFast(parsed.shell);
    if (script === undefined) {
      // Run the canonical local Commander action for this rare error path so
      // hosted mode preserves even the historical public stack bytes.
      const { createProgram } = await import('../cli.js');
      await createProgram('', '').parseAsync(argv, { from: 'user' });
      throw new CliError('UNSUPPORTED_SHELL', `Unsupported shell: ${parsed.shell}. Supported: bash, zsh, fish`);
    }
    await writeToStream(stdout, script);
    return;
  }
  if (args[0] === 'daemon') {
    throw new ConfigError(
      'webcmd daemon is local-only. Hosted mode has no local daemon.',
      LOCAL_ONLY_COMMAND_HELP,
    );
  }
  if (args[0] === 'doctor') {
    throw new ConfigError(
      'webcmd doctor is local-only. Hosted mode has no local browser bridge.',
      LOCAL_ONLY_COMMAND_HELP,
    );
  }
  if (args[0] === 'session') {
    const parsed = parseHostedSessionSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    const manifest = await client.getManifest();
    validateManifestContractIdentity(manifest);
    await dispatchHostedSession(parsed, client, stdout, normalized.profile);
    return;
  }
  if (args[0] === 'browser') {
    const invocation = await parseHostedBrowserInvocation(args, normalized.profile, normalized.session);
    const manifest = await client.getManifest();
    validateManifestContractIdentity(manifest);
    await dispatchHostedBrowser(invocation, client, stdout);
    return;
  }

  if (args[0] === 'site') {
    await runHostedSiteSurface(args.slice(1), normalized.literal, client, stdout);
    return;
  }

  if (args[0] === 'adapter' && (args[1] === 'source' || args[1] === 'path')) {
    await runHostedAdapterSourceSurface(args.slice(1), normalized.literal, client, stdout, homeDir);
    return;
  }

  if (args[0] === 'list') {
    const parsed = parseHostedListSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    const manifest = await getPresentationManifest(client);
    await renderHostedList(manifest, parsed.format, parsed.formatExplicit, stdout, parsed.tag);
    return;
  }

  if (args[0] === 'profile') {
    if (args[1] === 'rename' || args[1] === 'use') {
      throw new ConfigError(
        `webcmd profile ${args[1]} is not available in hosted mode.`,
        'Hosted mode supports: webcmd profile list and delete.',
      );
    }
    const parsed = parseHostedProfileSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    await dispatchHostedProfile(parsed, client, stdout);
    return;
  }

  if (args[0] === 'plugin') {
    const subcommand = args[1];
    const allowed = new Set(['search', 'install', 'list', 'uninstall', 'update', 'create', '--help', '-h']);
    if (!allowed.has(subcommand ?? '')) {
      throw new ConfigError(
        `webcmd plugin ${subcommand ?? ''}`.trimEnd() + ' is not available in hosted mode.',
        'Hosted mode supports: webcmd plugin search, install, list, uninstall, update, and create.',
      );
    }
    const parsed = parseHostedPluginSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    if (parsed.command === 'search') {
      const result = await client.searchMarketplacePlugins(parsed.query);
      if (parsed.format === 'json') {
        await renderOutput(result, { fmt: 'json', stdout });
      } else {
        for (const error of result.errors) await writeToStream(stderr, `Warning: ${error.sourceId}: ${error.message}\n`);
        await renderOutput(result.plugins.map(plugin => ({
          ...plugin,
          excludedCommands: plugin.excludedCommands.join(','),
        })), {
          fmt: parsed.format,
          fmtExplicit: parsed.formatExplicit,
          columns: ['name', 'description', 'version', 'sourceId', 'installSource', 'webcmd', 'availability', 'excludedCommands'],
          title: `${CLI_COMMAND}/plugin-search`,
          source: `${CLI_COMMAND} plugin search`,
          stdout,
        });
      }
      return;
    }
    if (parsed.command === 'install') {
      const installed = await client.installMarketplacePlugin(parsed.source);
      await writeToStream(stdout, `✅ Plugin "${installed.name}" installed successfully. Commands are ready to use.\n`);
      return;
    }
    if (parsed.command === 'list') {
      const installations = await client.listMarketplaceInstallations();
      await renderOutput(installations, {
        fmt: parsed.format,
        fmtExplicit: parsed.formatExplicit,
        columns: ['name', 'version', 'installSource', 'installedAt', 'updateAvailable'],
        title: `${CLI_COMMAND}/plugins`,
        source: `${CLI_COMMAND} plugin list`,
        stdout,
      });
      return;
    }
    if (parsed.command === 'uninstall') {
      await client.uninstallMarketplacePlugin(parsed.name);
      await writeToStream(stdout, `✅ Plugin "${parsed.name}" uninstalled.\n`);
      return;
    }
    if (parsed.command === 'update') {
      if (!parsed.name && !parsed.all) {
        throw new ConfigError(
          'Specify a plugin name or use --all.',
          'Example: webcmd plugin update alpha',
        );
      }
      if (parsed.name && parsed.all) {
        throw new ConfigError('Cannot specify both a plugin name and --all.');
      }
      const targets = parsed.all
        ? (await client.listMarketplaceInstallations()).map((row) => row.name)
        : [parsed.name!];
      let hasErrors = false;
      for (const target of targets) {
        try {
          const outcome = await client.updateMarketplacePlugin(target);
          if ('delisted' in outcome && outcome.delisted) {
            await writeToStream(stdout, `⚠ "${target}" is installed but its catalog entry was delisted; nothing to update to.\n`);
          } else if (outcome.updated) {
            await writeToStream(stdout, `✅ Updated "${target}" to ${outcome.version}.\n`);
          } else {
            await writeToStream(stdout, `✔ "${target}" is already up to date.\n`);
          }
        } catch (err) {
          hasErrors = true;
          const message = err instanceof Error ? err.message : String(err);
          await writeToStream(stderr, `✗ "${target}" — ${message}\n`);
        }
      }
      if (hasErrors) throw new ConfigError('Some plugins failed to update.');
      return;
    }
    // parsed.command === 'create'
    const { createPluginScaffold } = await import('../plugin-scaffold.js');
    const result = createPluginScaffold(parsed.name, {
      ...(parsed.dir !== undefined ? { dir: parsed.dir } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      author: { name: parsed.authorName ?? '', handle: parsed.authorHandle ?? '' },
    });
    await writeToStream(stdout, `✅ Plugin scaffold created at ${result.dir}\n\n`);
    await writeToStream(stdout, '  Next steps (hosted mode):\n');
    await writeToStream(stdout, '    1. Author and verify the adapter in the cloud:\n');
    await writeToStream(stdout, `       ${CLI_COMMAND} browser init <site>/<command>\n`);
    await writeToStream(stdout, `       ${CLI_COMMAND} browser verify <site>/<command>\n`);
    await writeToStream(stdout, '    2. Copy the verified command files into this scaffold.\n');
    await writeToStream(stdout, '    3. Open a pull request against agentrhq/webcmd to publish it.\n');
    await writeToStream(stdout, '       See docs/publish-community-plugin.mdx\n');
    return;
  }

  // The API manifest is tenant-scoped. Only the core client-owned presentation
  // entry is merged; package and local plugin commands stay out.
  const manifest = await getPresentationManifest(client);

  const site = args[0]!;
  const commandName = args[1];
  const siteExists = manifest.commands.some(command => command.site === site);
  if (!siteExists) {
    const unknownRoot = parseUnknownSiteRootOptions(args, normalized.literal);
    if (unknownRoot.version) {
      await writeToStream(stdout, `${PKG_VERSION}\n`);
      return;
    }
    if (unknownRoot.help) {
      await writeToStream(stdout, formatRootHelp(HOSTED_ROOT_HELP));
      return;
    }
    throw new CommanderCompatibleError(
      `${missingPluginGuidance(site)}\n`,
      EXIT_CODES.USAGE_ERROR,
      formatRootHelp(HOSTED_ROOT_HELP),
    );
  }
  if (!commandName || commandName === '--help' || commandName === '-h') {
    const data = hostedSiteHelpData(manifest, site);
    if (!data) {
      throw new CommanderCompatibleError(
        `error: unknown command '${site}'\n`,
        EXIT_CODES.USAGE_ERROR,
        formatRootHelp(HOSTED_ROOT_HELP),
      );
    }
    await writeHostedHelp(stdout, args, data, renderHostedSiteHelp(manifest, site));
    return;
  }

  const command = findHostedCommand(manifest, site, commandName);
  if (!command) {
    if (!normalized.literal && hasTerminalBeforeSeparator(args.slice(1), token => token === '--help' || token === '-h')) {
      const data = hostedSiteHelpData(manifest, site);
      if (!data) {
        throw new CommanderCompatibleError(
          `error: unknown command '${site}'\n`,
          EXIT_CODES.USAGE_ERROR,
          formatRootHelp(HOSTED_ROOT_HELP),
        );
      }
      await writeHostedHelp(stdout, args, data, renderHostedSiteHelp(manifest, site));
      return;
    }
    throw new CommanderCompatibleError(`error: unknown command '${commandName}'\n`, EXIT_CODES.GENERIC_ERROR);
  }
  if (isLocalOnlyHostedCommand(command)) {
    throw new ConfigError(
      `Command ${command.command} is local-only and is not available in hosted mode.`,
      LOCAL_ONLY_COMMAND_HELP,
    );
  }
  const parsed = parseHostedInvocation(command, args.slice(2));
  if (parsed.help) {
    await writeHostedHelp(stdout, args, hostedCommandHelpData(command), renderHostedCommandHelp(command));
    return;
  }
  if (command.clientOwned) {
    throw new Error(`Internal invariant: client-owned command ${command.command} reached hosted dispatch.`);
  }

  const startTime = now();
  const response = hasPresentFileArgument(command, parsed.args)
    ? await executeHostedFileCommand({
        client,
        command,
        args: parsed.args,
        format: parsed.format,
        trace: parsed.trace,
        profile: parsed.profile ?? normalized.profile,
        session: normalized.session,
      })
    : await client.execute({
        command: command.command,
        args: parsed.args,
        format: parsed.format,
        trace: parsed.trace,
        profile: parsed.profile ?? normalized.profile,
        session: normalized.session,
      });
  let format: string = parsed.format;
  if (!parsed.formatExplicit && format === 'table' && command.defaultFormat) {
    format = command.defaultFormat;
  }
  const elapsed = (now() - startTime) / 1000;
  if (response.result !== null && response.result !== undefined) {
    await renderOutput(response.result, {
      fmt: format,
      fmtExplicit: parsed.formatExplicit,
      columns: response.columns ?? command.columns,
      title: command.command,
      elapsed,
      source: command.command,
      footerExtra: response.footerExtra,
      stdout,
    });
  }
  if (parsed.trace === 'on' && response.trace) {
    await writeToStream(stderr, `Webcmd trace artifact: ${response.trace.receipt}\n`);
  }
}

async function runHostedSiteSurface(argv: readonly string[], literal: boolean, client: HostedClient, stdout: NodeJS.WritableStream): Promise<void> {
  let help = '';
  let stderr = '';
  const root = new Command('webcmd').exitOverride().configureOutput({
    writeOut: value => { help += value; },
    writeErr: value => { stderr += value; },
  });
  registerSiteCommands(root, hostedSiteMemoryBackend(client), stdout);
  try {
    await root.parseAsync(literal ? ['--', 'site', ...argv] : ['site', ...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') {
      await writeToStream(stdout, help);
      return;
    }
    if (error instanceof CommanderError) throw new CommanderStructuralError(stderr || `${error.message}\n`, error.exitCode);
    throw error;
  }
}

function hostedSiteMemoryBackend(client: HostedClient): SiteMemoryBackend {
  return {
    show: async (site, kind) => Promise.all((await client.listSiteMemory(site)).filter(item => !kind || item.kind === kind)
      .map(async item => ({ path: item.path, body: await client.readSiteMemory(site, item.path) }))),
    list: site => client.listSiteMemory(site),
    note: (site, text, author) => client.writeSiteMemory(site, 'notes.md', JSON.stringify({ text, ...(author ? { author } : {}) }), 'application/json'),
    endpoint: (site, name, input) => client.writeSiteMemory(site, 'endpoints.json', JSON.stringify({ name, ...input }), 'application/json'),
    stale: (site, name) => client.deleteSiteMemory(site, 'endpoints.json', JSON.stringify({ name })),
    fieldMap: (site, key, meaning, source, force) => client.writeSiteMemory(site, 'field-map.json', JSON.stringify({ key, meaning, source, force }), 'application/json'),
    fixture: async (site, command) => {
      try { return await client.readSiteMemory(site, `verify/${command}.json`); }
      catch (error) { if (error instanceof HostedClientError && error.code === 'SITE_MEMORY_NOT_FOUND') return null; throw error; }
    },
    putFixture: (site, command, body) => client.writeSiteMemory(site, `verify/${command}.json`, body, 'application/json'),
    sample: (site, command, body) => client.writeSiteMemory(site, `fixtures/${command}-${Date.now()}.json`, body, 'application/json'),
  };
}

type HostedAdapterSourceCommand =
  | { kind: 'get'; commandKey: string; output?: string }
  | { kind: 'put'; commandKey: string; path: string }
  | { kind: 'path'; commandKey: string };

async function runHostedAdapterSourceSurface(argv: readonly string[], literal: boolean, client: HostedClient, stdout: NodeJS.WritableStream, homeDir: string): Promise<void> {
  let parsed: HostedAdapterSourceCommand | undefined;
  let help = '';
  let stderr = '';
  const root = new Command('webcmd').exitOverride().configureOutput({
    writeOut: value => { help += value; },
    writeErr: value => { stderr += value; },
  });
  const adapter = root.command('adapter');
  const source = adapter.command('source');
  source.command('get').argument('<command>').option('-o, --output <path>').action((commandKey, opts: { output?: string }) => { parsed = { kind: 'get', commandKey, output: opts.output }; });
  source.command('put').argument('<command>').argument('<path>').action((commandKey, filePath) => { parsed = { kind: 'put', commandKey, path: filePath }; });
  adapter.command('path').argument('<command>').action(commandKey => { parsed = { kind: 'path', commandKey }; });
  try {
    await root.parseAsync(literal ? ['--', 'adapter', ...argv] : ['adapter', ...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') {
      await writeToStream(stdout, help);
      return;
    }
    if (error instanceof CommanderError) throw new CommanderStructuralError(stderr || `${error.message}\n`, error.exitCode);
    throw error;
  }
  if (!parsed) throw new CommanderStructuralError("error: command 'adapter' did not run\n", EXIT_CODES.USAGE_ERROR);
  const { site, command } = parseAdapterCommandKey(parsed.commandKey);
  const destination = hostedAdapterDestination(homeDir, site, command);
  if (parsed.kind === 'path') return writeToStream(stdout, `${destination}\n`);
  const metadata = await hostedAdapterSourceMetadata(client, parsed.commandKey);
  const sourcePath = metadata.sourceFile ?? metadata.modulePath;
  if (!sourcePath) throw new ConfigError(`Hosted adapter source is unavailable for ${parsed.commandKey}.`);
  validateHostedRelativePath(sourcePath, 'adapter source provenance');
  if (parsed.kind === 'get') {
    const body = await client.readAdapterSource(metadata.adapterPackageId!, sourcePath);
    if (parsed.output === '-') return writeToStream(stdout, body);
    const output = parsed.output ?? destination;
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, body, 'utf8');
    return;
  }
  const result = await client.writeAdapterSource(metadata.adapterPackageId!, sourcePath, readFileSync(parsed.path, 'utf8'));
  await writeToStream(stdout, `${result.commands.join('\n')}\n`);
}

function parseAdapterCommandKey(value: string): { site: string; command: string } {
  const [site, command, extra] = value.split('/');
  if (!isSafePathSegment(site) || !isSafePathSegment(command) || extra) throw new ConfigError('Adapter command must use site/command format.');
  return { site, command };
}

function hostedAdapterDestination(homeDir: string, site: string, command: string): string {
  const root = path.resolve(homeDir, '.webcmd', 'hosted', 'clis');
  const destination = path.resolve(root, site, `${command}.js`);
  const relative = path.relative(root, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ConfigError('Hosted adapter destination is invalid.');
  return destination;
}

function validateHostedRelativePath(value: string, label: string): void {
  if (!value || value.includes('\\') || path.isAbsolute(value) || value.split('/').some(part => !isSafePathSegment(part))) {
    throw new ConfigError(`Hosted ${label} is invalid.`);
  }
}

function isSafePathSegment(value: string | undefined): value is string {
  return typeof value === 'string' && value !== '' && value !== '.' && value !== '..' && !value.includes('\\') && !value.includes('\0');
}

async function hostedAdapterSourceMetadata(client: HostedClient, key: string): Promise<HostedCommand> {
  const manifest = await client.getManifest();
  validateManifestContractIdentity(manifest);
  const command = manifest.commands.find(candidate => candidate.command === key);
  if (!command?.adapterPackageId || (!command.sourceFile && !command.modulePath)) throw new ConfigError(`Hosted adapter source is unavailable for ${key}.`);
  return command;
}

type ParsedHostedSessionSurface =
  | { kind: 'help'; output: string }
  | { kind: 'run'; command: 'create' | 'list' | 'close'; format: string; formatExplicit: boolean; session?: string; force?: boolean; limit?: number };

function parseHostedSessionSurface(argv: readonly string[], literal: boolean): ParsedHostedSessionSurface {
  let stdout = '';
  let stderr = '';
  let parsed: Exclude<ParsedHostedSessionSurface, { kind: 'help' }> | undefined;
  const root = new Command('webcmd');
  const session = root.command('session').description('Create, list, and close browser Sessions');
  const output = {
    writeOut: (value: string) => { stdout += value; },
    writeErr: (value: string) => { stderr += value; },
  };
  root.exitOverride().configureOutput(output);
  session.exitOverride().configureOutput(output);
  const configure = (command: Command, format: string): Command => command.option('-f, --format <fmt>', OUTPUT_FORMAT_HELP, format);
  const setParsed = (command: 'create' | 'list' | 'close', surface: Command, format: string, extras: Omit<Exclude<ParsedHostedSessionSurface, { kind: 'help' }>, 'kind' | 'command' | 'format' | 'formatExplicit'> = {}): void => {
    parsed = { kind: 'run', command, format: validateHostedFormat(format), formatExplicit: surface.getOptionValueSource('format') === 'cli', ...extras };
  };
  const create = configure(session.command('create'), 'yaml');
  create.action((options: { format: string }) => setParsed('create', create, options.format));
  const list = configure(session.command('list').option('--limit <number>', 'Maximum Sessions to return (1-100)', parseHostedSessionListLimit, 20), 'table');
  list.action((options: { format: string; limit: number }) => setParsed('list', list, options.format, { limit: options.limit }));
  const close = configure(session.command('close').argument('<session-id>').option('--force', 'Close even while the Session is busy or paused for handoff'), 'yaml');
  close.action((sessionId: string, options: { format: string; force?: boolean }) => setParsed('close', close, options.format, { session: sessionId, force: options.force === true }));
  try {
    root.parse(literal ? ['--', 'session', ...argv] : ['session', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', output: stdout };
    throw new CommanderStructuralError(stderr || `${error.message}\n`, error.exitCode);
  }
  if (!parsed) throw new CommanderStructuralError("error: command 'session' did not run\n", 1);
  return parsed;
}

async function dispatchHostedSession(
  parsed: Exclude<ParsedHostedSessionSurface, { kind: 'help' }>,
  client: HostedClient,
  stdout: NodeJS.WritableStream,
  profile?: string,
): Promise<void> {
  if (parsed.command === 'create') {
    await renderOutput(sessionCreateOutput((await client.createBrowserSession(profile)).session), { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, columns: ['id', 'kind', 'runtimeState'], stdout });
    return;
  }
  if (parsed.command === 'list') {
    const rows = (await client.listBrowserSessions(profile, parsed.limit)).sessions
      .map((row) => ({ ...row, handoff: formatHostedSessionHandoff(row.handoff) }));
    if (rows.length === 0 && parsed.format === 'table' && !parsed.formatExplicit) {
      await writeToStream(stdout, `No browser Sessions found${profile ? ` for Profile ${profile}` : ''}.\n`);
      return;
    }
    await renderOutput(rows, { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, columns: ['id', 'kind', 'runtimeState', 'handoff'], stdout });
    return;
  }
  await renderOutput(await client.closeBrowserSession(parsed.session!, profile, parsed.force === true), { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, stdout });
}

function parseHostedSessionListLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new InvalidArgumentError('Session list limit must be an integer from 1 to 100.');
  }
  return limit;
}

function sessionCreateOutput(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const row = data as Record<string, unknown>;
  return { id: row.id, kind: row.kind, runtimeState: row.runtimeState };
}

function formatHostedSessionHandoff(handoff: unknown): string {
  if (!handoff || typeof handoff !== 'object') return '';
  const row = handoff as { site?: unknown; expiresAt?: unknown };
  return typeof row.site === 'string' && typeof row.expiresAt === 'string'
    ? `${row.site} until ${row.expiresAt}`
    : '';
}

function hasPresentFileArgument(
  command: import('./types.js').HostedCommand,
  args: Record<string, unknown>,
): boolean {
  return command.args.some((arg) => {
    if (!arg.file) return false;
    const value = args[arg.name] ?? arg.default ?? arg.file.defaultPath;
    return value !== undefined && value !== null && value !== '';
  });
}

async function executeHostedFileCommand(input: {
  client: HostedClient;
  command: import('./types.js').HostedCommand;
  args: Record<string, unknown>;
  format: string;
  trace: string;
  profile?: string;
  session?: string;
}): Promise<import('./types.js').HostedExecuteResponse> {
  const prepared = await prepareHostedFiles({
    client: input.client,
    command: input.command,
    args: input.args,
  });
  const response = await input.client.runPreparedExecution({
    executionId: prepared.executionId,
    command: input.command.command,
    args: prepared.args,
    format: input.format,
    trace: input.trace,
    ...(input.profile !== undefined ? { profile: input.profile } : {}),
    ...(input.session !== undefined ? { session: input.session } : {}),
  });
  const materialized = await materializeHostedOutputs({
    client: input.client,
    response,
    outputs: prepared.outputs,
  });
  return {
    ...response,
    result: rewriteHostedOutputResultPaths(response.result, materialized),
  };
}

interface ParsedHostedBrowserInvocation {
  session: string;
  command: string;
  action: HostedBrowserActionName;
  args: Record<string, unknown>;
  localPath?: string;
  profile?: string;
  windowMode?: 'foreground' | 'background';
}

async function dispatchHostedBrowser(
  invocation: ParsedHostedBrowserInvocation,
  client: HostedClient,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const args = invocation.action === 'set-file-input'
    ? materializeHostedBrowserUploadArgs(invocation.args)
    : invocation.args;
  const response = await client.runBrowserAction(invocation.session, {
    command: invocation.command,
    action: invocation.action,
    args,
    ...(invocation.profile !== undefined ? { profile: invocation.profile } : {}),
    ...(invocation.windowMode !== undefined ? { windowMode: invocation.windowMode } : {}),
    trace: 'off',
  });
  await renderHostedBrowserResponse(stdout, invocation, response);
}

function materializeHostedBrowserUploadArgs(args: Record<string, unknown>): Record<string, unknown> {
  const files = args.files;
  if (!Array.isArray(files)) return args;
  return {
    ...args,
    files: files.map((file) => {
      if (typeof file !== 'string') return file;
      const body = readFileSync(file);
      return {
        $webcmdBrowserUpload: {
          filename: path.basename(file),
          contentType: contentTypeForUpload(file),
          base64: Buffer.from(body).toString('base64'),
        },
      };
    }),
  };
}

function contentTypeForUpload(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.json':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.txt':
      return 'text/plain';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

async function parseHostedBrowserInvocation(
  argv: string[],
  profile: string | undefined,
  session: string | undefined,
): Promise<ParsedHostedBrowserInvocation> {
  let structure;
  try {
    structure = parseHostedBrowserStructure(session === undefined ? argv : ['--session', session, ...argv]);
  } catch (error) {
    if (error instanceof HostedBrowserHelp) throw new CommanderCompatibleError('', 0, error.output);
    throw error;
  }
  if (argv[0] !== 'browser') {
    throw new ConfigError('Hosted browser invocation must start with browser.');
  }
  if (!structure.commandName) {
    throw new ConfigError(
      'Hosted browser command is required.',
      'Use: webcmd --session <session-id> browser tabs, bind --page <id>, or run --stdin|--file <path>.',
    );
  }

  const windowMode = structure.window === undefined ? undefined : parseWindowMode(structure.window);
  const parsed = parseBrowserLeaf(structure.commandName, structure.positionals, structure.options);
  const browserArgs = await materializeBrowserRunSource(parsed.commandName, parsed.args);
  return {
    session: validateRawBrowserSession(structure.session, profile),
    command: `browser/${parsed.commandName}`,
    action: parsed.action,
    args: browserArgs,
    ...(parsed.localPath !== undefined ? { localPath: parsed.localPath } : {}),
    ...(profile !== undefined ? { profile } : {}),
    ...(windowMode !== undefined ? { windowMode } : {}),
  };
}

function parseWindowMode(value: string | undefined): 'foreground' | 'background' {
  if (value === 'foreground' || value === 'background') return value;
  throw new ConfigError('--window must be one of: foreground, background.');
}

function parseBrowserLeaf(
  leaf: string,
  positionals: string[],
  options: Record<string, unknown>,
): {
  commandName: string;
  action: HostedBrowserActionName;
  args: Record<string, unknown>;
  localPath?: string;
} {
  const contract = hostedBrowserCommandsByPath.get(leaf);
  if (!contract || !contract.action) {
    throw new ConfigError(`Hosted browser command is not supported yet: ${leaf}`);
  }

  const localPath = leaf === 'screenshot' ? positionals[0] : undefined;
  const args = browserActionArgs(contract, positionals, options);
  if (contract.command === 'run') {
    const hasStdin = args.stdin === true;
    const file = typeof args.file === 'string' ? args.file.trim() : '';
    if (hasStdin === Boolean(file)) {
      throw new ConfigError(
        'Browser run requires exactly one program input: --stdin or --file <path>.',
      );
    }
  }
  return {
    commandName: leaf,
    action: contract.action,
    args,
    ...(localPath !== undefined ? { localPath } : {}),
  };
}

async function materializeBrowserRunSource(commandName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (commandName !== 'run') return args;
  try {
    const source = await loadBrowserRunSource({
      stdin: args.stdin === true,
      file: typeof args.file === 'string' ? args.file : undefined,
    });
    const { stdin: _stdin, file: _file, ...rest } = args;
    return { ...rest, source };
  } catch (error) {
    if (error instanceof BrowserRunError) throw new ConfigError(error.message, error.hint);
    throw error;
  }
}

function browserActionArgs(
  contract: HostedBrowserCommandContract,
  positionals: string[],
  options: Record<string, unknown>,
): Record<string, unknown> {
  const args = compactRecord({ ...options });
  let index = 0;
  for (const positional of contract.positionals) {
    if (positional.variadic) {
      const rest = positionals.slice(index);
      if (rest.length) args[positional.name] = rest;
      index = positionals.length;
      continue;
    }
    const value = positionals[index];
    if (value !== undefined) args[positional.name] = value;
    index += 1;
  }

  switch (contract.command) {
    case 'verify': {
      const { fixture, ...rest } = args;
      return fixture === false ? { ...rest, noFixture: true } : rest;
    }
    case 'screenshot':
      delete args.path;
      return args;
    case 'tab/list':
      return { ...args, op: 'list' };
    case 'tab/new':
      return {
        ...withoutKeys(args, ['url']),
        op: 'new',
        ...(typeof args.url === 'string' && args.url ? { url: args.url } : {}),
      };
    case 'tab/select':
      return {
        ...withoutKeys(args, ['targetId']),
        op: 'select',
        ...(typeof args.targetId === 'string' && args.targetId ? { target: args.targetId } : {}),
      };
    case 'tab/close':
      return {
        ...withoutKeys(args, ['targetId']),
        op: 'close',
        ...(typeof args.targetId === 'string' && args.targetId ? { target: args.targetId } : {}),
      };
    case 'type':
      return rewriteTextTargetArgs(args, options, 'targetOrText', 'text');
    case 'fill':
      return rewriteTextTargetArgs(args, options, 'targetOrText', 'text');
    case 'select':
      return rewriteTextTargetArgs(args, options, 'targetOrOption', 'option');
    case 'upload':
      return rewriteUploadArgs(args, options);
    default:
      return args;
  }
}

function rewriteTextTargetArgs(
  args: Record<string, unknown>,
  options: Record<string, unknown>,
  firstPositionalName: string,
  valueName: string,
): Record<string, unknown> {
  const first = args[firstPositionalName];
  const value = args[valueName];
  const next = withoutKeys(args, [firstPositionalName, valueName]);
  if (hasSemanticLocator(options)) {
    return {
      ...next,
      ...(typeof first === 'string' ? { [valueName]: first } : {}),
    };
  }
  return {
    ...next,
    ...(typeof first === 'string' ? { target: first } : {}),
    ...(typeof value === 'string' ? { [valueName]: value } : {}),
  };
}

function rewriteUploadArgs(args: Record<string, unknown>, options: Record<string, unknown>): Record<string, unknown> {
  const targetOrFile = args.targetOrFile;
  const files = Array.isArray(args.files) ? args.files.filter((entry): entry is string => typeof entry === 'string') : [];
  const next = withoutKeys(args, ['targetOrFile', 'files']);
  if (hasSemanticLocator(options)) {
    return {
      ...next,
      files: [
        ...(typeof targetOrFile === 'string' ? [targetOrFile] : []),
        ...files,
      ],
    };
  }
  return {
    ...next,
    selector: typeof targetOrFile === 'string' ? targetOrFile : 'input[type="file"]',
    files,
  };
}

function hasSemanticLocator(args: Record<string, unknown>): boolean {
  return ['role', 'name', 'label', 'text', 'testid'].some(key => args[key] !== undefined);
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function withoutKeys(input: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => !blocked.has(key) && value !== undefined));
}

async function renderHostedBrowserResponse(
  stdout: NodeJS.WritableStream,
  invocation: ParsedHostedBrowserInvocation,
  response: HostedBrowserRunActionResponse | HostedBrowserSnapshotActionResponse,
): Promise<void> {
  const result = response.result;
  if (invocation.action === 'snapshot' && result && typeof result === 'object') {
    const record = result as { tree?: unknown; url?: unknown; snapshot?: unknown };
    if (typeof record.tree === 'string') {
      await writeToStream(stdout, `${record.tree}\n`);
      return;
    }
    await writeToStream(stdout, `URL: ${typeof record.url === 'string' ? record.url : ''}\n\n`);
    await writeToStream(stdout, `${typeof record.snapshot === 'string' ? record.snapshot : JSON.stringify(record.snapshot, null, 2)}\n`);
    return;
  }
  if (invocation.action === 'screenshot' && result && typeof result === 'object') {
    const base64 = (result as { base64?: unknown }).base64;
    if (typeof base64 === 'string' && invocation.localPath) {
      writeFileSync(invocation.localPath, Buffer.from(base64, 'base64'));
      await writeToStream(stdout, `Screenshot saved to: ${invocation.localPath}\n`);
      return;
    }
    if (typeof base64 === 'string') {
      await writeToStream(stdout, `${base64}\n`);
      return;
    }
  }
  if (typeof result === 'string') {
    await writeToStream(stdout, `${result}\n`);
    return;
  }
  await writeToStream(stdout, `${JSON.stringify(result, null, 2)}\n`);
}

async function renderHostedList(
  manifest: HostedManifest,
  fmt: string,
  explicit: boolean,
  stdout: NodeJS.WritableStream,
  tag?: string,
): Promise<void> {
  const presentation = hostedListPresentation({ ...manifest, commands: filterCommandsByTag(manifest.commands, tag) }, fmt);
  if (presentation.displayLines) {
    for (const line of presentation.displayLines) await writeToStream(stdout, `${line}\n`);
    return;
  }
  await renderOutput(presentation.rows, {
    fmt,
    fmtExplicit: explicit,
    columns: presentation.columns,
    stdout,
  });
}

async function writeHostedHelp(
  stdout: NodeJS.WritableStream,
  argv: readonly string[],
  data: Record<string, unknown>,
  text: string,
): Promise<void> {
  const format = getRequestedHelpFormat(argv);
  await writeToStream(stdout, format ? renderStructuredHelp(data, format) : text);
}

type ParsedHostedListSurface =
  | { kind: 'help'; output: string }
  | { kind: 'run'; format: string; formatExplicit: boolean; tag?: string };

function parseHostedListSurface(argv: readonly string[], literal: boolean): ParsedHostedListSurface {
  let stdout = '';
  let stderr = '';
  let parsedFormat = 'table';
  let parsedTag: string | undefined;
  let formatExplicit = false;
  let actionRan = false;
  const root = new Command('webcmd');
  const list = configureListCommandSurface(root.command('list'));
  const output = {
    writeOut: (value: string) => { stdout += value; },
    writeErr: (value: string) => { stderr += value; },
  };
  root.exitOverride().configureOutput(output);
  list.exitOverride().configureOutput(output).action((options: { format: string; tag?: string }) => {
    actionRan = true;
    parsedFormat = validateHostedFormat(options.format);
    parsedTag = options.tag;
    formatExplicit = list.getOptionValueSource('format') === 'cli';
  });

  try {
    root.parse(literal ? ['--', 'list', ...argv] : ['list', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', output: stdout };
    throw new CommanderStructuralError(stderr || `${error.message}\n`, error.exitCode);
  }
  if (!actionRan) throw new CommanderStructuralError("error: command 'list' did not run\n", 1);
  return { kind: 'run', format: parsedFormat, formatExplicit, ...(parsedTag !== undefined ? { tag: parsedTag } : {}) };
}

type HostedProfileCommand = 'list' | 'delete';

type ParsedHostedProfileSurface =
  | { kind: 'help'; output: string }
  | {
      kind: 'run';
      command: HostedProfileCommand;
      format: string;
      formatExplicit: boolean;
      value?: string;
    };

function parseHostedProfileSurface(
  argv: readonly string[],
  literal: boolean,
): ParsedHostedProfileSurface {
  let stdout = '';
  let stderr = '';
  let parsed: Exclude<ParsedHostedProfileSurface, { kind: 'help' }> | undefined;
  const root = new Command('webcmd');
  const profile = root.command('profile').description('Manage hosted browser profiles');
  const output = {
    writeOut: (value: string) => { stdout += value; },
    writeErr: (value: string) => { stderr += value; },
  };
  root.exitOverride().configureOutput(output);
  profile.exitOverride().configureOutput(output);

  const configureFormat = (command: Command): Command =>
    command.option('-f, --format <fmt>', OUTPUT_FORMAT_HELP, 'table');
  const setParsed = (
    command: HostedProfileCommand,
    surface: Command,
    value?: string,
  ): void => {
    const options = surface.opts<{ format: string }>();
    parsed = {
      kind: 'run',
      command,
      format: validateHostedFormat(options.format),
      formatExplicit: surface.getOptionValueSource('format') === 'cli',
      ...(value !== undefined ? { value } : {}),
    };
  };

  const list = configureFormat(profile.command('list'));
  list.exitOverride().configureOutput(output).action(() => setParsed('list', list));
  const remove = configureFormat(profile.command('delete').argument('<profile-id>'));
  remove.exitOverride().configureOutput(output).action((profileId: string) => setParsed('delete', remove, profileId));

  try {
    root.parse(literal ? ['--', 'profile', ...argv] : ['profile', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', output: stdout };
    throw new CommanderStructuralError(stderr || `${error.message}\n`, error.exitCode);
  }
  if (!parsed) {
    throw new CommanderStructuralError("error: command 'profile' did not run\n", 1);
  }
  return parsed;
}

async function dispatchHostedProfile(
  parsed: Exclude<ParsedHostedProfileSurface, { kind: 'help' }>,
  client: HostedClient,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const result = parsed.command === 'list'
    ? (await client.listProfiles()).profiles
    : await client.deleteProfile(parsed.value!);
  await renderOutput(result, {
    fmt: parsed.format,
    fmtExplicit: parsed.formatExplicit,
    stdout,
  });
}

type ParsedHostedPluginSurface =
  | { kind: 'help'; output: string }
  | { kind: 'run'; command: 'search'; query?: string; format: string; formatExplicit: boolean }
  | { kind: 'run'; command: 'install'; source: string }
  | { kind: 'run'; command: 'list'; format: string; formatExplicit: boolean }
  | { kind: 'run'; command: 'uninstall'; name: string }
  | { kind: 'run'; command: 'update'; name?: string; all: boolean }
  | { kind: 'run'; command: 'create'; name: string; dir?: string; description?: string; authorName?: string; authorHandle?: string };

function parseHostedPluginSurface(
  argv: readonly string[],
  literal: boolean,
): ParsedHostedPluginSurface {
  let stdout = '';
  let stderr = '';
  let parsed: Exclude<ParsedHostedPluginSurface, { kind: 'help' }> | undefined;
  const root = new Command('webcmd');
  const plugin = root.command('plugin').description(`Manage ${CLI_COMMAND} plugins`);
  const output = {
    writeOut: (value: string) => { stdout += value; },
    writeErr: (value: string) => { stderr += value; },
  };
  root.exitOverride().configureOutput(output);
  plugin.exitOverride().configureOutput(output);

  const search = configurePluginSearchSurface(plugin.command('search'));
  search.exitOverride().configureOutput(output).action((query: string | undefined, options: { format: string }) => {
    parsed = { kind: 'run', command: 'search', ...(query !== undefined ? { query } : {}), format: validateHostedFormat(options.format), formatExplicit: search.getOptionValueSource('format') === 'cli' };
  });
  const install = configurePluginInstallSurface(plugin.command('install'));
  install.exitOverride().configureOutput(output).action((source: string) => {
    parsed = { kind: 'run', command: 'install', source };
  });
  const list = configurePluginListSurface(plugin.command('list'));
  list.exitOverride().configureOutput(output).action((options: { format: string }) => {
    parsed = { kind: 'run', command: 'list', format: validateHostedFormat(options.format), formatExplicit: list.getOptionValueSource('format') === 'cli' };
  });
  const uninstall = configurePluginUninstallSurface(plugin.command('uninstall'));
  uninstall.exitOverride().configureOutput(output).action((name: string) => {
    parsed = { kind: 'run', command: 'uninstall', name };
  });
  const update = configurePluginUpdateSurface(plugin.command('update'));
  update.exitOverride().configureOutput(output).action((name: string | undefined, options: { all?: boolean }) => {
    parsed = { kind: 'run', command: 'update', ...(name !== undefined ? { name } : {}), all: options.all === true };
  });
  const create = plugin.command('create')
    .description('Create a new plugin scaffold')
    .argument('<name>', 'Plugin name (lowercase, hyphens allowed)')
    .option('-d, --dir <path>', 'Output directory (default: ./<name>)')
    .option('--description <text>', 'Plugin description')
    .option('--author-name <name>', 'Author display name')
    .option('--author-handle <handle>', 'Author GitHub handle');
  create.exitOverride().configureOutput(output).action((name: string, options: {
    dir?: string;
    description?: string;
    authorName?: string;
    authorHandle?: string;
  }) => {
    parsed = {
      kind: 'run',
      command: 'create',
      name,
      ...(options.dir !== undefined ? { dir: options.dir } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.authorName !== undefined ? { authorName: options.authorName } : {}),
      ...(options.authorHandle !== undefined ? { authorHandle: options.authorHandle } : {}),
    };
  });

  try {
    root.parse(literal ? ['--', 'plugin', ...argv] : ['plugin', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', output: stdout };
    throw new CommanderStructuralError(stderr || `${error.message}\n`, error.exitCode);
  }
  if (!parsed) throw new CommanderStructuralError("error: command 'plugin' did not run\n", 1);
  return parsed;
}

type ParsedHostedCompletionSurface =
  | { kind: 'help'; output: string }
  | { kind: 'run'; shell: string };

function parseHostedCompletionSurface(
  argv: readonly string[],
  literal: boolean,
): ParsedHostedCompletionSurface {
  let stdout = '';
  let stderr = '';
  let shell: string | undefined;
  const root = new Command('webcmd');
  const completion = configureCompletionCommandSurface(root.command('completion'));
  const output = {
    writeOut: (value: string) => { stdout += value; },
    writeErr: (value: string) => { stderr += value; },
  };
  root.exitOverride().configureOutput(output);
  completion.exitOverride().configureOutput(output).action((value: string) => {
    shell = value;
  });

  try {
    root.parse(literal ? ['--', 'completion', ...argv] : ['completion', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', output: stdout };
    throw new CommanderStructuralError(stderr || `${error.message}\n`, error.exitCode);
  }
  if (shell === undefined) {
    throw new CommanderStructuralError("error: missing required argument 'shell'\n", 1);
  }
  return { kind: 'run', shell };
}

function parseUnknownSiteRootOptions(
  argv: readonly string[],
  literal: boolean,
): { help: boolean; version: boolean; profile?: string } {
  if (literal) return { help: false, version: false };
  let profile: string | undefined;
  let help = false;
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === '--') break;
    if (token === '--profile') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new CommanderStructuralError("error: option '--profile <name>' argument missing\n", 1);
      }
      profile = value;
      i += 1;
      continue;
    }
    if (token.startsWith('--profile=')) {
      profile = token.slice('--profile='.length);
      continue;
    }
    if (token === '--version' || token.startsWith('-V')) {
      return { help: false, version: true, ...(profile !== undefined ? { profile } : {}) };
    }
    if (token === '--help' || token === '-h') help = true;
  }
  return { help, version: false, ...(profile !== undefined ? { profile } : {}) };
}

function hasTerminalBeforeSeparator(
  argv: readonly string[],
  predicate: (token: string) => boolean,
): boolean {
  for (const token of argv) {
    if (token === '--') return false;
    if (predicate(token)) return true;
  }
  return false;
}

function hostedCompletions(manifest: HostedManifest, argv: string[]): string[] {
  const index = argv.indexOf('--get-completions');
  const rest = index === -1 ? argv : argv.slice(index + 1);
  const words: string[] = [];
  let cursor: number | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--cursor' && i + 1 < rest.length) {
      cursor = Number.parseInt(rest[++i]!, 10);
    } else {
      words.push(rest[i]!);
    }
  }
  return getCommandCompletionCandidates(
    hostedCommands(manifest),
    words,
    Number.isFinite(cursor) ? cursor! : words.length,
    HOSTED_BUILTIN_COMMANDS.filter(command => command !== 'web'),
  );
}

function errorExitCode(err: unknown): number {
  if (err instanceof ConfigError) return err.exitCode;
  if (err && typeof err === 'object' && 'exitCode' in err && typeof (err as { exitCode?: unknown }).exitCode === 'number') {
    return (err as { exitCode: number }).exitCode;
  }
  return EXIT_CODES.GENERIC_ERROR;
}

interface InstalledHostedContractIdentity {
  schemaVersion: number;
  webcmdVersion: string;
}

function validateManifestContractIdentity(manifest: HostedManifest): void {
  const installed = readInstalledHostedContractIdentity();
  const installedLine = hostedContractCompatibilityLine(installed.webcmdVersion);
  const manifestLine = hostedContractCompatibilityLine(manifest.metadata.webcmdPackageVersion);
  if (
    manifest.metadata.contractSchemaVersion !== installed.schemaVersion
    || manifest.metadata.sessionProtocolVersion !== HOSTED_SESSION_PROTOCOL_VERSION
    || !installedLine
    || !manifestLine
    || manifestLine !== installedLine
  ) {
    throw new HostedClientError(
      'HOSTED_CONTRACT_MISMATCH',
      'Webcmd Cloud manifest does not match this installed Webcmd hosted contract.',
    );
  }
}

async function getPresentationManifest(client: HostedClient): Promise<HostedManifest> {
  const manifest = await client.getManifest();
  validateManifestContractIdentity(manifest);
  return withClientOwnedCommands(manifest);
}

function hostedContractCompatibilityLine(version: string): string | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return undefined;
  return `${match[1]}.${match[2]}.0`;
}

function readInstalledHostedContractIdentity(): InstalledHostedContractIdentity {
  try {
    const moduleFile = fileURLToPath(import.meta.url);
    const packageRoot = findPackageRoot(moduleFile);
    const value = JSON.parse(readFileSync(path.join(packageRoot, 'hosted-contract.json'), 'utf-8')) as unknown;
    if (
      !value
      || typeof value !== 'object'
      || typeof (value as { schemaVersion?: unknown }).schemaVersion !== 'number'
      || typeof (value as { webcmdVersion?: unknown }).webcmdVersion !== 'string'
    ) {
      throw new Error('invalid hosted contract identity');
    }
    return value as InstalledHostedContractIdentity;
  } catch {
    throw new HostedClientError(
      'HOSTED_PROTOCOL',
      'The installed Webcmd hosted contract could not be validated.',
    );
  }
}

function hostedCommandName(argv: readonly string[]): string | undefined {
  const positionals: string[] = [];
  const valueOptions = new Set(['--profile', '-f', '--format', '--trace']);
  for (let i = 0; i < argv.length && positionals.length < 2; i += 1) {
    const token = argv[i]!;
    if (valueOptions.has(token)) {
      i += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    positionals.push(token);
  }
  if (positionals.length < 2) return positionals[0];
  return `${positionals[0]}/${positionals[1]}`;
}

function hostedTraceMode(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--trace') return argv[i + 1];
    if (argv[i]?.startsWith('--trace=')) return argv[i]!.slice('--trace='.length);
  }
  return undefined;
}
