import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { ArgumentError, CliError, EXIT_CODES } from '../errors.js';
import {
  configureSiteEndpointSetSurface,
  configureSiteEndpointStaleSurface,
  configureSiteFieldMapAddSurface,
  configureSiteFixtureGetSurface,
  configureSiteFixturePutSurface,
  configureSiteMemoryListSurface,
  configureSiteMemoryShowSurface,
  configureSiteNoteAddSurface,
  configureSiteSampleAddSurface,
} from '../builtin-command-surface.js';
import { render as renderOutput } from '../output.js';
import { writeToStream } from '../stream-write.js';
import {
  addFieldMapping,
  appendNote,
  listSiteMemory,
  markEndpointStale,
  setEndpoint,
  showSiteMemory,
  type EndpointInput,
  type FieldMappingInput,
  type LocalStoreOptions,
  type NoteInput,
  type SiteMemoryBody,
  type SiteMemoryListing,
} from './local-store.js';

type JsonObject = Record<string, unknown>;
type MemoryKind = 'notes' | 'endpoints' | 'field-map' | 'verify' | 'fixture';

export interface SiteMemoryBackend {
  showSiteMemory(site: string, kind?: MemoryKind): Promise<SiteMemoryBody[]>;
  listSiteMemory(site: string): Promise<SiteMemoryListing[]>;
  appendNote(input: Omit<NoteInput, 'homeDir'>): Promise<unknown>;
  setEndpoint(input: Omit<EndpointInput, 'homeDir'>): Promise<unknown>;
  markEndpointStale(input: { site: string; name: string }): Promise<unknown>;
  addFieldMapping(input: Omit<FieldMappingInput, 'homeDir'>): Promise<unknown>;
  getFixture(site: string, command: string): Promise<string | null>;
  putFixture(site: string, command: string, body: string): Promise<unknown>;
  addSample(site: string, command: string, body: string): Promise<unknown>;
}

export function registerSiteCommands(
  root: Command,
  backend: SiteMemoryBackend,
  options: { stdout?: NodeJS.WritableStream } = {},
): Command {
  const site = root.command('site').description('Read and write site memory');
  const memory = site.command('memory').description('Inspect site memory');

  configureSiteMemoryShowSurface(memory.command('show')).action(async (siteName: string, opts: { kind?: string }) => {
    const kind = parseKind(opts.kind);
    await renderOutput(await backend.showSiteMemory(siteName, kind), { fmt: 'json', stdout: options.stdout });
  });
  configureSiteMemoryListSurface(memory.command('list')).action(async (siteName: string) => {
    await renderOutput(await backend.listSiteMemory(siteName), {
      fmt: 'table',
      fmtExplicit: true,
      columns: ['path', 'updatedAt', 'byteSize', 'sha256'],
      stdout: options.stdout,
    });
  });

  const note = site.command('note').description('Write site notes');
  configureSiteNoteAddSurface(note.command('add')).action(async (siteName: string, opts: { text: string; author?: string }) => {
    await backend.appendNote({ site: siteName, text: opts.text, ...(opts.author !== undefined ? { author: opts.author } : {}) });
  });

  const endpoint = site.command('endpoint').description('Maintain verified endpoints');
  configureSiteEndpointSetSurface(endpoint.command('set')).action(async (siteName: string, name: string, opts: {
    url: string;
    method: string;
    params?: string;
    rowsPath?: string;
    fields?: string;
    notes?: string;
  }) => {
    await backend.setEndpoint({
      site: siteName,
      name,
      url: opts.url,
      method: opts.method,
      ...(opts.params !== undefined ? { params: parseJsonObject(opts.params, '--params') } : {}),
      ...(opts.rowsPath !== undefined ? { rowsPath: opts.rowsPath } : {}),
      ...(opts.fields !== undefined ? { sampleFields: opts.fields.split(',').map(field => field.trim()).filter(Boolean) } : {}),
      ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
    });
  });
  configureSiteEndpointStaleSurface(endpoint.command('stale')).action(async (siteName: string, name: string) => {
    await backend.markEndpointStale({ site: siteName, name });
  });

  const fieldMap = site.command('field-map').description('Maintain field mappings');
  configureSiteFieldMapAddSurface(fieldMap.command('add')).action(async (siteName: string, key: string, opts: {
    meaning: string;
    source: string;
    force?: boolean;
  }) => {
    try {
      await backend.addFieldMapping({ site: siteName, key, meaning: opts.meaning, source: opts.source, force: opts.force === true });
    } catch (error) {
      if (statusCode(error) === 409 || (error instanceof CliError && error.code === 'SITE_MEMORY_FIELD_MAPPING_EXISTS')) {
        throw new CliError('SITE_MEMORY_FIELD_MAPPING_EXISTS', message(error), 'Use --force only after confirming the replacement mapping.');
      }
      throw error;
    }
  });

  const fixture = site.command('fixture').description('Read and write verify fixtures');
  configureSiteFixtureGetSurface(fixture.command('get')).action(async (siteCommand: string, opts: { output?: string }) => {
    const { site: siteName, command } = parseSiteCommand(siteCommand);
    const body = await backend.getFixture(siteName, command);
    if (body === null) throw new CliError('SITE_MEMORY_NOT_FOUND', `Verify fixture ${siteCommand} was not found.`, undefined, EXIT_CODES.EMPTY_RESULT);
    if (opts.output !== undefined) {
      await writeFile(opts.output, body);
      return;
    }
    if (options.stdout) await writeToStream(options.stdout, body);
    else process.stdout.write(body);
  });
  configureSiteFixturePutSurface(fixture.command('put')).action(async (siteCommand: string, path: string) => {
    const { site: siteName, command } = parseSiteCommand(siteCommand);
    const body = await readFile(path, 'utf8');
    validateFixture(body);
    await backend.putFixture(siteName, command, body);
  });

  const sample = site.command('sample').description('Store response samples');
  configureSiteSampleAddSurface(sample.command('add')).action(async (siteCommand: string, path: string) => {
    const { site: siteName, command } = parseSiteCommand(siteCommand);
    await backend.addSample(siteName, command, await readFile(path, 'utf8'));
  });

  return site;
}

