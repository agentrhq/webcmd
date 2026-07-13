import { writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { BrowserSessionArgvError, rewriteBrowserArgv } from '../cli-argv-preprocess.js';
import { ConfigError, EXIT_CODES, toEnvelope } from '../errors.js';
import { render as renderOutput } from '../output.js';
import { HostedClient } from './client.js';
import { parseHostedInvocation } from './args.js';
import {
  findHostedCommand,
  hostedListRows,
  isLocalOnlyHostedCommand,
  renderHostedCommandHelp,
  renderHostedSiteHelp,
  siteNames,
  commandNamesForSite,
} from './manifest.js';
import { isHostedConfig, loadWebcmdConfig, type WebcmdConfig } from './config.js';
import type { HostedBrowserActionName, HostedBrowserRunActionResponse, HostedManifest } from './types.js';

export interface HostedRunnerOptions {
  config?: WebcmdConfig;
  fetchImpl?: typeof fetch;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface HostedRunResult {
  handled: boolean;
  exitCode: number;
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
    await dispatchHosted(argv, client, stdout);
    return { handled: true, exitCode: EXIT_CODES.SUCCESS };
  } catch (err) {
    stderr.write(yaml.dump(toEnvelope(err), { sortKeys: false, lineWidth: 120, noRefs: true }));
    return {
      handled: true,
      exitCode: errorExitCode(err),
    };
  }
}

async function dispatchHosted(argv: string[], client: HostedClient, stdout: NodeJS.WritableStream): Promise<void> {
  const normalized = stripGlobalOptions(argv);
  const args = normalized.argv;
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    stdout.write('Usage: webcmd <site> <command> [options]\n       webcmd list\n       webcmd setup\n');
    return;
  }
  if (args[0] === 'daemon') {
    throw new ConfigError(
      'webcmd daemon is local-only. Hosted mode has no local daemon.',
      'Run `webcmd setup` and choose local mode to manage the local daemon.',
    );
  }
  if (args[0] === 'browser') {
    await dispatchHostedBrowser(args, normalized.profile, client, stdout);
    return;
  }

  const manifest = await client.getManifest();
  if (isCompletionRequest(args)) {
    stdout.write(hostedCompletions(manifest, args).join('\n') + '\n');
    return;
  }
  if (args[0] === 'list') {
    renderHostedList(manifest, args.slice(1));
    return;
  }

  const site = args[0]!;
  const commandName = args[1];
  if (!commandName || commandName === '--help' || commandName === '-h') {
    stdout.write(renderHostedSiteHelp(manifest, site));
    return;
  }

  const command = findHostedCommand(manifest, site, commandName);
  if (!command) {
    throw new ConfigError(`Unknown hosted Webcmd command: ${site}/${commandName}`);
  }
  if (isLocalOnlyHostedCommand(command)) {
    throw new ConfigError(
      `Command ${command.command} is local-only and is not available in hosted mode.`,
      'Run `webcmd setup` and choose local mode to use local-only commands.',
    );
  }
  const parsed = parseHostedInvocation(command, [...args.slice(2), ...normalized.trailingCommandOptions]);
  if (parsed.help) {
    stdout.write(renderHostedCommandHelp(command));
    return;
  }

  const response = await client.execute({
    command: command.command,
    args: parsed.args,
    format: parsed.format,
    trace: parsed.trace,
    profile: parsed.profile ?? normalized.profile,
  });
  const result = response.result ?? response.rows ?? response.data ?? null;
  renderOutput(result, {
    fmt: parsed.format,
    fmtExplicit: true,
    columns: response.columns ?? command.columns,
    title: command.command,
    source: 'webcmd cloud',
  });
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
  argv: string[],
  profile: string | undefined,
  client: HostedClient,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const invocation = parseHostedBrowserInvocation(argv, profile);
  const response = await client.runBrowserAction(invocation.session, {
    command: invocation.command,
    action: invocation.action,
    args: invocation.args,
    ...(invocation.profile !== undefined ? { profile: invocation.profile } : {}),
    ...(invocation.windowMode !== undefined ? { windowMode: invocation.windowMode } : {}),
    trace: 'off',
  });
  renderHostedBrowserResponse(stdout, invocation, response);
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
  if (rewritten[0] !== 'browser') {
    throw new ConfigError('Hosted browser invocation must start with browser.');
  }
  if (rewritten[1] !== '--session' || !rewritten[2]) {
    throw new ConfigError(
      '<session> is required for hosted browser commands.',
      'Use: webcmd browser <session> <command>',
    );
  }

  const session = rewritten[2];
  let index = 3;
  let windowMode: 'foreground' | 'background' | undefined;
  while (index < rewritten.length) {
    const token = rewritten[index];
    if (token === '--window') {
      windowMode = parseWindowMode(rewritten[index + 1]);
      index += 2;
      continue;
    }
    if (token?.startsWith('--window=')) {
      windowMode = parseWindowMode(token.slice('--window='.length));
      index += 1;
      continue;
    }
    break;
  }

  const leaf = rewritten[index];
  if (!leaf || leaf === '--help' || leaf === '-h') {
    throw new ConfigError(
      'Hosted browser command is required.',
      'Use: webcmd browser <session> open <url>, state, screenshot, tab list, or eval <js>.',
    );
  }

  const rest = rewritten.slice(index + 1);
  const parsed = parseBrowserLeaf(leaf, rest);
  return {
    session,
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

function parseBrowserLeaf(leaf: string, argv: string[]): {
  commandName: string;
  action: HostedBrowserActionName;
  args: Record<string, unknown>;
  localPath?: string;
} {
  const parsed = splitOptions(argv);
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
      return { commandName: 'open', action: 'navigate', args: { url: requiredPositional(parsed.positionals, 0, 'url') } };
    case 'back':
      return { commandName: 'back', action: 'back', args: {} };
    case 'state':
      return { commandName: 'state', action: 'snapshot', args: { source: parsed.options.source ?? 'dom' } };
    case 'frames':
      return { commandName: 'frames', action: 'frames', args: {} };
    case 'screenshot': {
      const localPath = parsed.positionals[0];
      return {
        commandName: 'screenshot',
        action: 'screenshot',
        args: {
          fullPage: parsed.options.fullPage === true,
          ...(parsed.options.width !== undefined ? { width: parsed.options.width } : {}),
          ...(parsed.options.height !== undefined ? { height: parsed.options.height } : {}),
        },
        ...(localPath !== undefined ? { localPath } : {}),
      };
    }
    case 'tab':
      return parseBrowserTab(parsed.positionals);
    case 'eval':
      return {
        commandName: 'eval',
        action: 'exec',
        args: {
          js: requiredPositional(parsed.positionals, 0, 'js'),
          ...(parsed.options.frame !== undefined ? { frame: parsed.options.frame } : {}),
        },
      };
    case 'scroll':
      return {
        commandName: 'scroll',
        action: 'scroll',
        args: {
          direction: requiredPositional(parsed.positionals, 0, 'direction'),
          amount: parsed.options.amount ?? 500,
        },
      };
    case 'keys':
      return { commandName: 'keys', action: 'press-key', args: { key: requiredPositional(parsed.positionals, 0, 'key') } };
    case 'wait':
      return {
        commandName: 'wait',
        action: 'wait',
        args: {
          type: requiredPositional(parsed.positionals, 0, 'type'),
          ...(parsed.positionals[1] !== undefined ? { value: parsed.positionals[1] } : {}),
          ...(parsed.options.timeout !== undefined ? { timeout: parsed.options.timeout } : {}),
        },
      };
    case 'click':
      return { commandName: 'click', action: 'click', args: { target: requiredPositional(parsed.positionals, 0, 'target') } };
    case 'type':
      return {
        commandName: 'type',
        action: 'type',
        args: {
          target: requiredPositional(parsed.positionals, 0, 'target'),
          text: requiredPositional(parsed.positionals, 1, 'text'),
        },
      };
    case 'fill':
      return {
        commandName: 'fill',
        action: 'fill',
        args: {
          target: requiredPositional(parsed.positionals, 0, 'target'),
          text: requiredPositional(parsed.positionals, 1, 'text'),
        },
      };
    case 'upload':
      return {
        commandName: 'upload',
        action: 'set-file-input',
        args: {
          selector: parsed.positionals[0] ?? 'input[type="file"]',
          files: parsed.positionals.slice(1),
        },
      };
    case 'console':
      return { commandName: 'console', action: 'console', args: parsed.options };
    case 'network':
      return { commandName: 'network', action: 'network', args: parsed.options };
    default:
      throw new ConfigError(`Hosted browser command is not supported yet: ${leaf}`);
  }
}

function parseBrowserTab(positionals: string[]): {
  commandName: string;
  action: HostedBrowserActionName;
  args: Record<string, unknown>;
} {
  const op = positionals[0] ?? 'list';
  if (op === 'list') return { commandName: 'tab/list', action: 'tabs', args: { op: 'list' } };
  if (op === 'new') return { commandName: 'tab/new', action: 'tabs', args: { op: 'new', ...(positionals[1] ? { url: positionals[1] } : {}) } };
  if (op === 'select') return { commandName: 'tab/select', action: 'tabs', args: { op: 'select', target: requiredPositional(positionals, 1, 'targetId') } };
  if (op === 'close') return { commandName: 'tab/close', action: 'tabs', args: { op: 'close', target: requiredPositional(positionals, 1, 'targetId') } };
  throw new ConfigError(`Hosted browser tab command is not supported yet: ${op}`);
}

function splitOptions(argv: string[]): { positionals: string[]; options: Record<string, unknown> } {
  const positionals: string[] = [];
  const options: Record<string, unknown> = {};
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (literal) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      literal = true;
      continue;
    }
    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }
    if (token.startsWith('--') && token.includes('=')) {
      const [rawKey, ...rawValue] = token.slice(2).split('=');
      options[toCamelCase(rawKey!)] = coerceOptionValue(rawValue.join('='));
      continue;
    }
    const key = token.replace(/^-+/, '');
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      options[toCamelCase(key)] = coerceOptionValue(next);
      i += 1;
    } else {
      options[toCamelCase(key)] = true;
    }
  }
  return { positionals, options };
}

