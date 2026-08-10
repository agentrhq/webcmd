import { cli, Strategy, type Arg, type CliCommand } from '../registry.js';
import { ArgumentError } from '../errors.js';
import { commandHelpData, formatCommandHelp, toPresentableCommand } from '../command-presentation.js';
import { renderStructuredHelp } from '../help.js';
import { formatOutput } from '../output.js';
import { webFetch, type WebFetchOptions, type WebFetchResult } from './client.js';

/** Single source of truth for discovery, Commander help, and the client-owned fast path. */
export const WEB_FETCH_ARGS: Arg[] = [
  { name: 'url', type: 'string', required: true, help: 'http(s) URL to fetch' },
  { name: 'timeout', type: 'int', default: 30, help: 'Fetch budget in seconds' },
  { name: 'max-chars', type: 'int', default: 50000, help: 'Maximum characters of extracted content' },
  { name: 'allow-private', type: 'boolean', default: false, help: 'Allow private/loopback addresses' },
];

const DEFAULT_TIMEOUT = 30;
const DEFAULT_MAX_CHARS = 50000;

let registered: CliCommand | undefined;

/**
 * Register (or return) the builtin `web fetch` command.
 * Called from clis/web/fetch.js so build-manifest / filesystem discovery see it.
 * Safe to call more than once — returns the same command object.
 */
export function makeWebFetchCommand(): CliCommand {
  if (registered) return registered;
  registered = cli({
    site: 'web',
    name: 'fetch',
    access: 'read',
    strategy: Strategy.PUBLIC,
    browser: false,
    description: 'Fetch a URL locally without launching a browser',
    defaultFormat: 'md',
    args: WEB_FETCH_ARGS,
    func: async kwargs => webFetch(kwargsToOptions(kwargs)),
  });
  return registered;
}

/** Eager registration for consumers that import the command object directly. */
export const webFetchCommand = makeWebFetchCommand();

export function formatWebFetchMarkdown(result: WebFetchResult): string {
  return [`# ${result.title || 'Fetched content'}`, '', `Source: ${result.requestedUrl}`, `Final URL: ${result.finalUrl}`, `Content type: ${result.contentType || 'unknown'}`, `Extraction: ${result.extractionSource}`, '', result.content].join('\n');
}

export function formatWebFetchHelp(): string {
  return formatCommandHelp(toPresentableCommand(webFetchCommand));
}

function defaultInt(name: string): number {
  if (name === 'timeout') return DEFAULT_TIMEOUT;
  if (name === 'max-chars') return DEFAULT_MAX_CHARS;
  return 0;
}

function kwargsToOptions(kwargs: Record<string, unknown>): WebFetchOptions {
  return {
    url: String(kwargs.url),
    timeoutSeconds: Number(kwargs.timeout ?? DEFAULT_TIMEOUT),
    maxChars: Number(kwargs['max-chars'] ?? DEFAULT_MAX_CHARS),
    allowPrivate: kwargs['allow-private'] === true,
  };
}

function wantsHelp(argv: readonly string[]): boolean {
  return argv.slice(2).some(arg => arg === '-h' || arg === '--help');
}

/** Formats advertised by the common-options block the help text prints. */
const OUTPUT_FORMATS = ['table', 'plain', 'json', 'yaml', 'md', 'csv'] as const;

/** Reads -f/--format in the same shapes Commander accepts, so help cannot over-promise. */
function requestedFormat(argv: readonly string[]): string | undefined {
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index]!;
    let value: string | undefined;
    if (arg === '-f' || arg === '--format') value = argv[index + 1];
    else if (arg.startsWith('--format=')) value = arg.slice('--format='.length);
    else if (arg.startsWith('-f') && arg.length > 2) value = arg.slice(2);
    else continue;
    if (value === undefined || !OUTPUT_FORMATS.includes(value as typeof OUTPUT_FORMATS[number])) {
      throw new ArgumentError(`--format must be one of: ${OUTPUT_FORMATS.join(', ')}`);
    }
    return value;
  }
  return undefined;
}

function clientOptions(argv: readonly string[]): WebFetchOptions {
  const values: Record<string, string | boolean> = {};
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith('-')) {
      values[name] = value;
      index++;
    } else {
      values[name] = true;
    }
  }
  if (typeof values.url !== 'string' || !/^https?:\/\//i.test(values.url)) {
    throw new ArgumentError('--url must be an http or https URL');
  }
  const int = (name: string) => {
    const fallback = defaultInt(name);
    const value = values[name];
    if (value === true) throw new ArgumentError(`--${name} requires a value`);
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new ArgumentError(`--${name} must be a non-negative integer`);
    }
    return number;
  };
  return {
    url: values.url,
    timeoutSeconds: int('timeout'),
    maxChars: int('max-chars'),
    allowPrivate: values['allow-private'] === true || values['allow-private'] === 'true',
  };
}

export async function runClientOwnedWebFetch(
  argv: readonly string[],
  dependencies: {
    webFetch?: typeof webFetch;
    stdout?: NodeJS.WritableStream;
  } = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? process.stdout;
  const format = requestedFormat(argv);
  if (wantsHelp(argv)) {
    stdout.write(format === 'yaml' || format === 'json'
      ? renderStructuredHelp(commandHelpData(toPresentableCommand(webFetchCommand)), format)
      : formatWebFetchHelp());
    return;
  }
  const result = await (dependencies.webFetch ?? webFetch)(clientOptions(argv));
  stdout.write(format === undefined || format === 'md'
    ? `${formatWebFetchMarkdown(result)}\n`
    : formatOutput(result, { fmt: format, fmtExplicit: true }));
}