export function createLocalSiteMemoryBackend(options: LocalStoreOptions = {}): SiteMemoryBackend {
  const root = (site: string) => join(requiredHomeDir(options), '.webcmd', 'sites', site);
  return {
    showSiteMemory: async (site, kind) => (await showSiteMemory(site, options)).filter(entry => !kind || kindForPath(entry.path) === kind),
    listSiteMemory: (site) => listSiteMemory(site, options),
    appendNote: (input) => appendNote({ ...input, ...options }),
    setEndpoint: (input) => setEndpoint({ ...input, ...options }),
    markEndpointStale: (input) => markEndpointStale({ ...input, ...options }),
    addFieldMapping: (input) => addFieldMapping({ ...input, ...options }),
    getFixture: async (site, command) => {
      try {
        return (await showSiteMemory(site, { ...options, paths: [`verify/${command}.json`] }))[0]?.body ?? null;
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
    putFixture: async (site, command, body) => writeSiteFile(root(site), `verify/${command}.json`, body),
    addSample: async (site, command, body) => writeSiteFile(root(site), `fixtures/${command}-${Date.now()}.json`, body),
  };
}

function parseKind(value: string | undefined): MemoryKind | undefined {
  if (value === undefined) return undefined;
  if (value === 'notes' || value === 'endpoints' || value === 'field-map' || value === 'verify' || value === 'fixture') return value;
  throw new ArgumentError('--kind must be notes, endpoints, field-map, verify, or fixture.');
}

function parseJsonObject(value: string, flag: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonObject;
  } catch {
    // The error below keeps invalid JSON and valid non-object JSON equally actionable.
  }
  throw new ArgumentError(`${flag} must be a JSON object.`);
}

function parseSiteCommand(value: string): { site: string; command: string } {
  const [site, command, extra] = value.split('/');
  if (!validPathSegment(site) || !validPathSegment(command) || extra !== undefined) {
    throw new ArgumentError('Site command must use site/command format.');
  }
  return { site, command };
}

function validPathSegment(value: string | undefined): value is string {
  return typeof value === 'string' && value !== '' && value !== '.' && value !== '..' && !value.includes('\\') && !value.includes('\0');
}

function validateFixture(body: string): void {
  let fixture: unknown;
  try {
    fixture = JSON.parse(body);
  } catch {
    throw new ArgumentError('Fixture must be valid JSON.');
  }
  if (!isRecord(fixture)) throw fixtureError('fixture');
  if ('args' in fixture && !isRecord(fixture.args) && !Array.isArray(fixture.args)) throw fixtureError('args');
  if (!('expect' in fixture)) return;
  if (!isRecord(fixture.expect)) throw fixtureError('expect');
  const expect = fixture.expect;
  if ('columns' in expect && !stringArray(expect.columns)) throw fixtureError('columns');
  if ('notEmpty' in expect && !stringArray(expect.notEmpty)) throw fixtureError('notEmpty');
  if ('mustBeTruthy' in expect && !stringArray(expect.mustBeTruthy)) throw fixtureError('mustBeTruthy');
  if ('rowCount' in expect) {
    if (!isRecord(expect.rowCount)) throw fixtureError('rowCount');
    const { min, max } = expect.rowCount;
    if ((min !== undefined && typeof min !== 'number') || (max !== undefined && typeof max !== 'number') || (typeof min === 'number' && typeof max === 'number' && min > max)) throw fixtureError('rowCount');
  }
  validateStringRecord(expect.types, 'types', validTypeUnion);
  validateStringRecord(expect.patterns, 'patterns', (value) => {
    try { new RegExp(value); return true; } catch { return false; }
  });
  if ('mustNotContain' in expect) {
    if (!isRecord(expect.mustNotContain) || !Object.values(expect.mustNotContain).every(stringArray)) throw fixtureError('mustNotContain');
  }
}

function validateStringRecord(value: unknown, name: string, valid: (value: string) => boolean): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw fixtureError(name);
  for (const [key, item] of Object.entries(value)) if (typeof item !== 'string' || !valid(item)) throw fixtureError(`${name}.${key}`);
}

function validTypeUnion(value: string): boolean {
  return value === 'any' || value.split('|').every(part => /^[A-Za-z][A-Za-z0-9_-]*$/u.test(part.trim()));
}

function fixtureError(field: string): ArgumentError {
  return new ArgumentError(`Fixture field ${field} is invalid.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function kindForPath(path: string): MemoryKind | undefined {
  if (path === 'notes.md') return 'notes';
  if (path === 'endpoints.json') return 'endpoints';
  if (path === 'field-map.json') return 'field-map';
  if (path.startsWith('verify/')) return 'verify';
  if (path.startsWith('fixtures/')) return 'fixture';
  return undefined;
}

async function writeSiteFile(root: string, path: string, body: string): Promise<void> {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, body);
}

function requiredHomeDir(options: LocalStoreOptions): string {
  const home = options.homeDir ?? process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error('Site memory requires a home directory.');
  return home;
}

function statusCode(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