function requiredPositional(values: string[], index: number, label: string): string {
  const value = values[index];
  if (value === undefined || value === '') {
    throw new ConfigError(`Missing required browser argument: ${label}`);
  }
  return value;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function coerceOptionValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return value;
}

function renderHostedBrowserResponse(
  stdout: NodeJS.WritableStream,
  invocation: ParsedHostedBrowserInvocation,
  response: HostedBrowserRunActionResponse,
): void {
  const result = response.result;
  if (invocation.action === 'snapshot' && result && typeof result === 'object') {
    const record = result as { url?: unknown; snapshot?: unknown };
    stdout.write(`URL: ${typeof record.url === 'string' ? record.url : ''}\n\n`);
    stdout.write(`${typeof record.snapshot === 'string' ? record.snapshot : JSON.stringify(record.snapshot, null, 2)}\n`);
    return;
  }
  if (invocation.action === 'screenshot' && result && typeof result === 'object') {
    const base64 = (result as { base64?: unknown }).base64;
    if (typeof base64 === 'string' && invocation.localPath) {
      writeFileSync(invocation.localPath, Buffer.from(base64, 'base64'));
      stdout.write(`Screenshot saved to: ${invocation.localPath}\n`);
      return;
    }
    if (typeof base64 === 'string') {
      stdout.write(`${base64}\n`);
      return;
    }
  }
  if (typeof result === 'string') {
    stdout.write(`${result}\n`);
    return;
  }
  stdout.write(`${JSON.stringify(result ?? response, null, 2)}\n`);
}

