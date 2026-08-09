import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

type JsonObject = Record<string, unknown>;

export interface LocalStoreOptions {
  homeDir?: string;
  paths?: string[];
}

export interface NoteInput extends LocalStoreOptions {
  site: string;
  text: string;
  author?: string;
}

export interface EndpointInput extends LocalStoreOptions {
  site: string;
  name: string;
  url: string;
  method: string;
  params?: JsonObject;
  rowsPath?: string;
  sampleFields?: string[];
  notes?: string;
}

export interface FieldMappingInput extends LocalStoreOptions {
  site: string;
  key: string;
  meaning: string;
  source: string;
  force?: boolean;
}

export interface SiteMemoryBody {
  path: string;
  body: string;
}

export interface SiteMemoryListing {
  path: string;
  byteSize: number;
  updatedAt: string;
  sha256: string;
}

const writeChains = new Map<string, Promise<void>>();

export function appendNote(input: NoteInput): Promise<{ path: 'notes.md' }> {
  return updateText(input.site, 'notes.md', input, (existing) => {
    const date = new Date().toISOString().slice(0, 10);
    return `## ${date} by ${input.author ?? 'webcmd-agent'}\n${input.text}\n\n${existing}`;
  }).then(() => ({ path: 'notes.md' }));
}

export function setEndpoint(input: EndpointInput): Promise<void> {
  return updateJson(input.site, 'endpoints.json', input, (endpoints) => {
    const endpoint: JsonObject = {
      ...objectValue(endpoints[input.name]),
      url: input.url,
      method: input.method,
      verified_at: new Date().toISOString(),
    };
    if (input.params !== undefined) endpoint.params = input.params;
    if (input.rowsPath !== undefined) endpoint.rows_path = input.rowsPath;
    if (input.sampleFields !== undefined) endpoint.sample_fields = input.sampleFields;
    if (input.notes !== undefined) endpoint.notes = input.notes;
    endpoints[input.name] = endpoint;
    return endpoints;
  });
}

export function markEndpointStale(input: Pick<EndpointInput, 'site' | 'name' | 'homeDir'>): Promise<void> {
  return updateJson(input.site, 'endpoints.json', input, (endpoints) => {
    const endpoint = objectValue(endpoints[input.name]);
    if (!endpoint) throw statusError(404, `Endpoint ${input.name} was not found.`);
    endpoints[input.name] = { ...endpoint, stale: true };
    return endpoints;
  });
}

export function addFieldMapping(input: FieldMappingInput): Promise<void> {
  return updateJson(input.site, 'field-map.json', input, (mappings) => {
    if (mappings[input.key] !== undefined && !input.force) {
      throw statusError(409, `Field mapping ${input.key} already exists.`);
    }
    mappings[input.key] = { meaning: input.meaning, source: input.source };
    return mappings;
  });
}

export async function showSiteMemory(site: string, opts: LocalStoreOptions = {}): Promise<SiteMemoryBody[]> {
  const root = siteRoot(site, opts);
  const paths = await memoryPaths(root, opts.paths);
  return Promise.all(paths.map(async (path) => ({ path, body: await readFile(join(root, path), 'utf8') })));
}

export async function listSiteMemory(site: string, opts: LocalStoreOptions = {}): Promise<SiteMemoryListing[]> {
  const root = siteRoot(site, opts);
  const paths = await memoryPaths(root, opts.paths);
  return Promise.all(paths.map(async (path) => {
    const file = join(root, path);
    const [body, stats] = await Promise.all([readFile(file), stat(file)]);
    return {
      path,
      byteSize: body.byteLength,
      updatedAt: stats.mtime.toISOString(),
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  }));
}

async function updateText(
  site: string,
  path: 'notes.md',
  opts: LocalStoreOptions,
  update: (existing: string) => string,
): Promise<void> {
  const root = await ensureSiteRoot(site, opts);
  const target = join(root, path);
  return withPathLock(target, async () => {
    await atomicWrite(target, update(await readText(target)));
  });
}

async function updateJson(
  site: string,
  path: 'endpoints.json' | 'field-map.json',
  opts: LocalStoreOptions,
  update: (existing: JsonObject) => JsonObject,
): Promise<void> {
  const root = await ensureSiteRoot(site, opts);
  const target = join(root, path);
  return withPathLock(target, async () => {
    const existing = objectValue(JSON.parse(await readText(target) || '{}')) ?? {};
    await atomicWrite(target, `${JSON.stringify(update(existing), null, 2)}\n`);
  });
}

async function withPathLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(target) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  const settled = next.then(() => undefined, () => undefined);
  writeChains.set(target, settled);
  settled.then(() => {
    if (writeChains.get(target) === settled) writeChains.delete(target);
  });
  return next;
}

async function atomicWrite(target: string, body: string): Promise<void> {
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, body, 'utf8');
    await rename(temp, target);
  } catch (err) {
    await unlink(temp).catch(() => undefined);
    throw err;
  }
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return '';
    throw err;
  }
}

async function ensureSiteRoot(site: string, opts: LocalStoreOptions): Promise<string> {
  const root = siteRoot(site, opts);
  await mkdir(root, { recursive: true });
  await Promise.all([
    mkdir(join(root, 'verify'), { recursive: true }),
    mkdir(join(root, 'fixtures'), { recursive: true }),
  ]);
  return root;
}

function siteRoot(site: string, opts: LocalStoreOptions): string {
  if (!site || site.includes('/') || site.includes('\\') || site === '.' || site === '..') {
    throw new Error(`Invalid site memory site: ${site}`);
  }
  return join(opts.homeDir ?? process.env.HOME ?? '', '.webcmd', 'sites', site);
}

async function memoryPaths(root: string, requested?: string[]): Promise<string[]> {
  if (!await exists(root)) return [];
  const paths = requested ?? await walkFiles(root);
  return paths.map((path) => safeRelativePath(root, path)).sort();
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(root, path);
    if (entry.isFile()) return [relative(root, path)];
    return [];
  }));
  return nested.flat();
}

function safeRelativePath(root: string, path: string): string {
  const target = resolve(root, path);
  const resolvedRoot = resolve(root);
  if (target !== resolvedRoot && target.startsWith(`${resolvedRoot}${sep}`)) return relative(resolvedRoot, target);
  throw new Error(`Invalid site memory path: ${path}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return false;
    throw err;
  }
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function statusError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
