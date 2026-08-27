import { readFileSync } from 'node:fs';
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
import { addOutputFormatOption, CommanderStructuralError, MissingRequiredPositionalError, outputFormatIsExplicit, requestedOutputFormat, resolveCommandFromArgv, structuralErrorFromCommander } from '../command-surface.js';
import { filterCommandsByTag, formatRootHelp, getCommandCompletionCandidates } from '../command-presentation.js';
import {
  getHostedBuiltinCommands,
  getHostedBuiltinSubcommands,
  getHostedRootHelp,
  HOSTED_ROOT_HELP,
  isLocalClientRootCommand,
  LOCAL_ONLY_COMMAND_HELP,
} from '../completion-shared.js';
import { splitAdapterCommandKey } from '../adapter-source.js';
import { ArgumentError, CliError, ConfigError, EXIT_CODES, InterruptedError, toEnvelope } from '../errors.js';
import { getRequestedHelpFormat, renderStructuredHelp } from '../help.js';
import { WEBCMD_ROOT_COMMANDS } from '../hooks.js';
import { enableVerbose } from '../logger.js';
import { findPackageRoot } from '../package-paths.js';
import { errorEnvelopeFormat, formatErrorEnvelope, requestedFormatFromArgv, requestedMachineFormat, render as renderOutput } from '../output.js';
import { StreamWriteError, writeToStream } from '../stream-write.js';
import { PKG_VERSION } from '../version.js';
import { getCompletionScriptFast } from '../completion-fast.js';
import { browserCommandCatalog } from '../browser/command-catalog.js';
import { loadBrowserRunSource, readProcessStdin } from '../browser/run/input.js';
import { BrowserRunError } from '../browser/run/types.js';
import { CLI_COMMAND } from '../brand.js';
import { formatPluginSearchEmptyCopy, presentPluginSearch } from '../plugin-search-presentation.js';
import { missingPluginGuidance } from '../discovery.js';
import type { ExternalCliConfig } from '../external.js';
import { webFetchCommand } from '../fetch/command.js';
import { runHostedArtifactDownload } from './artifact-download.js';
import { HostedClient, HostedClientError, resolveWorkspace } from './client.js';
import { hasHostedCoreCommand, type HostedCoreCommandId } from './core-commands.js';
import { parseHostedCoreCommand, validateHostedFormat, type ParsedHostedCoreCommand } from './core-command-surface.js';
import { createVirtualHostedFileIo, realHostedFileIo, type HostedFileIo } from './file-io.js';
import { HOSTED_SESSION_PROTOCOL_VERSION } from './types.js';
import { parseHostedInvocation } from './args.js';
import { parseHostedAuthCommand, type ParsedHostedAuthCommand } from './auth-command-surface.js';
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
import {
  isHostedConfig,
  loadWebcmdConfig,
  resolveHostedProfileSelection,
  saveWebcmdConfig,
  withHostedPreferredProfile,
  type HostedProfileSelection,
  type HostedWebcmdConfig,
  type WebcmdConfig,
} from './config.js';
import { resolveHostedApiKey, type HostedCredentialStore } from './credentials.js';
import { parseHostedRootCommandSurface } from '../root-command-surface.js';
import { registerSiteCommands, type SiteMemoryBackend } from '../site-memory/commands.js';
import type {
  HostedAuthoringCommandResponse,
  HostedBrowserActionName,
  HostedBrowserRunActionResponse,
  HostedBrowserSnapshotActionResponse,
  HostedCommand,
  HostedManifest,
} from './types.js';
import type { HostedBrowserCommandContract } from './contract.js';
import {
  createVirtualFileMap,
  createVirtualOutputSink,
  type VirtualFileMap,
  type VirtualOutputSink,
} from './virtual-files.js';

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
  /** Explicitly grants the hosted runner public-network-only web fetch authority. */
  enableServerWebFetch?: boolean;
  /** True when the installed executable can handle client-owned root commands locally. */
  hasLocalClientCommandHandlers?: boolean;
  /** @internal Receives sanitized manifest resolution metadata for embedders. */
  onTrustedCommandResolution?: (resolution: TrustedCommandResolution) => void;
  /** Supplies `--stdin` content without reading `process.stdin`. */
  stdin?: string;
  /** Cancels the invocation; derived from the inbound HTTP request by the MCP path. */
  signal?: AbortSignal;
  /** When set, every file read resolves against this map instead of the filesystem. */
  files?: VirtualFileMap;
  /** When set, every file write lands here instead of the filesystem. */
  outputs?: VirtualOutputSink;
  /** Explicitly grants access to the installed client's external registry and executor. */
  externals?: {
    list(): ExternalCliConfig[];
    run(name: string, args: string[], configs: ExternalCliConfig[]): number;
  };
  /** Optional local roots that are owned only when installed on this client. */
  installedLocalCommandRoots?: ReadonlySet<string>;
  /** @internal Persists hosted profile preference in runner tests and embedders. */
  saveConfig?: (config: HostedWebcmdConfig) => void;
}

interface HostedDispatchIo {
  stdin?: string;
  fileIo: HostedFileIo;
  virtualScaffold?: {
    files: VirtualFileMap;
    outputs: VirtualOutputSink;
  };
}

export interface HostedRunResult {
  handled: boolean;
  exitCode: number;
}

interface TrustedCommandResolution {
  resolvedCommand: string;
  accessClass: 'read' | 'write';
}

interface DeferredExternalSession {
  error: BrowserSessionArgvError;
  args: string[];
  configs: ExternalCliConfig[];
}

class CommanderCompatibleError extends Error {
  constructor(
    readonly output: string,
    readonly exitCode: number,
    readonly stdoutOutput?: string,
    readonly appendErrorEnvelope = false,
  ) {
    super(output.trimEnd());
  }
}

const hostedBrowserCommandsByPath = new Map(browserCommandCatalog.map(command => [command.command, command]));