function renderHostedList(manifest: HostedManifest, argv: string[]): void {
  const fmt = readFormat(argv);
  const structured = fmt === 'json' || fmt === 'yaml' || fmt === 'yml';
  renderOutput(hostedListRows(manifest, structured), {
    fmt,
    fmtExplicit: true,
    columns: ['command', 'site', 'name', 'aliases', 'description', 'access', 'strategy', 'browser', 'args',
      ...(structured ? ['columns', 'domain'] : [])],
    title: 'webcmd/list',
    source: 'webcmd cloud',
  });
}

function readFormat(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-f' || argv[i] === '--format') return argv[i + 1] ?? 'table';
    if (argv[i]?.startsWith('--format=')) return argv[i]!.slice('--format='.length);
  }
  return 'table';
}

function stripGlobalOptions(argv: string[]): { argv: string[]; trailingCommandOptions: string[]; profile?: string } {
  const out: string[] = [];
  const trailingCommandOptions: string[] = [];
  let profile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--profile') {
      profile = argv[++i];
      continue;
    }
    if (token.startsWith('--profile=')) {
      profile = token.slice('--profile='.length);
      continue;
    }
    out.push(token);
  }
  return { argv: out, trailingCommandOptions, ...(profile ? { profile } : {}) };
}

function isCompletionRequest(argv: string[]): boolean {
  return argv.includes('--get-completions');
}

function hostedCompletions(manifest: HostedManifest, argv: string[]): string[] {
  const index = argv.indexOf('--get-completions');
  const words = index === -1 ? argv : argv.slice(index + 1).filter((word) => word !== '--cursor');
  const meaningful = words.filter((word) => !/^\d+$/.test(word));
  if (meaningful.length <= 1) return ['list', 'setup', ...siteNames(manifest)];
  return commandNamesForSite(manifest, meaningful[0]!);
}

function errorExitCode(err: unknown): number {
  if (err instanceof ConfigError) return err.exitCode;
  if (err && typeof err === 'object' && 'exitCode' in err && typeof (err as { exitCode?: unknown }).exitCode === 'number') {
    return (err as { exitCode: number }).exitCode;
  }
  return EXIT_CODES.GENERIC_ERROR;
}
