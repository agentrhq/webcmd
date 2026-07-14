import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { configureCompletionCommandSurface, configureListCommandSurface } from '../builtin-command-surface.js';
import { BrowserSessionArgvError, rewriteBrowserArgv } from '../cli-argv-preprocess.js';
import { CommanderStructuralError, MissingRequiredPositionalError } from '../command-surface.js';
import { formatRootHelp, getCommandCompletionCandidates } from '../command-presentation.js';
import {
  HOSTED_BUILTIN_COMMANDS,
  HOSTED_ROOT_HELP,
  LOCAL_ONLY_COMMAND_HELP,
} from '../completion-shared.js';
import { ConfigError, EXIT_CODES, toEnvelope } from '../errors.js';
import { getRequestedHelpFormat, renderStructuredHelp } from '../help.js';
import { findPackageRoot } from '../package-paths.js';
import { formatErrorEnvelope, render as renderOutput } from '../output.js';
import { StreamWriteError, writeToStream } from '../stream-write.js';
import { PKG_VERSION } from '../version.js';
import { requireCompletionScriptFast } from '../completion-fast.js';
import { HostedClient, HostedClientError } from './client.js';
import { parseHostedInvocation } from './args.js';
import { HostedBrowserHelp, parseHostedBrowserStructure } from './browser-args.js';
import {
  findHostedCommand,
  hostedCommandHelpData,
  hostedCommands,
  hostedListPresentation,
  hostedSiteHelpData,
  isLocalOnlyHostedCommand,
  renderHostedCommandHelp,
  renderHostedSiteHelp,
} from './manifest.js';
import { isHostedConfig, loadWebcmdConfig, type WebcmdConfig } from './config.js';
import { parseHostedRootCommandSurface } from '../root-command-surface.js';
import type { HostedBrowserActionName, HostedBrowserRunActionResponse, HostedManifest } from './types.js';