export async function runHostedCli(argv: string[], opts: HostedRunnerOptions = {}): Promise<HostedRunResult> {
  const config = opts.config ?? loadWebcmdConfig({ env: opts.env, homeDir: opts.homeDir });
  if (!isHostedConfig(config)) return { handled: false, exitCode: EXIT_CODES.SUCCESS };
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  try {
    argv = rejectPositionalBrowserSessionArgv(argv);
    let deferredExternalSession: DeferredExternalSession | undefined;
    try {
      argv = rejectMisplacedSessionSelectorArgv(argv);
    } catch (error) {
      if (!(error instanceof BrowserSessionArgvError) || !opts.externals) throw error;
      const root = parseHostedRootCommandSurface(argv);
      if (root.kind !== 'dispatch') throw error;
      const [site, ...args] = root.argv;
      if (!site || isWebcmdOwnedRoot(site, opts.installedLocalCommandRoots)) throw error;
      const configs = opts.externals.list();
      if (!configs.some(config => config.name === site)) throw error;
      deferredExternalSession = { error, args, configs };
    }
    const rootSurface = parseHostedRootCommandSurface(argv);
    const rootName = rootSurface.kind === 'dispatch' ? rootSurface.argv[0] : undefined;
    if (rootName && opts.installedLocalCommandRoots?.has(rootName)) {
      throw new ConfigError(`${CLI_COMMAND} ${rootName} is local-only and is not available in hosted mode.`, LOCAL_ONLY_COMMAND_HELP);
    }
    const externals = rootName && isWebcmdOwnedRoot(rootName, opts.installedLocalCommandRoots)
      ? undefined
      : opts.externals;
    let credential: Awaited<ReturnType<typeof resolveHostedApiKey>>;
    try {
      credential = await resolveHostedApiKey(config, {
        credentialStore: opts.credentialStore,
        env: opts.env,
        homeDir: opts.homeDir,
        platform: opts.platform,
        randomUUID: opts.randomUUID,
        migrate: opts.config === undefined,
      });
    } catch (error) {
      if (rootSurface.kind !== 'help') throw error;
      const help = formatRootHelp(getHostedRootHelp(undefined, opts.hasLocalClientCommandHandlers !== false));
      await writeToStream(rootSurface.exitCode === EXIT_CODES.SUCCESS ? stdout : stderr, help);
      return { handled: true, exitCode: rootSurface.exitCode };
    }
    const currentConfig = credential.migrated
      ? loadWebcmdConfig({ env: opts.env, homeDir: opts.homeDir })
      : config;
    if (!isHostedConfig(currentConfig)) throw new ConfigError('Webcmd hosted configuration could not be reloaded.');
    const profileSelection = resolveHostedProfileSelection(
      currentConfig,
      rootSurface.kind === 'dispatch' ? rootSurface.profile : undefined,
      opts.env ?? process.env,
    );
    const saveConfig = opts.saveConfig ?? (opts.config === undefined
      ? (next: HostedWebcmdConfig) => saveWebcmdConfig(next, { env: opts.env, homeDir: opts.homeDir })
      : undefined);
    if (opts.signal?.aborted) {
      throw opts.signal.reason ?? new Error('The operation was aborted.');
    }
    const client = new HostedClient({
      apiBaseUrl: config.hosted.apiBaseUrl,
      apiKey: credential.apiKey,
      workspace: (rootSurface.kind === 'dispatch' ? rootSurface.workspace : undefined)
        ?? resolveWorkspace([], opts.env ?? process.env),
      fetchImpl: opts.fetchImpl,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const usesVirtualFileIo = opts.files !== undefined || opts.outputs !== undefined;
    const virtualFiles = opts.files ?? createVirtualFileMap([]);
    const virtualOutputs = opts.outputs ?? createVirtualOutputSink();
    const fileIo: HostedFileIo = usesVirtualFileIo
      ? createVirtualHostedFileIo(virtualFiles, virtualOutputs)
      : realHostedFileIo;
    const io: HostedDispatchIo = {
      ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
      fileIo,
      ...(usesVirtualFileIo ? { virtualScaffold: { files: virtualFiles, outputs: virtualOutputs } } : {}),
    };
    const exitCode = await dispatchHosted(
      argv,
      client,
      stdout,
      stderr,
      opts.now ?? Date.now,
      opts.homeDir ?? opts.env?.HOME ?? homedir(),
      io,
      opts.enableServerWebFetch === true,
      opts.hasLocalClientCommandHandlers !== false,
      opts.signal,
      opts.onTrustedCommandResolution,
      externals,
      opts.installedLocalCommandRoots,
      deferredExternalSession,
      currentConfig,
      profileSelection,
      saveConfig,
    );
    return { handled: true, exitCode: exitCode ?? EXIT_CODES.SUCCESS };
  } catch (caught) {
    if (caught instanceof StreamWriteError) throw caught;
    const err = opts.signal?.aborted ? new InterruptedError() : caught;
    if (err instanceof BrowserSessionArgvError) {
      await writeToStream(stderr, `error: ${err.message}\n`);
      return { handled: true, exitCode: EXIT_CODES.USAGE_ERROR };
    }
    if (err instanceof CommanderStructuralError) {
      // Usage errors carry their own envelope; honour -f/--format and --json the
      // same way the local CLI does instead of falling back to UNKNOWN/exit 1.
      const usageFormat = requestedMachineFormat(argv);
      if (usageFormat && err.envelope) {
        await writeToStream(stderr, formatErrorEnvelope(err.envelope, { fmt: usageFormat }));
        return { handled: true, exitCode: err.exitCode };
      }
      await writeToStream(stderr, err.output);
      if (err.appendErrorEnvelope) {
        await writeToStream(stderr, formatErrorEnvelope(toEnvelope(err), {
          fmt: errorEnvelopeFormat(requestedFormatFromArgv(argv)),
        }));
      }
      return { handled: true, exitCode: err.exitCode };
    }
    if (err instanceof CommanderCompatibleError) {
      await writeToStream(stderr, err.output);
      if (err.appendErrorEnvelope) {
        await writeToStream(stderr, formatErrorEnvelope(toEnvelope(err), {
          fmt: errorEnvelopeFormat(requestedFormatFromArgv(argv)),
        }));
      }
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
      fmt: errorEnvelopeFormat(requestedFormatFromArgv(argv)),
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
  io: HostedDispatchIo = { fileIo: realHostedFileIo },
  enableServerWebFetch = false,
  hasLocalClientCommandHandlers = true,
  signal?: AbortSignal,
  onResolvedCommand?: (resolution: TrustedCommandResolution) => void,
  externals?: {
    list(): ExternalCliConfig[];
    run(name: string, args: string[], configs: ExternalCliConfig[]): number;
  },
  installedLocalCommandRoots?: ReadonlySet<string>,
  deferredExternalSession?: DeferredExternalSession,
  config?: HostedWebcmdConfig,
  profileSelection?: HostedProfileSelection,
  saveConfig?: (config: HostedWebcmdConfig) => void,
): Promise<number | undefined> {
  const normalized = parseHostedRootCommandSurface(argv);
  let manifestPromise: Promise<HostedManifest> | undefined;
  const getManifest = async (): Promise<HostedManifest> => {
    const manifest = await (manifestPromise ??= client.getManifest());
    validateManifestContractIdentity(manifest);
    return manifest;
  };
  let validatedPreferredProfile: Promise<string | undefined> | undefined;
  const profileForRequest = (override?: string): Promise<string | undefined> => {
    if (override !== undefined) return Promise.resolve(override);
    if (!profileSelection) return Promise.resolve(undefined);
    if (profileSelection.source !== 'preferred') return Promise.resolve(profileSelection.name);
    validatedPreferredProfile ??= requireListedHostedProfile(client, profileSelection.name);
    return validatedPreferredProfile;
  };
  if (normalized.kind === 'help') {
    let coreCommands: readonly HostedCoreCommandId[] | undefined;
    try {
      coreCommands = (await getManifest()).metadata.coreCommands;
    } catch (error) {
      if (signal?.aborted || error instanceof InterruptedError) throw error;
      // Root help remains usable while offline, logged out, or paired with an incompatible Cloud.
    }
    const help = formatRootHelp(getHostedRootHelp(coreCommands, hasLocalClientCommandHandlers));
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
    const manifest = withClientOwnedCommands(await getManifest(), enableServerWebFetch);
    await writeToStream(stdout, hostedCompletions(manifest, normalized.argv, hasLocalClientCommandHandlers).join('\n') + '\n');
    return;
  }
  const args = normalized.argv;
  let hostedAuth: Extract<ParsedHostedAuthCommand, { kind: 'run' }> | undefined;
  if (args[0] === 'auth' && (!args[1] || args[1] === 'status' || args[1] === 'refresh' || args[1] === '--help' || args[1] === '-h')) {
    const parsed = parseHostedAuthCommand(args, normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    hostedAuth = parsed;
  }
  if (!hasLocalClientCommandHandlers && isLocalClientRootCommand(args[0])) {
    throw new CommanderCompatibleError(`error: unknown command '${args[0]}'\n`, EXIT_CODES.USAGE_ERROR);
  }
  if (args[0] === 'completion') {
    const parsed = parseHostedCompletionSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    const script = getCompletionScriptFast(parsed.shell);
    if (script === undefined) {
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
  if (isHostedCoreRoot(args[0])) {
    const parsed = parseHostedCoreCommand(args, normalized.literal);
    await requireHostedCoreCommand(getManifest, parsed.command);
    const profile = parsed.command === 'verify' || parsed.command === 'doctor'
      ? await profileForRequest()
      : undefined;
    return dispatchHostedCoreCommand(parsed, client, stdout, profile);
  }
  if (args[0] === 'session') {
    const parsed = parseHostedSessionSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    await getManifest();
    await dispatchHostedSession(parsed, client, stdout, await profileForRequest());
    return;
  }
  if (args[0] === 'browser') {
    const invocation = await parseHostedBrowserInvocation(args, profileSelection?.name, normalized.session, io);
    await getManifest();
    await dispatchHostedBrowser({ ...invocation, profile: await profileForRequest() }, client, stdout, io);
    return;
  }

  if (args[0] === 'artifact') {
    await runHostedArtifactDownload(args.slice(1), client, stdout, io.fileIo);
    return;
  }

  if (args[0] === 'site') {
    await runHostedSiteSurface(args.slice(1), normalized.literal, client, stdout);
    return;
  }

  if (args[0] === 'adapter' && (args[1] === 'source' || args[1] === 'path' || args[1] === 'override' || args[1] === 'status' || args[1] === 'reset' || args[1] === '--help' || args[1] === '-h')) {
    await runHostedAdapterSurface(args.slice(1), normalized.literal, client, stdout, homeDir, io, getManifest);
    return;
  }

  if (args[0] === 'list') {
    const parsed = parseHostedListSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    const manifest = await getPresentationManifest(client, enableServerWebFetch);
    await renderHostedList(manifest, parsed.format, parsed.formatExplicit, stdout, parsed.tag);
    return;
  }

  if (args[0] === 'profile') {
    const parsed = parseHostedProfileSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    if (parsed.command === 'create' || parsed.command === 'rename') {
      await requireHostedCoreCommand(getManifest, `profile/${parsed.command}`);
    }
    if (!config) throw new Error('Internal invariant: hosted configuration is unavailable.');
    await dispatchHostedProfile(parsed, client, stdout, config, saveConfig);
    return;
  }

  if (args[0] === 'plugin') {
    const subcommand = args[1];
    if (subcommand === 'catalog' && args[2] !== 'list') {
      throw new ConfigError(
        `webcmd plugin catalog${args[2] ? ` ${args[2]}` : ''} is not available in hosted mode.`,
        'Hosted mode supports: webcmd plugin catalog list.',
      );
    }
    const allowed = new Set(['search', 'install', 'list', 'uninstall', 'update', 'create', 'catalog', '--help', '-h']);
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
      const presented = presentPluginSearch(result, parsed.query);
      if (parsed.format === 'json') {
        await renderOutput(presented, { fmt: 'json', stdout });
      } else {
        for (const error of result.errors) await writeToStream(stderr, `Warning: ${error.sourceId}: ${error.message}\n`);
        if (presented.total === 0) {
          await writeToStream(stdout, `${formatPluginSearchEmptyCopy(presented.query)}\n`);
        } else {
          await renderOutput(result.plugins.map(plugin => ({
            ...plugin,
            excludedCommands: plugin.excludedCommands.join(','),
          })), {
            fmt: parsed.format,
            fmtExplicit: parsed.formatExplicit,
            columns: ['installSource', 'name', 'description', 'version', 'sourceId', 'webcmd', 'availability', 'excludedCommands'],
            title: `${CLI_COMMAND}/plugin-search`,
            source: `${CLI_COMMAND} plugin search`,
            stdout,
          });
        }
      }
      return;
    }
    if (parsed.command === 'install') {
      if (parsed.all) {
        throw new ConfigError(
          'plugin install --all is not available in hosted mode.',
          'Install one plugin with `webcmd plugin install github:user/repo/<plugin>`, or run `webcmd setup` and choose local mode for --all.',
        );
      }
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
    if (parsed.command === 'catalog-list') {
      await requireHostedCoreCommand(getManifest, 'plugin/catalog/list');
      const result = await client.listMarketplaceCatalog();
      await renderOutput(parsed.format === 'table' ? result.sources : result, {
        fmt: parsed.format,
        fmtExplicit: parsed.formatExplicit,
        columns: ['id', 'repository', 'commit', 'manifestPath', 'status'],
        title: `${CLI_COMMAND}/plugin-catalog`,
        source: `${CLI_COMMAND} plugin catalog list`,
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
    const { createPluginScaffold, createVirtualPluginScaffold } = await import('../plugin-scaffold.js');
    const scaffoldOptions = {
      ...(parsed.dir !== undefined ? { dir: parsed.dir } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      author: { name: parsed.authorName ?? '', handle: parsed.authorHandle ?? '' },
    };
    const result = io.virtualScaffold
      ? createVirtualPluginScaffold(parsed.name, scaffoldOptions, {
          exists: (target) => virtualScaffoldConflicts(io.virtualScaffold!.files, target),
          isEmptyDir: (target) => !virtualScaffoldConflicts(io.virtualScaffold!.files, target),
          mkdir: () => undefined,
          writeFile: (target, body) => {
            io.virtualScaffold!.outputs.write(target, new TextEncoder().encode(body));
          },
        })
      : createPluginScaffold(parsed.name, scaffoldOptions);
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
  const manifest = withClientOwnedCommands(await getManifest(), enableServerWebFetch);

  const site = args[0]!;
  const commandName = args[1];
  const siteExists = manifest.commands.some(command => command.site === site);
  if (siteExists && deferredExternalSession) throw deferredExternalSession.error;
  if (!siteExists) {
    // Externals are local binaries, not adapters: registry lookup, PATH check,
    // spawn. Nothing reaches Cloud. This runs before parseUnknownSiteRootOptions
    // so `webcmd gh --version` forwards --version to gh, matching the local
    // passThroughOptions() behavior instead of printing the webcmd version.
    if (externals) {
      const externalConfigs = deferredExternalSession?.configs ?? externals.list();
      if (externalConfigs.some(config => config.name === site)) {
        if (isWebcmdOwnedRoot(site, installedLocalCommandRoots)) {
          throw new ConfigError(`${CLI_COMMAND} ${site} is local-only and is not available in hosted mode.`, LOCAL_ONLY_COMMAND_HELP);
        }
        return externals.run(
          site,
          deferredExternalSession?.args ?? args.slice(1),
          externalConfigs,
        );
      }
    }
    const unknownRoot = parseUnknownSiteRootOptions(args, normalized.literal);
    if (unknownRoot.version) {
      await writeToStream(stdout, `${PKG_VERSION}\n`);
      return;
    }
    if (unknownRoot.help) {
      await writeToStream(stdout, formatRootHelp(getHostedRootHelp(manifest.metadata.coreCommands, hasLocalClientCommandHandlers)));
      return;
    }
    // No help on stdout: an error path that emits a well-formed document to
    // stdout reads as success to anything parsing it.
    throw new CommanderCompatibleError(`${missingPluginGuidance(site)}\n`, EXIT_CODES.USAGE_ERROR);
  }
  if (!commandName || commandName === '--help' || commandName === '-h') {
    const data = hostedSiteHelpData(manifest, site);
    if (!data) {
      throw new CommanderCompatibleError(`error: unknown command '${site}'\n`, EXIT_CODES.USAGE_ERROR);
    }
    await writeHostedHelp(stdout, args, data, renderHostedSiteHelp(manifest, site));
    return;
  }

  const command = findHostedCommand(manifest, site, commandName);
  if (!command) {
    if (!normalized.literal && hasTerminalBeforeSeparator(args.slice(1), token => token === '--help' || token === '-h')) {
      const data = hostedSiteHelpData(manifest, site);
      if (!data) {
        throw new CommanderCompatibleError(`error: unknown command '${site}'\n`, EXIT_CODES.USAGE_ERROR);
      }
      await writeHostedHelp(stdout, args, data, renderHostedSiteHelp(manifest, site));
      return;
    }
    // Same usage-error contract as the local CLI: exit 2 plus the valid
    // subcommands for the site, not a trailing UNKNOWN/exit-1 envelope.
    // Same shape as the local `help:` line (see visibleSubcommandNames): sorted,
    // no `help` entry. Commands hosted mode cannot run are genuinely absent.
    const known = [...new Set(hostedCommands(manifest).filter(entry => entry.site === site).map(entry => entry.name))].sort();
    const help = known.length > 0 ? `help: valid subcommands for \`webcmd ${site}\`: ${known.join(', ')}\n` : '';
    throw new CommanderCompatibleError(
      `error: unknown command '${commandName}'\n${help}`,
      EXIT_CODES.USAGE_ERROR,
    );
  }
  if (isLocalOnlyHostedCommand(command)) {
    throw new ConfigError(
      `Command ${command.command} is local-only and is not available in hosted mode.`,
      LOCAL_ONLY_COMMAND_HELP,
    );
  }
  onResolvedCommand?.(trustedCommandResolution(command));
  let parsed: ReturnType<typeof parseHostedInvocation>;
  if (hostedAuth && hostedAuth.command === command.command) {
    parsed = hostedAuth;
  } else {
    try {
      parsed = parseHostedInvocation(command, args.slice(2));
    } catch (error) {
      if (error instanceof CommanderStructuralError) {
        // A usage error carries its own envelope; only the legacy fallback needs
        // the UNKNOWN envelope appended after the human bytes.
        throw new CommanderStructuralError(error.output, error.exitCode, !error.envelope, error.envelope);
      }
      throw error;
    }
  }
  if (parsed.help) {
    await writeHostedHelp(stdout, args, hostedCommandHelpData(command), renderHostedCommandHelp(command));
    return;
  }
  if (command.clientOwned) {
    if (command.command !== 'web/fetch' || !enableServerWebFetch) {
      throw new Error(`Internal invariant: client-owned command ${command.command} reached hosted dispatch.`);
    }
    if (parsed.optionSources['allow-private'] === 'cli') {
      throw new ArgumentError('--allow-private is not available in hosted mode');
    }
    enableVerbose(parsed.verbose);
    const startTime = now();
    const { webFetch } = await import('../fetch/client.js');
    const result = await webFetch({
      url: String(parsed.args.url),
      timeoutSeconds: Number(parsed.args.timeout ?? 30),
      maxChars: Number(parsed.args['max-chars'] ?? 50_000),
      allowPrivate: false,
      raw: parsed.args.raw === true,
      ...(signal ? { signal } : {}),
    });
    await renderOutput(result, {
      fmt: parsed.format,
      fmtExplicit: parsed.formatExplicit,
      columns: command.columns,
      title: command.command,
      elapsed: (now() - startTime) / 1000,
      source: command.command,
      ...(webFetchCommand.renderMarkdown ? { markdown: webFetchCommand.renderMarkdown } : {}),
      stdout,
    });
    return;
  }
  // Hosted dispatch parsed `-v` but never acted on it, so the flag that local
  // mode honours was a silent no-op here (#174). Applying it before the request
  // lights up the client's HTTP diagnostics on the same env contract local mode
  // uses, keeping the two modes' verbose behaviour aligned.
  enableVerbose(parsed.verbose);

  const startTime = now();
  const profile = await profileForRequest(parsed.profile);
  const response = command.browser || hasPresentFileArgument(command, parsed.args)
    ? await executeHostedPreparedCommand({
        client,
        command,
        args: parsed.args,
        format: parsed.format,
        trace: parsed.trace,
        profile,
        session: normalized.session,
        stderr,
        io,
      })
    : await client.execute({
        command: command.command,
        args: parsed.args,
        format: parsed.format,
        trace: parsed.trace,
        profile,
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

function isHostedCoreRoot(value: string | undefined): value is ParsedHostedCoreCommand['command'] {
  return value === 'validate' || value === 'verify' || value === 'convention-audit' || value === 'doctor';
}

async function requireHostedCoreCommand(
  getManifest: () => Promise<HostedManifest>,
  id: HostedCoreCommandId,
): Promise<HostedManifest> {
  const manifest = await getManifest();
  if (!hasHostedCoreCommand(manifest.metadata.coreCommands, id)) {
    throw new ConfigError(
      `${CLI_COMMAND} ${id.replaceAll('/', ' ')} is not available from this Webcmd Cloud endpoint.`,
      'Upgrade Webcmd Cloud or use a compatible endpoint.',
    );
  }
  return manifest;
}

async function dispatchHostedCoreCommand(
  parsed: ParsedHostedCoreCommand,
  client: HostedClient,
  stdout: NodeJS.WritableStream,
  profile?: string,
): Promise<number | undefined> {
  if (parsed.command === 'validate') {
    const report = await client.validateAdapters(parsed.target);
    if (parsed.format === 'table') {
      const { renderValidationReport } = await import('../validate.js');
      await writeToStream(stdout, `${renderValidationReport(report)}\n`);
    } else {
      await renderOutput(report, { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, stdout });
    }
    return report.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERIC_ERROR;
  }
  if (parsed.command === 'verify') {
    const report = await client.verifyAdapters({
      ...(parsed.target !== undefined ? { target: parsed.target } : {}),
      smoke: parsed.smoke,
      ...(profile !== undefined ? { profile } : {}),
    });
    if (parsed.format === 'table') {
      const { renderVerifyReport } = await import('../verify.js');
      await writeToStream(stdout, `${renderVerifyReport(report)}\n`);
    } else {
      await renderOutput(report, { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, stdout });
    }
    return report.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERIC_ERROR;
  }
  if (parsed.command === 'convention-audit') {
    const report = await client.auditAdapterConventions({
      ...(parsed.target !== undefined ? { target: parsed.target } : {}),
      ...(parsed.site !== undefined ? { site: parsed.site } : {}),
    });
    if (parsed.format === 'table') {
      const { renderConventionAuditText } = await import('../convention-audit.js');
      await writeToStream(stdout, `${renderConventionAuditText(report)}\n`);
    } else {
      await renderOutput(report, { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, stdout });
    }
    return parsed.strict && !report.ok ? EXIT_CODES.GENERIC_ERROR : EXIT_CODES.SUCCESS;
  }
  enableVerbose(parsed.verbose);
  const report = await client.getDoctor(profile);
  if (parsed.format === 'table') {
    await writeToStream(stdout, `${report.checks.map(check => `${check.ok ? 'PASS' : 'FAIL'}  ${check.id}  ${check.message}`).join('\n')}\n`);
  } else {
    await renderOutput(report, { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, stdout });
  }
  return report.checks.some(check => check.required && !check.ok)
    ? EXIT_CODES.CONFIG_ERROR
    : EXIT_CODES.SUCCESS;
}

function virtualScaffoldConflicts(files: VirtualFileMap, target: string): boolean {
  for (const existing of files.keys()) {
    if (existing === target || existing.startsWith(`${target}/`) || target.startsWith(`${existing}/`)) {
      return true;
    }
  }
  return false;
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
    if (error instanceof CommanderError) throw structuralErrorFromCommander(error, resolveCommandFromArgv(root, ['site', ...argv]), stderr);
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

type HostedAdapterCommand =
  | { kind: 'get'; commandKey: string; output?: string }
  | { kind: 'put'; commandKey: string; path: string }
  | { kind: 'path'; commandKey: string }
  | { kind: 'override'; commandKey: string }
  | { kind: 'status'; format: string; formatExplicit: boolean }
  | { kind: 'reset'; site?: string; all: boolean; format: string; formatExplicit: boolean };

function joinAdapterCommandKey(commandKey: string, commandName?: string): string {
  const key = splitAdapterCommandKey(commandKey, commandName);
  return key ? `${key.site}/${key.command}` : commandKey;
}

async function runHostedAdapterSurface(
  argv: readonly string[],
  literal: boolean,
  client: HostedClient,
  stdout: NodeJS.WritableStream,
  homeDir: string,
  io: HostedDispatchIo,
  getManifest: () => Promise<HostedManifest>,
): Promise<void> {
  let parsed: HostedAdapterCommand | undefined;
  let help = '';
  let stderr = '';
  const root = new Command('webcmd').exitOverride().configureOutput({
    writeOut: value => { help += value; },
    writeErr: value => { stderr += value; },
  });
  const adapter = root.command('adapter');
  const source = adapter.command('source');
  source.command('get').argument('<command>').argument('[name]').option('-o, --output <path>').action((commandKey, name: string | undefined, opts: { output?: string }) => {
    parsed = { kind: 'get', commandKey: joinAdapterCommandKey(commandKey, name), output: opts.output };
  });
  source.command('put').argument('<command>').argument('<path-or-name>').argument('[path]').action((commandKey, pathOrName: string, maybePath?: string) => {
    parsed = maybePath
      ? { kind: 'put', commandKey: joinAdapterCommandKey(commandKey, pathOrName), path: maybePath }
      : { kind: 'put', commandKey, path: pathOrName };
  });
  adapter.command('path').argument('<command>').argument('[name]').action((commandKey, name?: string) => {
    parsed = { kind: 'path', commandKey: joinAdapterCommandKey(commandKey, name) };
  });
  adapter.command('override')
    .description('Fork an installed adapter command into a private copy you can modify')
    .argument('<command>', 'Command to override, as <site>/<command>')
    .action(commandKey => { parsed = { kind: 'override', commandKey }; });
  const status = addOutputFormatOption(adapter.command('status'));
  status.action((options: { format: string }) => {
    parsed = {
      kind: 'status',
      format: validateHostedFormat(String(requestedOutputFormat(status, options.format))),
      formatExplicit: outputFormatIsExplicit(status),
    };
  });
  const reset = addOutputFormatOption(adapter.command('reset').argument('[site]').option('--all', 'Reset all hosted overrides', false));
  reset.action((site: string | undefined, options: { all?: boolean; format: string }) => {
    const all = options.all === true;
    if ((!site && !all) || (site !== undefined && all)) throw new ArgumentError('Specify one adapter site or --all.');
    parsed = {
      kind: 'reset',
      ...(site !== undefined ? { site } : {}),
      all,
      format: validateHostedFormat(String(requestedOutputFormat(reset, options.format))),
      formatExplicit: outputFormatIsExplicit(reset),
    };
  });
  try {
    await root.parseAsync(literal ? ['--', 'adapter', ...argv] : ['adapter', ...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') {
      await writeToStream(stdout, help);
      return;
    }
    if (error instanceof CommanderError) throw structuralErrorFromCommander(error, resolveCommandFromArgv(root, ['adapter', ...argv]), stderr);
    throw error;
  }
  if (!parsed) throw new CommanderStructuralError("error: command 'adapter' did not run\n", EXIT_CODES.USAGE_ERROR);
  if (parsed.kind === 'status') {
    await requireHostedCoreCommand(getManifest, 'adapter/status');
    await renderOutput(await client.listAdapters(), {
      fmt: parsed.format,
      fmtExplicit: parsed.formatExplicit,
      columns: ['command', 'kind', 'package', 'reconciliationState', 'loadError'],
      title: `${CLI_COMMAND}/adapter-status`,
      source: `${CLI_COMMAND} adapter status`,
      stdout,
    });
    return;
  }
  if (parsed.kind === 'reset') {
    await requireHostedCoreCommand(getManifest, 'adapter/reset');
    const removed = await client.resetAdapterOverrides(parsed.all ? { all: true } : { site: parsed.site });
    if (parsed.format !== 'table') {
      await renderOutput({ ok: true, removed }, { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, stdout });
      return;
    }
    for (const item of removed) await writeToStream(stdout, `${item.package}: ${item.commands.join(', ')}\n`);
    return;
  }
  const { site, command } = parseAdapterCommandKey(parsed.commandKey);
  const destination = hostedAdapterDestination(homeDir, site, command);
  if (parsed.kind === 'path') return writeToStream(stdout, `${destination}\n`);
  if (parsed.kind === 'override') {
    const result = await client.overrideAdapter(parsed.commandKey);
    await writeToStream(stdout, [
      `✅ Override created for ${result.command}`,
      `     package: ${result.packageId}`,
      `     source:  ${result.sourceFile ?? '(unknown)'}`,
      '',
      '  Your private copy now takes precedence over the installed adapter.',
      `  Edit it with: ${CLI_COMMAND} adapter source get ${result.command} then ${CLI_COMMAND} adapter source put ${result.command} <path>`,
      '',
    ].join('\n'));
    return;
  }
  const metadata = await hostedAdapterSourceMetadata(client, parsed.commandKey);
  const sourcePath = metadata.sourceFile ?? metadata.modulePath;
  if (!sourcePath) throw new ConfigError(`Hosted adapter source is unavailable for ${parsed.commandKey}.`);
  validateHostedRelativePath(sourcePath, 'adapter source provenance');
  if (parsed.kind === 'get') {
    const body = await client.readAdapterSource(metadata.adapterPackageId!, sourcePath);
    if (parsed.output === '-') return writeToStream(stdout, body);
    await io.fileIo.writeText(parsed.output ?? hostedAdapterOutputDestination(destination, site, command, io.fileIo), body);
    return;
  }
  const result = await client.writeAdapterSource(
    metadata.adapterPackageId!,
    sourcePath,
    await io.fileIo.readText(parsed.path),
  );
  await writeToStream(stdout, `${result.commands.join('\n')}\n`);
}

function parseAdapterCommandKey(value: string): { site: string; command: string } {
  const parsed = splitAdapterCommandKey(value);
  if (!parsed || !isSafePathSegment(parsed.site) || !isSafePathSegment(parsed.command)) {
    throw new ConfigError('Adapter command must use site/command format.');
  }
  return parsed;
}

function hostedAdapterDestination(homeDir: string, site: string, command: string): string {
  const root = path.resolve(homeDir, '.webcmd', 'hosted', 'clis');
  const destination = path.resolve(root, site, `${command}.js`);
  const relative = path.relative(root, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ConfigError('Hosted adapter destination is invalid.');
  return destination;
}

function hostedAdapterOutputDestination(
  installedDestination: string,
  site: string,
  command: string,
  io: HostedFileIo,
): string {
  return io === realHostedFileIo
    ? installedDestination
    : path.posix.join('.webcmd', 'hosted', 'clis', site, `${command}.js`);
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
  | { kind: 'run'; command: 'create'; name: string; format: string; formatExplicit: boolean }
  | { kind: 'run'; command: 'list'; format: string; formatExplicit: boolean; limit: number }
  | { kind: 'run'; command: 'close'; format: string; formatExplicit: boolean; session: string; force: boolean };

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
  const configure = (command: Command, format: string): Command => addOutputFormatOption(command, format);
  const create = configure(session.command('create').argument('<name>'), 'yaml');
  create.action((name: string, options: { format: string }) => {
    parsed = { kind: 'run', command: 'create', name, format: validateHostedFormat(String(requestedOutputFormat(create, options.format))), formatExplicit: outputFormatIsExplicit(create) };
  });
  const list = configure(session.command('list').option('--limit <number>', 'Maximum Sessions to return (1-100)', parseHostedSessionListLimit, 20), 'table');
  list.action((options: { format: string; limit: number }) => {
    parsed = { kind: 'run', command: 'list', format: validateHostedFormat(String(requestedOutputFormat(list, options.format))), formatExplicit: outputFormatIsExplicit(list), limit: options.limit };
  });
  const close = configure(session.command('close').argument('<session-id>').option('--force', 'Close even while the Session is busy or paused for handoff'), 'yaml');
  close.action((sessionId: string, options: { format: string; force?: boolean }) => {
    parsed = { kind: 'run', command: 'close', format: validateHostedFormat(String(requestedOutputFormat(close, options.format))), formatExplicit: outputFormatIsExplicit(close), session: sessionId, force: options.force === true };
  });
  try {
    root.parse(literal ? ['--', 'session', ...argv] : ['session', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', output: stdout };
    throw structuralErrorFromCommander(error, resolveCommandFromArgv(root, ['session', ...argv]), stderr);
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
    await renderOutput(sessionCreateOutput((await client.createBrowserSession(parsed.name, profile)).session), { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, columns: ['id', 'kind', 'runtimeState'], stdout });
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
  return {
    id: row.id,
    kind: row.kind,
    runtimeState: row.runtimeState,
    ...(typeof row.liveViewUrl === 'string' ? { liveViewUrl: row.liveViewUrl } : {}),
  };
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

async function executeHostedPreparedCommand(input: {
  client: HostedClient;
  command: import('./types.js').HostedCommand;
  args: Record<string, unknown>;
  format: string;
  trace: string;
  profile?: string;
  session?: string;
  stderr: NodeJS.WritableStream;
  io: HostedDispatchIo;
}): Promise<import('./types.js').HostedExecuteResponse> {
  const prepared = await prepareHostedFiles({
    client: input.client,
    command: input.command,
    args: input.args,
    ...(input.profile !== undefined ? { profile: input.profile } : {}),
    ...(input.session !== undefined ? { session: input.session } : {}),
    onPrepared: async (prepared) => {
      if (prepared.liveViewUrl) await writeToStream(input.stderr, `Webcmd live view: ${prepared.liveViewUrl}\n`);
    },
  }, input.io.fileIo);
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
  }, input.io.fileIo);
  return {
    ...response,
    result: rewriteHostedOutputResultPaths(response.result, materialized),
  };
}

interface ParsedHostedBrowserInvocation {
  session?: string;
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
  io: HostedDispatchIo,
): Promise<void> {
  const args = invocation.action === 'set-file-input'
    ? await materializeHostedBrowserUploadArgs(invocation.args, io.fileIo)
    : invocation.args;
  const request = {
    command: invocation.command,
    action: invocation.action,
    args,
    ...(invocation.profile !== undefined ? { profile: invocation.profile } : {}),
    ...(invocation.windowMode !== undefined ? { windowMode: invocation.windowMode } : {}),
    trace: 'off' as const,
  };
  const response = invocation.session === undefined
    ? await client.executeAuthoringCommand(request)
    : await client.runBrowserAction(invocation.session, request);
  await renderHostedBrowserResponse(stdout, invocation, response, io);
}

async function materializeHostedBrowserUploadArgs(
  args: Record<string, unknown>,
  io: HostedFileIo,
): Promise<Record<string, unknown>> {
  const files = args.files;
  if (!Array.isArray(files)) return args;
  return {
    ...args,
    files: await Promise.all(files.map(async (file) => {
      if (typeof file !== 'string') return file;
      const body = await io.readFile(file);
      return {
        $webcmdBrowserUpload: {
          filename: path.posix.basename(file),
          contentType: contentTypeForUpload(file),
          base64: Buffer.from(body).toString('base64'),
        },
      };
    })),
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
  io: HostedDispatchIo,
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
  const sessionless = hostedBrowserCommandsByPath.get(parsed.commandName)?.sessionPolicy === 'sessionless';
  if (sessionless && (session !== undefined || structure.session)) {
    throw new CliError(
      'SESSION_NOT_ALLOWED',
      'browser init and browser verify do not take --session.',
      'Use: webcmd browser init <site>/<command> or webcmd browser verify <site>/<command>',
      EXIT_CODES.USAGE_ERROR,
    );
  }
  const browserArgs = await materializeBrowserRunSource(parsed.commandName, parsed.args, io);
  return {
    ...(sessionless ? {} : { session: validateRawBrowserSession(structure.session, profile) }),
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

async function materializeBrowserRunSource(
  commandName: string,
  args: Record<string, unknown>,
  io: HostedDispatchIo,
): Promise<Record<string, unknown>> {
  if (commandName !== 'run') return args;
  try {
    const source = await loadBrowserRunSource({
      stdin: args.stdin === true,
      file: typeof args.file === 'string' ? args.file : undefined,
    }, {
      readStdin: async () => {
        if (io.stdin !== undefined) return io.stdin;
        if (io.fileIo === realHostedFileIo) return readProcessStdin();
        throw new ConfigError(
          'No stdin was supplied to this invocation.',
          'Pass the program with --file, or supply stdin.',
        );
      },
      readFile: (filePath) => io.fileIo.readText(filePath),
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
  response: HostedBrowserRunActionResponse | HostedBrowserSnapshotActionResponse | HostedAuthoringCommandResponse,
  io: HostedDispatchIo,
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
      await io.fileIo.writeFile(invocation.localPath, Buffer.from(base64, 'base64'));
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
    parsedFormat = validateHostedFormat(String(requestedOutputFormat(list, options.format)));
    parsedTag = options.tag;
    formatExplicit = outputFormatIsExplicit(list);
  });

  try {
    root.parse(literal ? ['--', 'list', ...argv] : ['list', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', output: stdout };
    // No includeCapturedStderrForUnknownOption: structuralErrorFromCommander
    // now formats the `error:` line itself, so replaying Commander's captured
    // stderr on top printed the same line twice in hosted mode only.
    throw structuralErrorFromCommander(error, resolveCommandFromArgv(root, ['list', ...argv]), stderr, {
      appendErrorEnvelope: true,
    });
  }
  if (!actionRan) throw new CommanderStructuralError("error: command 'list' did not run\n", 1);
  return { kind: 'run', format: parsedFormat, formatExplicit, ...(parsedTag !== undefined ? { tag: parsedTag } : {}) };
}

type ParsedHostedProfileSurface =
  | { kind: 'help'; output: string }
  | { kind: 'run'; command: 'list'; format: string; formatExplicit: boolean }
  | { kind: 'run'; command: 'delete'; profile: string; format: string; formatExplicit: boolean }
  | { kind: 'run'; command: 'create'; name: string }
  | { kind: 'run'; command: 'rename'; profile: string; name: string }
  | { kind: 'run'; command: 'use'; profile: string };

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

  const configureFormat = (command: Command): Command => addOutputFormatOption(command);
  const setParsed = (command: 'list' | 'delete', surface: Command, profileId?: string): void => {
    const options = surface.opts<{ format: string }>();
    const outputFormat = {
      format: validateHostedFormat(String(requestedOutputFormat(surface, options.format))),
      formatExplicit: outputFormatIsExplicit(surface),
    };
    parsed = command === 'list' ? {
      kind: 'run',
      command: 'list',
      ...outputFormat,
    } : {
      kind: 'run',
      command: 'delete',
      profile: profileId!,
      ...outputFormat,
    };
  };

  const list = configureFormat(profile.command('list'));
  list.exitOverride().configureOutput(output).action(() => setParsed('list', list));
  const remove = configureFormat(profile.command('delete').argument('<profile-id>'));
  remove.exitOverride().configureOutput(output).action((profileId: string) => setParsed('delete', remove, profileId));
  profile.command('create').argument('<name>').exitOverride().configureOutput(output).action((name: string) => {
    parsed = { kind: 'run', command: 'create', name };
  });
  profile.command('rename').argument('<profile>').argument('<name>').exitOverride().configureOutput(output).action((profileValue: string, name: string) => {
    parsed = { kind: 'run', command: 'rename', profile: profileValue, name };
  });
  profile.command('use').argument('<profile>').exitOverride().configureOutput(output).action((profileValue: string) => {
    parsed = { kind: 'run', command: 'use', profile: profileValue };
  });

  try {
    root.parse(literal ? ['--', 'profile', ...argv] : ['profile', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', output: stdout };
    throw structuralErrorFromCommander(error, resolveCommandFromArgv(root, ['profile', ...argv]), stderr);
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
  config: HostedWebcmdConfig,
  saveConfig?: (config: HostedWebcmdConfig) => void,
): Promise<void> {
  if (parsed.command === 'create') {
    await renderOutput(await client.createProfile(parsed.name), { fmt: 'yaml', stdout });
    return;
  }
  if (parsed.command === 'rename') {
    const profiles = (await client.listProfiles()).profiles;
    const profile = profiles.find(candidate => candidate.id === parsed.profile || candidate.name === parsed.profile);
    if (!profile) {
      throw new ConfigError(
        `Hosted profile "${parsed.profile}" was not found.`,
        `Available profiles: ${profiles.map(candidate => candidate.name ?? candidate.id).join(', ') || '(none)'}`,
      );
    }
    await renderOutput(await client.renameProfile(profile.id, parsed.name), { fmt: 'yaml', stdout });
    return;
  }
  if (parsed.command === 'use') {
    if (!saveConfig) {
      throw new ConfigError(
        'Injected hosted configuration cannot persist a hosted profile preference without saveConfig.',
        'Pass saveConfig when invoking runHostedCli with an injected config.',
      );
    }
    const profile = await requireListedHostedProfile(client, parsed.profile);
    saveConfig(withHostedPreferredProfile(config, profile));
    await renderOutput({ ok: true, action: 'use', profile }, { fmt: 'yaml', stdout });
    return;
  }
  const result = parsed.command === 'list'
    ? (await client.listProfiles()).profiles
    : await client.deleteProfile(parsed.profile);
  await renderOutput(result, { fmt: parsed.format, fmtExplicit: parsed.formatExplicit, stdout });
}

async function requireListedHostedProfile(client: HostedClient, name: string): Promise<string> {
  const profiles = (await client.listProfiles()).profiles;
  const profile = profiles.find(candidate => candidate.name !== null && (candidate.id === name || candidate.name === name));
  if (profile?.name) return profile.name;
  const validNames = profiles.flatMap(candidate => candidate.name ? [candidate.name] : []).sort();
  throw new HostedClientError(
    'PROFILE_NOT_FOUND',
    `No hosted profile matches "${name}". Valid profiles: ${validNames.join(', ') || '(none)'}`,
    `usage: ${CLI_COMMAND} profile use <profile>\nList profiles: ${CLI_COMMAND} profile list`,
    EXIT_CODES.EMPTY_RESULT,
  );
}

type ParsedHostedPluginSurface =
  | { kind: 'help'; output: string }
  | { kind: 'run'; command: 'search'; query?: string; format: string; formatExplicit: boolean }
  | { kind: 'run'; command: 'install'; source: string; all: boolean }
  | { kind: 'run'; command: 'list'; format: string; formatExplicit: boolean }
  | { kind: 'run'; command: 'uninstall'; name: string }
  | { kind: 'run'; command: 'update'; name?: string; all: boolean }
  | { kind: 'run'; command: 'catalog-list'; format: string; formatExplicit: boolean }
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
    parsed = { kind: 'run', command: 'search', ...(query !== undefined ? { query } : {}), format: validateHostedFormat(String(requestedOutputFormat(search, options.format))), formatExplicit: outputFormatIsExplicit(search) };
  });
  const install = configurePluginInstallSurface(plugin.command('install'));
  install.exitOverride().configureOutput(output).action((source: string, options: { all?: boolean }) => {
    parsed = { kind: 'run', command: 'install', source, all: options.all === true };
  });
  const list = configurePluginListSurface(plugin.command('list'));
  list.exitOverride().configureOutput(output).action((options: { format: string }) => {
    parsed = { kind: 'run', command: 'list', format: validateHostedFormat(String(requestedOutputFormat(list, options.format))), formatExplicit: outputFormatIsExplicit(list) };
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
  const catalog = plugin.command('catalog');
  const catalogList = addOutputFormatOption(catalog.command('list')).exitOverride().configureOutput(output);
  catalogList.action((options: { format: string }) => {
    parsed = {
      kind: 'run',
      command: 'catalog-list',
      format: validateHostedFormat(String(requestedOutputFormat(catalogList, options.format))),
      formatExplicit: outputFormatIsExplicit(catalogList),
    };
  });

  try {
    root.parse(literal ? ['--', 'plugin', ...argv] : ['plugin', ...argv], { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === 'commander.helpDisplayed') return { kind: 'help', output: stdout };
    throw structuralErrorFromCommander(error, resolveCommandFromArgv(root, ['plugin', ...argv]), stderr);
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
    throw structuralErrorFromCommander(error, resolveCommandFromArgv(root, ['completion', ...argv]), stderr, {
      appendErrorEnvelope: true,
    });
  }
  if (shell === undefined) {
    // Hand-written mirror of the local `webcmd completion` usage error, which
    // Commander raises there but not here (the shell arg is optional in this
    // parse). Same bytes, same code, same exit status.
    const message = "missing required argument 'shell'";
    const help = 'usage: webcmd completion [options] <shell>';
    throw new CommanderStructuralError(
      `error: ${message}\nhelp: ${help}\n`,
      EXIT_CODES.USAGE_ERROR,
      false,
      { ok: false, error: { code: 'MISSING_ARGUMENT', message, help, exitCode: EXIT_CODES.USAGE_ERROR } },
    );
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
        throw new CommanderStructuralError("error: option '--profile <name>' argument missing\n", 1, true);
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

function isWebcmdOwnedRoot(name: string, installedLocalCommandRoots?: ReadonlySet<string>): boolean {
  return isUnconditionalWebcmdRoot(name) || installedLocalCommandRoots?.has(name) === true;
}

function isUnconditionalWebcmdRoot(name: string): boolean {
  return WEBCMD_ROOT_COMMANDS.has(name)
    || HOSTED_ROOT_HELP.commands.some(command => command.name.split(/\s/, 1)[0] === name);
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

function hostedCompletions(manifest: HostedManifest, argv: string[], hasLocalClientCommandHandlers = true): string[] {
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
  const commands = hostedCommands(manifest)
    .filter(command => hasLocalClientCommandHandlers || !isLocalClientRootCommand(command.site));
  const coreCommands = manifest.metadata.coreCommands;
  const root = words[0];
  if (cursor === 2 && (root === 'adapter' || root === 'profile' || root === 'plugin')) {
    return getHostedBuiltinSubcommands(root, coreCommands);
  }
  if (cursor === 3 && root === 'plugin' && words[1] === 'catalog') {
    return hasHostedCoreCommand(coreCommands, 'plugin/catalog/list') ? ['list'] : [];
  }
  return [...new Set(getCommandCompletionCandidates(
    commands,
    words,
    Number.isFinite(cursor) ? cursor! : words.length,
    getHostedBuiltinCommands(coreCommands, hasLocalClientCommandHandlers)
      .filter(command => command !== 'web' && command !== root),
  ))];
}

function errorExitCode(err: unknown): number {
  if (err instanceof ConfigError) return err.exitCode;
  if (err && typeof err === 'object' && 'exitCode' in err && typeof (err as { exitCode?: unknown }).exitCode === 'number') {
    return (err as { exitCode: number }).exitCode;
  }
  return EXIT_CODES.GENERIC_ERROR;
}

const TRUSTED_AUDIT_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?: [A-Za-z0-9][A-Za-z0-9._/-]*)*$/;

function trustedCommandResolution(command: HostedCommand): TrustedCommandResolution {
  if (
    command.command.length > 256
    || !TRUSTED_AUDIT_COMMAND.test(command.command)
    || (command.access !== 'read' && command.access !== 'write')
  ) {
    throw new HostedClientError(
      'HOSTED_CONTRACT_MISMATCH',
      'Webcmd Cloud manifest contains invalid command audit metadata.',
    );
  }
  return { resolvedCommand: command.command, accessClass: command.access };
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

async function getPresentationManifest(client: HostedClient, enableServerWebFetch: boolean): Promise<HostedManifest> {
  const manifest = await client.getManifest();
  validateManifestContractIdentity(manifest);
  return withClientOwnedCommands(manifest, enableServerWebFetch);
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
  const builtinCommands = new Set(['adapter', 'artifact', 'browser', 'completion', 'daemon', 'doctor', 'list', 'plugin', 'profile', 'session', 'setup', 'site', 'skills', 'update', 'web']);
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
  if (positionals[0] && builtinCommands.has(positionals[0])) return positionals[0];
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
