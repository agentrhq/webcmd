import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { validateFixture } from '../browser/verify-fixture.js';
import { withFileLock } from './file-lock.js';

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

export interface VerifyFixtureInput extends LocalStoreOptions {
  site: string;
  command: string;
  body: string;
}

export interface ResponseSampleInput extends VerifyFixtureInput {}

const writeChains = new Map<string, Promise<void>>();
const tempWritePattern = /^\..+\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;
const lockWritePattern = /\.lock$/;

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

export async function getVerifyFixture(site: string, command: string, opts: LocalStoreOptions = {}): Promise<string | null> {
  const path = `verify/${safeCommand(command)}.json`;
  try {
    return (await showSiteMemory(site, { ...opts, paths: [path] }))[0]?.body ?? null;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function putVerifyFixture(input: VerifyFixtureInput): Promise<void> {
  validateVerifyFixture(input.body);
  await writeSiteFile(input.site, `verify/${safeCommand(input.command)}.json`, input.body, input);
}

export async function addResponseSample(input: ResponseSampleInput): Promise<{ path: string }> {
  const path = `fixtures/${safeCommand(input.command)}-${Date.now()}-${randomUUID()}.json`;
  await writeSiteFile(input.site, path, input.body, input);
  return { path };
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
  return withWriteLock(target, async () => {
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
  return withWriteLock(target, async () => {
    const existing = objectValue(JSON.parse(await readText(target) || '{}')) ?? {};
    await atomicWrite(target, `${JSON.stringify(update(existing), null, 2)}\n`);
  });
}

export async function readProductFile(productKey: string, path: string, opts: LocalStoreOptions = {}): Promise<string | null> {
  const productRoot = join(sitesRoot(opts), productSegment(productKey));
  const relative = containedRelativePath(productRoot, path);
  if (!await exists(productRoot)) return null;
  try {
    const safe = await readableRelativePath(productRoot, relative);
    return await readFile(join(productRoot, safe), 'utf8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeProductFile(productKey: string, path: string, body: string, opts: LocalStoreOptions = {}): Promise<void> {
  const productRoot = join(sitesRoot(opts), productSegment(productKey));
  await mkdir(productRoot, { recursive: true });
  const relative = containedRelativePath(productRoot, path);
  const target = join(productRoot, ...relative.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await assertInsideSiteRoot(productRoot, dirname(target), path);
  await withWriteLock(target, () => atomicWrite(target, body));
}

export async function copyDraftFiles(productKey: string, taskId: string, paths: string[], opts: LocalStoreOptions = {}): Promise<void> {
  const draftRoot = join(sitesRoot(opts), '.drafts', productSegment(taskId), productSegment(productKey));
  for (const path of paths) {
    const relative = containedRelativePath(draftRoot, path);
    const safe = await readableRelativePath(draftRoot, relative);
    const body = await readFile(join(draftRoot, safe), 'utf8');
    await writeProductFile(productKey, relative, body, opts);
  }
}

export async function listProductKeys(opts: LocalStoreOptions = {}): Promise<string[]> {
  const root = sitesRoot(opts);
  if (!await exists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort();
}

export function sitesRoot(opts: LocalStoreOptions = {}): string {
  return join(requiredHomeDir(opts), '.webcmd', 'sites');
}

export function containedRelativePath(root: string, path: string): string {
  return safeRelativePath(root, path).split(sep).join('/');
}

async function writeSiteFile(site: string, path: string, body: string, opts: LocalStoreOptions): Promise<void> {
  const root = await ensureSiteRoot(site, opts);
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await assertInsideSiteRoot(root, dirname(target), path);
  await withPathLock(target, () => atomicWrite(target, body));
}

/**
 * Guard a read-modify-write. The in-process chain runs first because it is free
 * and settles same-process callers without touching the disk; the file lock then
 * covers the read as well as the write, which is what other processes need.
 */
function withWriteLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  return withPathLock(target, () => withFileLock(target, fn));
}

export async function withPathLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(target) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  const settled = next.then(() => undefined, () => undefined);
  writeChains.set(target, settled);
  settled.then(() => {
    if (writeChains.get(target) === settled) writeChains.delete(target);
  });
  return next;
}

export async function atomicWrite(target: string, body: string): Promise<void> {
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
  return join(sitesRoot(opts), site);
}

function productSegment(value: string): string {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..' || value.startsWith('.')) {
    throw new Error(`Invalid site memory path: ${value}`);
  }
  return value;
}

async function memoryPaths(root: string, requested?: string[]): Promise<string[]> {
  if (!await exists(root)) return [];
  const paths = (requested ?? await walkFiles(root)).filter((path) => !isInternalWritePath(path) && !isCandidateMemoryPath(path));
  return Promise.all(paths.map((path) => readableRelativePath(root, path))).then((items) => items.sort());
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'candidates' ? [] : walkFiles(root, path);
    if (entry.isFile() && !isInternalWritePath(entry.name)) return [relative(root, path)];
    return [];
  }));
  return nested.flat();
}

async function readableRelativePath(root: string, path: string): Promise<string> {
  const relativePath = safeRelativePath(root, path);
  if ((await lstat(join(root, relativePath))).isSymbolicLink()) throw new Error(`Invalid site memory path: ${path}`);
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(join(root, relativePath))]);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`)) throw new Error(`Invalid site memory path: ${path}`);
  return relativePath.split(sep).join('/');
}

function safeRelativePath(root: string, path: string): string {
  const target = resolve(root, path);
  const resolvedRoot = resolve(root);
  if (target !== resolvedRoot && target.startsWith(`${resolvedRoot}${sep}`)) return relative(resolvedRoot, target);
  throw new Error(`Invalid site memory path: ${path}`);
}

/** In-flight write bookkeeping — temp files and lock markers are not site memory. */
function isInternalWritePath(path: string): boolean {
  const name = basename(path);
  return tempWritePattern.test(name) || lockWritePattern.test(name);
}

function isCandidateMemoryPath(path: string): boolean {
  const normalized = path.split(sep).join('/');
  return normalized === 'candidates' || normalized.startsWith('candidates/');
}

function requiredHomeDir(opts: LocalStoreOptions): string {
  const home = opts.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  if (!home) throw new Error('Site memory requires homeDir, HOME, USERPROFILE, or os.homedir().');
  return home;
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

function safeCommand(command: string): string {
  if (!command || command.includes('/') || command.includes('\\') || command === '.' || command === '..') {
    throw new Error(`Invalid site memory command: ${command}`);
  }
  return command;
}

function validateVerifyFixture(body: string): void {
  let fixture: unknown;
  try {
    fixture = JSON.parse(body);
  } catch {
    throw new Error('Fixture must be valid JSON.');
  }
  validateFixture(fixture);
}

async function assertInsideSiteRoot(root: string, parent: string, path: string): Promise<void> {
  const [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
  if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${sep}`)) {
    throw new Error(`Invalid site memory path: ${path}`);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