export interface HostedRunnerOptions {
  config?: WebcmdConfig;
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

export async function runHostedCli(argv: string[], opts: HostedRunnerOptions = {}): Promise<HostedRunResult> {
  const config = opts.config ?? loadWebcmdConfig();
  if (!isHostedConfig(config)) return { handled: false, exitCode: EXIT_CODES.SUCCESS };
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const client = new HostedClient({
    apiBaseUrl: config.hosted.apiBaseUrl,
    apiKey: config.hosted.apiKey,
    fetchImpl: opts.fetchImpl,
  });

  try {
    await dispatchHosted(argv, client, stdout, stderr, opts.now ?? Date.now);
    return { handled: true, exitCode: EXIT_CODES.SUCCESS };
  } catch (err) {
    if (err instanceof StreamWriteError) throw err;
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
    const manifest = await client.getManifest();
    validateManifestContractIdentity(manifest);
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
    await writeToStream(stdout, requireCompletionScriptFast(parsed.shell));
    return;
  }
  if (args[0] === 'daemon') {
    throw new ConfigError(
      'webcmd daemon is local-only. Hosted mode has no local daemon.',
      LOCAL_ONLY_COMMAND_HELP,
    );
  }
  if (args[0] === 'browser') {
    const invocation = parseHostedBrowserInvocation(args, normalized.profile);
    const manifest = await client.getManifest();
    validateManifestContractIdentity(manifest);
    await dispatchHostedBrowser(invocation, client, stdout);
    return;
  }

  if (args[0] === 'list') {
    const parsed = parseHostedListSurface(args.slice(1), normalized.literal);
    if (parsed.kind === 'help') {
      await writeToStream(stdout, parsed.output);
      return;
    }
    const manifest = await client.getManifest();
    validateManifestContractIdentity(manifest);
    await renderHostedList(manifest, parsed.format, parsed.formatExplicit, stdout);
    return;
  }

  const manifest = await client.getManifest();
  validateManifestContractIdentity(manifest);

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
      `error: unknown command '${site}'\n`,
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
    if (!normalized.literal && args.slice(1).some(token => token === '--help' || token === '-h')) {
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

  const startTime = now();
  const response = await client.execute({
    command: command.command,
    args: parsed.args,
    format: parsed.format,
    trace: parsed.trace,
    profile: parsed.profile ?? normalized.profile,
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
  const response = await client.runBrowserAction(invocation.session, {
    command: invocation.command,
    action: invocation.action,
    args: invocation.args,
    ...(invocation.profile !== undefined ? { profile: invocation.profile } : {}),
    ...(invocation.windowMode !== undefined ? { windowMode: invocation.windowMode } : {}),
    trace: 'off',
  });
  await renderHostedBrowserResponse(stdout, invocation, response);
}

function parseHostedBrowserInvocation(argv: string[], profile: string | undefined): ParsedHostedBrowserInvocation {
  let rewritten: string[];
  try {
    rewritten = rewriteBrowserArgv(argv);
  } catch (error) {
    if (error instanceof BrowserSessionArgvError) {
      throw new ConfigError(error.message, 'Use: webcmd browser <session> <command>');
    }
    throw error;
  }
  let structure;
  try {
    structure = parseHostedBrowserStructure(rewritten);
  } catch (error) {
    if (error instanceof HostedBrowserHelp) throw new CommanderCompatibleError('', 0, error.output);
    throw error;
  }
  if (rewritten[0] !== 'browser') {
    throw new ConfigError('Hosted browser invocation must start with browser.');
  }
  if (!structure.session) {
    throw new ConfigError(
      '<session> is required for hosted browser commands.',
      'Use: webcmd browser <session> <command>',
    );
  }

  if (!structure.commandName) {
    throw new ConfigError(
      'Hosted browser command is required.',
      'Use: webcmd browser <session> open <url>, state, screenshot, tab list, or eval <js>.',
    );
  }

  const windowMode = structure.window === undefined ? undefined : parseWindowMode(structure.window);
  const parsed = parseBrowserLeaf(structure.commandName, structure.positionals, structure.options);
  return {
    session: structure.session,
    command: `browser/${parsed.commandName}`,
    action: parsed.action,
    args: parsed.args,
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
  switch (leaf) {
    case 'bind':
      throw new ConfigError(
        'Browser bind is not supported in hosted mode.',
        'Use browser state or browser tabs to inspect the active hosted page.',
      );
    case 'unbind':
    case 'close':
      return { commandName: leaf, action: 'close-window', args: {} };
    case 'open':
      return { commandName: 'open', action: 'navigate', args: { url: requiredPositional(positionals, 0, 'url') } };
    case 'back':
      return { commandName: 'back', action: 'back', args: {} };
    case 'state':
      return { commandName: 'state', action: 'snapshot', args: { source: options.source ?? 'dom' } };
    case 'frames':
      return { commandName: 'frames', action: 'frames', args: {} };
    case 'screenshot': {
      const localPath = positionals[0];
      return {
        commandName: 'screenshot',
        action: 'screenshot',
        args: {
          fullPage: options.fullPage === true,
          ...(options.width !== undefined ? { width: options.width } : {}),
          ...(options.height !== undefined ? { height: options.height } : {}),
        },
        ...(localPath !== undefined ? { localPath } : {}),
      };
    }
    case 'tab/list':
      return { commandName: 'tab/list', action: 'tabs', args: { op: 'list' } };
    case 'tab/new':
      return { commandName: 'tab/new', action: 'tabs', args: { op: 'new', ...(positionals[0] ? { url: positionals[0] } : {}) } };
    case 'tab/select':
      return { commandName: 'tab/select', action: 'tabs', args: { op: 'select', target: requiredPositional(positionals, 0, 'targetId') } };
    case 'tab/close':
      return { commandName: 'tab/close', action: 'tabs', args: { op: 'close', target: requiredPositional(positionals, 0, 'targetId') } };
    case 'eval':
      return {
        commandName: 'eval',
        action: 'exec',
        args: {
          js: requiredPositional(positionals, 0, 'js'),
          ...(options.frame !== undefined ? { frame: options.frame } : {}),
        },
      };
    case 'scroll':
      return {
        commandName: 'scroll',
        action: 'scroll',
        args: {
          direction: requiredPositional(positionals, 0, 'direction'),
          amount: options.amount ?? '500',
        },
      };
    case 'keys':
      return { commandName: 'keys', action: 'press-key', args: { key: requiredPositional(positionals, 0, 'key') } };
    case 'wait':
      return {
        commandName: 'wait',
        action: 'wait',
        args: {
          type: requiredPositional(positionals, 0, 'type'),
          ...(positionals[1] !== undefined ? { value: positionals[1] } : {}),
          ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
        },
      };
    case 'click':
      return { commandName: 'click', action: 'click', args: { target: requiredPositional(positionals, 0, 'target') } };
    case 'type':
      return {
        commandName: 'type',
        action: 'type',
        args: {
          target: requiredPositional(positionals, 0, 'target'),
          text: requiredPositional(positionals, 1, 'text'),
        },
      };
    case 'fill':
      return {
        commandName: 'fill',
        action: 'fill',
        args: {
          target: requiredPositional(positionals, 0, 'target'),
          text: requiredPositional(positionals, 1, 'text'),
        },
      };
    case 'upload':
      return {
        commandName: 'upload',
        action: 'set-file-input',
        args: {
          selector: positionals[0] ?? 'input[type="file"]',
          files: positionals.slice(1),
        },
      };
    case 'console':
      return { commandName: 'console', action: 'console', args: options };
    case 'network':
      return { commandName: 'network', action: 'network', args: options };
    default:
      throw new ConfigError(`Hosted browser command is not supported yet: ${leaf}`);
  }
}

function requiredPositional(values: string[], index: number, label: string): string {
  const value = values[index];
  if (value === undefined || value === '') {
    throw new ConfigError(`Missing required browser argument: ${label}`);
  }
  return value;
}

async function renderHostedBrowserResponse(
  stdout: NodeJS.WritableStream,
  invocation: ParsedHostedBrowserInvocation,
  response: HostedBrowserRunActionResponse,
): Promise<void> {
  const result = response.result;
  if (invocation.action === 'snapshot' && result && typeof result === 'object') {
    const record = result as { url?: unknown; snapshot?: unknown };
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
): Promise<void> {
  const presentation = hostedListPresentation(manifest, fmt);
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
  | { kind: 'run'; format: string; formatExplicit: boolean };

function parseHostedListSurface(argv: readonly string[], literal: boolean): ParsedHostedListSurface {
  let stdout = '';
  let stderr = '';
  let parsedFormat = 'table';
  let formatExplicit = false;
  let actionRan = false;
  const root = new Command('webcmd');
  const list = configureListCommandSurface(root.command('list'));
  const output = {
    writeOut: (value: string) => { stdout += value; },
    writeErr: (value: string) => { stderr += value; },
  };
  root.exitOverride().configureOutput(output);
  list.exitOverride().configureOutput(output).action((options: { format: string }) => {
    actionRan = true;
    parsedFormat = options.format;
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
  return { kind: 'run', format: parsedFormat, formatExplicit };
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
    HOSTED_BUILTIN_COMMANDS,
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
  if (
    manifest.metadata.contractSchemaVersion !== installed.schemaVersion
    || manifest.metadata.webcmdPackageVersion !== installed.webcmdVersion
  ) {
    throw new HostedClientError(
      'HOSTED_PROTOCOL',
      'Webcmd Cloud manifest does not match this installed Webcmd hosted contract.',
    );
  }
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
