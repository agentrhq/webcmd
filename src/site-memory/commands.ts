import { readFile, writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { addOutputFormatOption, outputFormatIsExplicit, resolveCommandOutputFormat } from '../command-surface.js';
import { ArgumentError, CliError, EXIT_CODES } from '../errors.js';
import { getRequestedHelpFormat } from '../help.js';
import { render as renderOutput } from '../output.js';
import { writeToStream } from '../stream-write.js';
import { addCandidate, listCandidates, searchCandidates, showCandidate } from './candidates.js';
import { checkpointMemory } from './checkpoint.js';
import { getMemoryContext } from './context.js';
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
import {
  CANDIDATE_KINDS,
  type Candidate,
  type CandidateDisposition,
  type CandidateSummary,
  type CheckpointReason,
  type CheckpointResult,
  type MemoryContext,
} from './model.js';

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

export interface SiteLearningBackend {
  context(url: string, taskId: string): Promise<MemoryContext>;
  addCandidate(input: {
    product: string;
    hostname?: string;
    kind: string;
    claim: string;
    evidence: string;
    consequence: string;
    observedAt?: string;
  }): Promise<CandidateSummary>;
  searchCandidates(product: string, query: string, limit?: number): Promise<CandidateSummary[]>;
  showCandidate(product: string, id: string): Promise<Candidate>;
  listCandidates(product: string): Promise<CandidateSummary[]>;
  checkpoint(input: {
    product: string;
    taskId: string;
    expectedRevision: string | null;
    reason: CheckpointReason;
    paths: string[];
    dispositions?: CandidateDisposition[];
  }): Promise<CheckpointResult>;
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
  learning?: SiteLearningBackend,
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
  if (learning) registerLearningCommands(memory, learning, stdout);

  /** Write commands print nothing by default; a format flag turns that into a result object. */
  const emitWriteResult = async (command: Command, payload: Record<string, unknown>): Promise<void> => {
    if (!outputFormatIsExplicit(command)) return;
    const fmt = resolveCommandOutputFormat(command, (command.opts() as { format?: string }).format);
    if (fmt === null) return;
    await renderOutput(payload, { fmt, fmtExplicit: true, stdout });
  };

  const note = withExample(site.command('note')
    .description('Read and write freeform site notes: webcmd site note <add|list> <site>')
    .usage('add|list <site> [options]'),
    'webcmd site note add example.com --text "search needs a session cookie"');
  const noteAdd = addOutputFormatOption(withExample(note.command('add')
    .description('Append a markdown note to a site; the site name comes before --text')
    .argument('<site>', SITE_ARG_HELP)
    .requiredOption('--text <markdown>', 'Note body, in markdown (required; there is no -m alias)')
    .option('--author <author>', 'Who wrote the note'),
    'webcmd site note add example.com --text "search needs a session cookie" --author agent'), 'json');
  noteAdd.action(async (name, opts: { text: string; author?: string }) => {
    await backend.note(name, opts.text, opts.author);
    await emitWriteResult(noteAdd, { ok: true, action: 'note add', site: name });
  });
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
  const endpointSet = addOutputFormatOption(withExample(endpoint.command('set')
    .description('Record or update one verified endpoint for a site')
    .argument('<site>', SITE_ARG_HELP)
    .argument('<name>', 'Endpoint name to store it under, e.g. search')
    .requiredOption('--url <url>', 'Request URL of the endpoint')
    .requiredOption('--method <method>', 'HTTP method, e.g. GET or POST')
    .option('--params <json>', 'Query or body parameters as a JSON object')
    .option('--rows-path <path>', 'Dot path to the result rows inside the response, e.g. data.items')
    .option('--fields <fields>', 'Comma-separated list of the response fields worth keeping')
    .option('--notes <text>', 'Freeform notes about auth, paging or quirks'),
    'webcmd site endpoint set example.com search --url https://example.com/api/search --method GET --rows-path data.items'), 'json');
  endpointSet.action(async (siteName, name, opts: { url: string; method: string; params?: string; rowsPath?: string; fields?: string; notes?: string }) => {
    await backend.endpoint(siteName, name, {
      url: opts.url, method: opts.method,
      ...(opts.params ? { params: parseJsonObject(opts.params) } : {}),
      ...(opts.rowsPath ? { rowsPath: opts.rowsPath } : {}),
      ...(opts.fields ? { sampleFields: opts.fields.split(',').map(value => value.trim()).filter(Boolean) } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
    });
    await emitWriteResult(endpointSet, { ok: true, action: 'endpoint set', site: siteName, endpoint: name, url: opts.url, method: opts.method });
  });
  const endpointStale = addOutputFormatOption(withExample(endpoint.command('stale')
    .description('Mark a recorded endpoint stale once it stops returning what it used to')
    .argument('<site>', SITE_ARG_HELP)
    .argument('<name>', 'Name of the recorded endpoint to mark stale'),
    'webcmd site endpoint stale example.com search'), 'json');
  endpointStale.action(async (siteName, name) => {
    await backend.stale(siteName, name);
    await emitWriteResult(endpointStale, { ok: true, action: 'endpoint stale', site: siteName, endpoint: name });
  });
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
  const fieldMapAdd = addOutputFormatOption(withExample(fieldMap.command('add')
    .description('Record what one response field means and where it was observed')
    .argument('<site>', SITE_ARG_HELP)
    .argument('<key>', 'Raw field name as it appears in the response, e.g. p')
    .requiredOption('--meaning <meaning>', 'What the field actually holds')
    .requiredOption('--source <source>', 'Where it was seen, e.g. the endpoint path')
    .option('--force', 'Overwrite an existing mapping for this key'),
    'webcmd site field-map add example.com p --meaning "price in cents" --source /api/search'), 'json');
  fieldMapAdd.action(async (siteName, key, opts: { meaning: string; source: string; force?: boolean }) => {
    await backend.fieldMap(siteName, key, opts.meaning, opts.source, opts.force === true);
    await emitWriteResult(fieldMapAdd, { ok: true, action: 'field-map add', site: siteName, key });
  });

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
  const fixturePut = addOutputFormatOption(withExample(fixture.command('put')
    .description('Store a verify fixture for one site command, read from a file or stdin')
    .argument('<site-command>', SITE_COMMAND_ARG_HELP)
    .argument('[path]', 'File holding the fixture body; omit it and pass --stdin to read stdin')
    .option('--stdin', 'Read the fixture from stdin'),
    'webcmd site fixture put example.com/search ./search.json'), 'json');
  fixturePut.action(async (key, file: string | undefined, opts: { stdin?: boolean }) => {
    const { site: siteName, command } = parseSiteCommand(key);
    await backend.putFixture(siteName, command, await readSitePutSource(
      { path: file, stdin: opts.stdin === true },
      { readStdin: io.readStdin, usage: 'webcmd site fixture put <site/cmd>' },
    ));
    await emitWriteResult(fixturePut, { ok: true, action: 'fixture put', site: siteName, command });
  });

  const sample = withExample(site.command('sample')
    .description('Keep raw response samples for a site command: webcmd site sample add <site>/<command>')
    .usage('add <site>/<command> [path] [options]'),
    'webcmd site sample add example.com/search ./sample.json');
  const sampleAdd = addOutputFormatOption(withExample(sample.command('add')
    .description('Save a raw response sample for one site command, read from a file or stdin')
    .argument('<site-command>', SITE_COMMAND_ARG_HELP)
    .argument('[path]', 'File holding the sample body; omit it and pass --stdin to read stdin')
    .option('--stdin', 'Read the sample from stdin'),
    'webcmd site sample add example.com/search ./sample.json'), 'json');
  sampleAdd.action(async (key, file: string | undefined, opts: { stdin?: boolean }) => {
    const { site: siteName, command } = parseSiteCommand(key);
    await backend.sample(siteName, command, await readSitePutSource(
      { path: file, stdin: opts.stdin === true },
      { readStdin: io.readStdin, usage: 'webcmd site sample add <site/cmd>' },
    ));
    await emitWriteResult(sampleAdd, { ok: true, action: 'sample add', site: siteName, command });
  });
}

function registerLearningCommands(
  memory: Command,
  learning: SiteLearningBackend,
  stdout?: NodeJS.WritableStream,
): void {
  const emit = async (command: Command, data: unknown, opts: { format?: string } = {}): Promise<void> => {
    const fmt = resolveCommandOutputFormat(command, opts.format);
    if (fmt === null) return;
    await renderOutput(data, { fmt, fmtExplicit: true, stdout });
  };

  const context = addOutputFormatOption(withExample(memory.command('context')
    .description('Resolve product identity, seed memory once, and return the task draft path')
    .argument('<url>', 'Page URL used to resolve the product')
    .requiredOption('--task-id <id>', 'Task id that owns the isolated draft'),
    'webcmd site memory context https://example.test/ --task-id task-1 -f json'), 'json');
  context.action(async (url: string, opts: { taskId: string; format?: string }) => {
    await emit(context, await learning.context(url, opts.taskId), opts);
  });

  const candidate = withExample(memory.command('candidate')
    .description('Capture and inspect candidate evidence: webcmd site memory candidate <add|search|show|list> <product>')
    .usage('add|search|show|list <product> [args] [options]'),
    'webcmd site memory candidate list example.test -f json');

  const add = addOutputFormatOption(withExample(candidate.command('add')
    .description('Record one qualifying observation as candidate evidence')
    .argument('<product>', 'Product key or hostname')
    .requiredOption('--kind <kind>', `One of: ${CANDIDATE_KINDS.join(', ')}`)
    .requiredOption('--claim <claim>', 'Short claim this observation supports')
    .requiredOption('--evidence <evidence>', 'Bounded secret-free evidence from the task')
    .requiredOption('--consequence <consequence>', 'Why this may matter later')
    .option('--hostname <hostname>', 'Observed hostname when it differs from the product key')
    .option('--observed-at <timestamp>', 'Observation timestamp; defaults to now'),
    'webcmd site memory candidate add example.test --kind access --claim "Login is optional" --evidence "Opened /hot" --consequence "Skip auth" -f json'), 'json');
  add.action(async (product: string, opts: {
    kind: string; claim: string; evidence: string; consequence: string; hostname?: string; observedAt?: string; format?: string;
  }) => {
    await emit(add, await learning.addCandidate({
      product,
      kind: parseCandidateKind(opts.kind),
      claim: opts.claim,
      evidence: opts.evidence,
      consequence: opts.consequence,
      ...(opts.hostname ? { hostname: opts.hostname } : {}),
      ...(opts.observedAt ? { observedAt: opts.observedAt } : {}),
    }), opts);
  });

  const search = addOutputFormatOption(withExample(candidate.command('search')
    .description('Search pending candidates with bounded lexical matching')
    .argument('<product>', 'Product key or hostname')
    .requiredOption('--query <query>', 'Lexical query over claim, kind, hostname, and consequence')
    .option('--limit <n>', 'Maximum matches to return'),
    'webcmd site memory candidate search example.test --query "old reddit" -f json'), 'json');
  search.action(async (product: string, opts: { query: string; limit?: string; format?: string }) => {
    await emit(search, await learning.searchCandidates(product, opts.query, parseLimit(opts.limit)), opts);
  });

  const show = addOutputFormatOption(withExample(candidate.command('show')
    .description('Load one explicit candidate, including environment provenance')
    .argument('<product>', 'Product key or hostname')
    .argument('<id>', 'Candidate id'),
    'webcmd site memory candidate show example.test 20260831T142300Z-aaaa -f json'), 'json');
  show.action(async (product: string, id: string, opts: { format?: string }) => {
    try {
      await emit(show, await learning.showCandidate(product, id), opts);
    } catch (error) {
      throw notFoundOrRethrow(error);
    }
  });

  const candidateList = addOutputFormatOption(withExample(candidate.command('list')
    .description('List candidate inventory for a product without raw environment values')
    .argument('<product>', 'Product key or hostname'),
    'webcmd site memory candidate list example.test -f json'), 'json');
  candidateList.action(async (product: string, opts: { format?: string }) => {
    await emit(candidateList, await learning.listCandidates(product), opts);
  });

  const checkpoint = addOutputFormatOption(withExample(memory.command('checkpoint')
    .description('Publish a task draft into active memory with explicit candidate dispositions')
    .argument('<product>', 'Product key or hostname')
    .requiredOption('--task-id <id>', 'Task id whose draft should be published')
    .requiredOption('--expected-revision <revision>', 'Revision returned by site memory context; use null when none')
    .requiredOption('--reason <reason>', 'candidate_ingestion, direct_correction, or major_rewrite')
    .requiredOption('--paths <paths>', 'Comma-separated Markdown paths to copy from the draft')
    .option('--dispositions <json>', 'JSON array of candidate dispositions'),
    'webcmd site memory checkpoint example.test --task-id task-1 --expected-revision rev1 --reason direct_correction --paths sitemap/SITE.md -f json'), 'json');
  checkpoint.action(async (product: string, opts: {
    taskId: string; expectedRevision: string; reason: string; paths: string; dispositions?: string; format?: string;
  }) => {
    const result = await learning.checkpoint({
      product,
      taskId: opts.taskId,
      expectedRevision: parseRevision(opts.expectedRevision),
      reason: parseCheckpointReason(opts.reason),
      paths: parsePaths(opts.paths),
      ...(opts.dispositions ? { dispositions: parseDispositions(opts.dispositions) } : {}),
    });
    if (result.status === 'conflict') {
      throw Object.assign(
        new CliError(
          'SITE_MEMORY_CONFLICT',
          'Expected revision changed.',
          'Retry webcmd site memory context, then checkpoint once.',
          EXIT_CODES.TEMPFAIL,
        ),
        { details: { expectedRevision: result.expectedRevision, actualRevision: result.actualRevision } },
      );
    }
    await emit(checkpoint, result, opts);
  });
}

export function createLocalLearningBackend(options: LocalStoreOptions = {}): SiteLearningBackend {
  return {
    context: (url, taskId) => getMemoryContext({ url, taskId, ...options }),
    addCandidate: input => addCandidate({ ...input, ...options }),
    searchCandidates: (product, query, limit) => searchCandidates(product, query, limit, options),
    showCandidate: (product, id) => showCandidate(product, id, options),
    listCandidates: product => listCandidates(product, options),
    checkpoint: input => checkpointMemory({ ...input, ...options }),
  };
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

function parseCandidateKind(value: string): (typeof CANDIDATE_KINDS)[number] {
  if ((CANDIDATE_KINDS as readonly string[]).includes(value)) return value as (typeof CANDIDATE_KINDS)[number];
  throw new ArgumentError(`--kind must be one of: ${CANDIDATE_KINDS.join(', ')}.`);
}

const CHECKPOINT_REASONS = ['candidate_ingestion', 'direct_correction', 'major_rewrite'] as const;

function parseCheckpointReason(value: string): CheckpointReason {
  if ((CHECKPOINT_REASONS as readonly string[]).includes(value)) return value as CheckpointReason;
  throw new ArgumentError(`--reason must be one of: ${CHECKPOINT_REASONS.join(', ')}.`);
}

function parseRevision(value: string): string | null {
  return value === '' || value === 'null' ? null : value;
}

function parsePaths(value: string): string[] {
  return value.split(',').map(path => path.trim()).filter(Boolean);
}

function parseDispositions(value: string): CandidateDisposition[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed as CandidateDisposition[];
  } catch { /* covered by the shared message below */ }
  throw new ArgumentError('--dispositions must be a JSON array.');
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ArgumentError('--limit must be a positive integer.');
  return parsed;
}

function notFoundOrRethrow(error: unknown): never {
  if (error instanceof Error && /not found/i.test(error.message)) {
    throw new CliError('SITE_MEMORY_NOT_FOUND', error.message, undefined, EXIT_CODES.EMPTY_RESULT);
  }
  throw error;
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
