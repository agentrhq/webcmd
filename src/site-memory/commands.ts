import { readFile, writeFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { ArgumentError, CliError, EXIT_CODES } from '../errors.js';
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

export function registerSiteCommands(root: Command, backend: SiteMemoryBackend, stdout?: NodeJS.WritableStream): void {
  const site = root.command('site').description('Read and write site memory');
  const memory = site.command('memory').description('Inspect site memory');
  memory.command('show').argument('<site>').option('--kind <kind>').action(async (name, opts: { kind?: string }) => {
    await renderOutput(await backend.show(name, parseKind(opts.kind)), { fmt: 'json', stdout });
  });
  memory.command('list').argument('<site>').action(async (name) => {
    await renderOutput(await backend.list(name), { fmt: 'table', fmtExplicit: true, columns: ['path', 'updatedAt', 'byteSize', 'sha256'], stdout });
  });
  site.command('note').command('add').argument('<site>').requiredOption('--text <markdown>').option('--author <author>')
    .action((name, opts: { text: string; author?: string }) => backend.note(name, opts.text, opts.author));
  const endpoint = site.command('endpoint').description('Maintain verified endpoints');
  endpoint.command('set').argument('<site>').argument('<name>').requiredOption('--url <url>').requiredOption('--method <method>')
    .option('--params <json>').option('--rows-path <path>').option('--fields <fields>').option('--notes <text>')
    .action((siteName, name, opts: { url: string; method: string; params?: string; rowsPath?: string; fields?: string; notes?: string }) => backend.endpoint(siteName, name, {
      url: opts.url, method: opts.method,
      ...(opts.params ? { params: parseJsonObject(opts.params) } : {}),
      ...(opts.rowsPath ? { rowsPath: opts.rowsPath } : {}),
      ...(opts.fields ? { sampleFields: opts.fields.split(',').map(value => value.trim()).filter(Boolean) } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
    }));
  endpoint.command('stale').argument('<site>').argument('<name>').action((siteName, name) => backend.stale(siteName, name));
  site.command('field-map').command('add').argument('<site>').argument('<key>').requiredOption('--meaning <meaning>').requiredOption('--source <source>').option('--force')
    .action((siteName, key, opts: { meaning: string; source: string; force?: boolean }) => backend.fieldMap(siteName, key, opts.meaning, opts.source, opts.force === true));
  const fixture = site.command('fixture').description('Read and write verify fixtures');
  fixture.command('get').argument('<site-command>').option('--output <path>').action(async (key, opts: { output?: string }) => {
    const { site: siteName, command } = parseSiteCommand(key);
    const body = await backend.fixture(siteName, command);
    if (body === null) throw new CliError('SITE_MEMORY_NOT_FOUND', `Verify fixture ${key} was not found.`, undefined, EXIT_CODES.EMPTY_RESULT);
    if (opts.output) await writeFile(opts.output, body);
    else if (stdout) await writeToStream(stdout, body);
    else process.stdout.write(body);
  });
  fixture.command('put').argument('<site-command>').argument('<path>').action(async (key, file) => {
    const { site: siteName, command } = parseSiteCommand(key);
    await backend.putFixture(siteName, command, await readFile(file, 'utf8'));
  });
  site.command('sample').command('add').argument('<site-command>').argument('<path>').action(async (key, file) => {
    const { site: siteName, command } = parseSiteCommand(key);
    await backend.sample(siteName, command, await readFile(file, 'utf8'));
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
