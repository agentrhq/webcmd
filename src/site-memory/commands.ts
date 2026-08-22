import { readFile, writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { addOutputFormatOption, outputFormatIsExplicit, resolveCommandOutputFormat } from '../command-surface.js';
import { ArgumentError, CliError, EXIT_CODES } from '../errors.js';
import { getRequestedHelpFormat } from '../help.js';
import { render as renderOutput } from '../output.js';
import { writeToStream } from '../stream-write.js';
import {
  addFieldMapping,
  addResponseSample,
  appendNote,
  getVerifyFixture,
  listSiteMemory,
  markEndpointStale,
  putVerifyFixture,
  setEndpoint,
  showSiteMemory,
  type LocalStoreOptions,
  type SiteMemoryBody,
  type SiteMemoryListing,
} from './local-store.js';

type JsonObject = Record<string, unknown>;
type MemoryKind = 'notes' | 'endpoints' | 'field-map' | 'verify' | 'fixture';

export interface SiteMemoryBackend {
  show(site: string, kind?: MemoryKind): Promise<SiteMemoryBody[]>;
  list(site: string): Promise<SiteMemoryListing[]>;
  note(site: string, text: string, author?: string): Promise<void>;
  endpoint(site: string, name: string, input: { url: string; method: string; params?: JsonObject; rowsPath?: string; sampleFields?: string[]; notes?: string }): Promise<void>;
  stale(site: string, name: string): Promise<void>;
  fieldMap(site: string, key: string, meaning: string, source: string, force: boolean): Promise<void>;
  fixture(site: string, command: string): Promise<string | null>;
  putFixture(site: string, command: string, body: string): Promise<void>;
  sample(site: string, command: string, body: string): Promise<void>;
}

export interface SiteCommandIo {
  readStdin?(): Promise<string>;
}

export interface SitePutSourceInput {
  path?: string;
  stdin?: boolean;
}

const SITE_ARG_HELP = 'Site key the memory belongs to, e.g. news.ycombinator.com';
const SITE_COMMAND_ARG_HELP = 'Fixture key in <site>/<command> form, e.g. news.ycombinator.com/top';
const OUTPUT_ARG_HELP = 'Write the result to this file instead of stdout';

const AGENT_TIP = "Agent tip: use '--help -f yaml' for structured args/options.";

/**
 * Appends footer lines to text help only. Commander's own `addHelpText` would
 * also wrap `--help -f yaml`, so the suffix is applied inside `helpInformation`
 * and skipped whenever a structured format was requested.
 */
function withHelpFooter(command: Command, ...lines: string[]): Command {
  const original = command.helpInformation.bind(command);
  command.helpInformation = ((contextOptions?: unknown) => {
    const text = original(contextOptions as never);
    return getRequestedHelpFormat() ? text : `${text}\n${lines.join('\n')}\n`;
  }) as Command['helpInformation'];
  return command;
}

/** Adds the `Example:` / `Agent tip:` footer that adapter command help already shows. */
function withExample(command: Command, example: string): Command {
  return withHelpFooter(command, `Example: ${example}`, AGENT_TIP);
}

export function registerSiteCommands(
  root: Command,
  backend: SiteMemoryBackend,
  stdout?: NodeJS.WritableStream,
  io: SiteCommandIo = {},
): void {
  const site = withHelpFooter(root.command('site')
    .description('Read and write per-site memory: notes, verified endpoints, field maps, fixtures and samples')
    .usage('memory|note|endpoint|field-map|fixture|sample <verb> <site> [args] [options]'),
    'Grammar: webcmd site <group> <verb> <site> [args] [options]',
    '         The site name is a positional of the LEAF verb, never of the group.',
    '         Right: webcmd site field-map add example.com price',
    '         Wrong: webcmd site field-map example.com add price',
    '',
    'Example: webcmd site note add news.ycombinator.com --text "front page is server-rendered"',
    AGENT_TIP);

  const memory = withExample(site.command('memory')
    .description('Inspect everything stored for a site: webcmd site memory <show|list> <site>')
    .usage('show|list <site> [options]'),
    'webcmd site memory show example.com --kind endpoints');
  const show = addOutputFormatOption(withExample(memory.command('show')
    .description('Print every memory record stored for a site, optionally narrowed with --kind')
    .argument('<site>', SITE_ARG_HELP)
    .option('--kind <kind>', 'Only show one kind: notes, endpoints, field-map, verify, fixture')
    .option('-o, --output <path>', OUTPUT_ARG_HELP),
    'webcmd site memory show example.com --kind notes'), 'json');
  show.action(async (name, opts: { kind?: string; output?: string; format?: string }) => {
    await emitListing(show, await backend.show(name, parseKind(opts.kind)), opts, stdout);
  });
  const list = addOutputFormatOption(withExample(memory.command('list')
    .description('List the memory files stored for a site with size, checksum and last update')
    .argument('<site>', SITE_ARG_HELP)
    .option('-o, --output <path>', OUTPUT_ARG_HELP),
    'webcmd site memory list example.com'));
  list.action(async (name, opts: { output?: string; format?: string }) => {
    await emitListing(list, await backend.list(name), opts, stdout, ['path', 'updatedAt', 'byteSize', 'sha256']);
  });

  const note = withExample(site.command('note')
    .description('Read and write freeform site notes: webcmd site note <add|list> <site>')
    .usage('add|list <site> [options]'),
    'webcmd site note add example.com --text "search needs a session cookie"');
  withExample(note.command('add')
    .description('Append a markdown note to a site; the site name comes before --text')
    .argument('<site>', SITE_ARG_HELP)
    .requiredOption('--text <markdown>', 'Note body, in markdown (required; there is no -m alias)')
    .option('--author <author>', 'Who wrote the note'),
    'webcmd site note add example.com --text "search needs a session cookie" --author agent')
    .action((name, opts: { text: string; author?: string }) => backend.note(name, opts.text, opts.author));
  const noteList = addOutputFormatOption(withExample(note.command('list')
    .description('Print the notes recorded for a site')
    .argument('<site>', SITE_ARG_HELP)
    .option('-o, --output <path>', OUTPUT_ARG_HELP),
    'webcmd site note list example.com'), 'json');
  noteList.action(async (name, opts: { output?: string; format?: string }) => {
    await emitListing(noteList, await backend.show(name, 'notes'), opts, stdout);
  });

  const endpoint = withExample(site.command('endpoint')
    .description('Maintain the verified API endpoints found for a site: webcmd site endpoint <set|stale|list> <site>')
    .usage('set|stale|list <site> [args] [options]'),
    'webcmd site endpoint set example.com search --url https://example.com/api/search --method GET');
  withExample(endpoint.command('set')
    .description('Record or update one verified endpoint for a site')
    .argument('<site>', SITE_ARG_HELP)
    .argument('<name>', 'Endpoint name to store it under, e.g. search')
    .requiredOption('--url <url>', 'Request URL of the endpoint')
    .requiredOption('--method <method>', 'HTTP method, e.g. GET or POST')
    .option('--params <json>', 'Query or body parameters as a JSON object')
    .option('--rows-path <path>', 'Dot path to the result rows inside the response, e.g. data.items')
    .option('--fields <fields>', 'Comma-separated list of the response fields worth keeping')
    .option('--notes <text>', 'Freeform notes about auth, paging or quirks'),
    'webcmd site endpoint set example.com search --url https://example.com/api/search --method GET --rows-path data.items')
    .action((siteName, name, opts: { url: string; method: string; params?: string; rowsPath?: string; fields?: string; notes?: string }) => backend.endpoint(siteName, name, {
      url: opts.url, method: opts.method,
      ...(opts.params ? { params: parseJsonObject(opts.params) } : {}),
      ...(opts.rowsPath ? { rowsPath: opts.rowsPath } : {}),
      ...(opts.fields ? { sampleFields: opts.fields.split(',').map(value => value.trim()).filter(Boolean) } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
    }));
  withExample(endpoint.command('stale')
    .description('Mark a recorded endpoint stale once it stops returning what it used to')
    .argument('<site>', SITE_ARG_HELP)
    .argument('<name>', 'Name of the recorded endpoint to mark stale'),
    'webcmd site endpoint stale example.com search')
    .action((siteName, name) => backend.stale(siteName, name));
  const endpointList = addOutputFormatOption(withExample(endpoint.command('list')
    .description('Print the endpoints recorded for a site')
    .argument('<site>', SITE_ARG_HELP)
    .option('-o, --output <path>', OUTPUT_ARG_HELP),
    'webcmd site endpoint list example.com'), 'json');
  endpointList.action(async (name, opts: { output?: string; format?: string }) => {
    await emitListing(endpointList, await backend.show(name, 'endpoints'), opts, stdout);
  });

  const fieldMap = withExample(site.command('field-map')
    .description('Explain what opaque response field names mean: webcmd site field-map add <site> <key>')
    .usage('add <site> <key> [options]'),
    'webcmd site field-map add example.com p --meaning "price in cents" --source /api/search');
  withExample(fieldMap.command('add')
    .description('Record what one response field means and where it was observed')
    .argument('<site>', SITE_ARG_HELP)
    .argument('<key>', 'Raw field name as it appears in the response, e.g. p')
    .requiredOption('--meaning <meaning>', 'What the field actually holds')
    .requiredOption('--source <source>', 'Where it was seen, e.g. the endpoint path')
    .option('--force', 'Overwrite an existing mapping for this key'),
    'webcmd site field-map add example.com p --meaning "price in cents" --source /api/search')
    .action((siteName, key, opts: { meaning: string; source: string; force?: boolean }) => backend.fieldMap(siteName, key, opts.meaning, opts.source, opts.force === true));

  const fixture = withExample(site.command('fixture')
    .description('Read and write the verify fixtures used by webcmd browser verify: webcmd site fixture <get|put> <site>/<command>')
    .usage('get|put <site>/<command> [args] [options]'),
    'webcmd site fixture get example.com/search');
  const get = addOutputFormatOption(withExample(fixture.command('get')
    .description('Print the stored verify fixture for one site command')
    .argument('<site-command>', SITE_COMMAND_ARG_HELP)
    .option('--output <path>', OUTPUT_ARG_HELP),
    'webcmd site fixture get example.com/search'), 'json');
  get.action(async (key, opts: { output?: string; format?: string }) => {
    const { site: siteName, command } = parseSiteCommand(key);
    const body = await backend.fixture(siteName, command);
    if (body === null) throw new CliError('SITE_MEMORY_NOT_FOUND', `Verify fixture ${key} was not found.`, undefined, EXIT_CODES.EMPTY_RESULT);
    if (opts.output) {
      await writeFile(opts.output, body);
      return;
    }
    if (!outputFormatIsExplicit(get)) {
      if (stdout) await writeToStream(stdout, body);
      else process.stdout.write(body);
      return;
    }
    const fmt = resolveCommandOutputFormat(get, opts.format);
    if (fmt === null) return;
    await renderOutput(parseFixtureBody(body), { fmt, fmtExplicit: true, stdout });
  });
  withExample(fixture.command('put')
    .description('Store a verify fixture for one site command, read from a file or stdin')
    .argument('<site-command>', SITE_COMMAND_ARG_HELP)
    .argument('[path]', 'File holding the fixture body; omit it and pass --stdin to read stdin')
    .option('--stdin', 'Read the fixture from stdin'),
    'webcmd site fixture put example.com/search ./search.json')
    .action(async (key, file: string | undefined, opts: { stdin?: boolean }) => {
      const { site: siteName, command } = parseSiteCommand(key);
      await backend.putFixture(siteName, command, await readSitePutSource(
        { path: file, stdin: opts.stdin === true },
        { readStdin: io.readStdin, usage: 'webcmd site fixture put <site/cmd>' },
      ));
    });

  const sample = withExample(site.command('sample')
    .description('Keep raw response samples for a site command: webcmd site sample add <site>/<command>')
    .usage('add <site>/<command> [path] [options]'),
    'webcmd site sample add example.com/search ./sample.json');
  withExample(sample.command('add')
    .description('Save a raw response sample for one site command, read from a file or stdin')
    .argument('<site-command>', SITE_COMMAND_ARG_HELP)
    .argument('[path]', 'File holding the sample body; omit it and pass --stdin to read stdin')
    .option('--stdin', 'Read the sample from stdin'),
    'webcmd site sample add example.com/search ./sample.json')
    .action(async (key, file: string | undefined, opts: { stdin?: boolean }) => {
      const { site: siteName, command } = parseSiteCommand(key);
      await backend.sample(siteName, command, await readSitePutSource(
        { path: file, stdin: opts.stdin === true },
        { readStdin: io.readStdin, usage: 'webcmd site sample add <site/cmd>' },
      ));
    });
}

export function createLocalSiteMemoryBackend(options: LocalStoreOptions = {}): SiteMemoryBackend {
  return {
    show: async (site, kind) => (await showSiteMemory(site, options)).filter(item => !kind || kindForPath(item.path) === kind),
    list: site => listSiteMemory(site, options),
    note: (site, text, author) => appendNote({ site, text, author, ...options }).then(() => undefined),
    endpoint: (site, name, input) => setEndpoint({ site, name, ...input, ...options }),
    stale: (site, name) => markEndpointStale({ site, name, ...options }),
    fieldMap: (site, key, meaning, source, force) => addFieldMapping({ site, key, meaning, source, force, ...options }),
    fixture: (site, command) => getVerifyFixture(site, command, options),
    putFixture: (site, command, body) => putVerifyFixture({ site, command, body, ...options }),
    sample: (site, command, body) => addResponseSample({ site, command, body, ...options }).then(() => undefined),
  };
}

export async function readSitePutSource(
  input: SitePutSourceInput,
  io: { readStdin?: () => Promise<string>; readPath?: (file: string) => Promise<string>; usage?: string } = {},
): Promise<string> {
  const usage = io.usage ?? 'webcmd site fixture put <site/cmd>';
  const path = typeof input.path === 'string' && input.path !== '-' ? input.path : undefined;
  const fromStdin = input.stdin === true || input.path === '-';
  if (fromStdin && path) {
    throw new ArgumentError(
      'Choose exactly one source: --stdin or <path>.',
      `Use: ${usage} <path>   or   printf '{}' | ${usage} --stdin`,
    );
  }
  if (!fromStdin && !path) {
    throw new ArgumentError(
      'Body requires a file path, --stdin, or -.',
      `Use: ${usage} <path>\nexample: printf '{}' | ${usage} --stdin`,
    );
  }
  return fromStdin ? (io.readStdin ?? readProcessStdin)() : (io.readPath ?? ((file: string) => readFile(file, 'utf8')))(path!);
}

function parseKind(value: string | undefined): MemoryKind | undefined {
  if (value === undefined) return undefined;
  if (value === 'notes' || value === 'endpoints' || value === 'field-map' || value === 'verify' || value === 'fixture') return value;
  throw new ArgumentError('--kind must be notes, endpoints, field-map, verify, or fixture.');
}

function parseJsonObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonObject;
  } catch { /* covered by the shared message below */ }
  throw new ArgumentError('--params must be a JSON object.');
}

function parseSiteCommand(value: string): { site: string; command: string } {
  const [site, command, extra] = value.split('/');
  if (!site || !command || extra || site === '.' || site === '..' || command === '.' || command === '..' || site.includes('\\') || command.includes('\\')) {
    throw new ArgumentError('Site command must use site/command format.');
  }
  return { site, command };
}

function kindForPath(path: string): MemoryKind | undefined {
  if (path === 'notes.md') return 'notes';
  if (path === 'endpoints.json') return 'endpoints';
  if (path === 'field-map.json') return 'field-map';
  if (path.startsWith('verify/')) return 'verify';
  if (path.startsWith('fixtures/')) return 'fixture';
  return undefined;
}

function parseFixtureBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function emitListing(
  command: Command,
  data: unknown,
  opts: { format?: string; output?: string },
  stdout?: NodeJS.WritableStream,
  columns?: string[],
): Promise<void> {
  if (opts.output) {
    await writeFile(opts.output, `${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const fmt = resolveCommandOutputFormat(command, opts.format);
  if (fmt === null) return;
  await renderOutput(data, { fmt, fmtExplicit: outputFormatIsExplicit(command), ...(columns ? { columns } : {}), stdout });
}

async function readProcessStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
