import { randomUUID } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { collectEnvironment } from './environment.js';
import { openSitesRepository } from './git-store.js';
import { containedRelativePath, readProductFile, sitesRoot, writeProductFile, type LocalStoreOptions } from './local-store.js';
import {
  CANDIDATE_KINDS,
  type Candidate,
  type CandidateEnvironment,
  type CandidateStatus,
  type CandidateSummary,
} from './model.js';
import { canonicalProductKey } from './product-resolver.js';

export const SEARCH_CANDIDATE_LIMIT = 20;

const SECRET_KEY = /^(password|passwd|secret|token|cookie|cookies|authorization|api[_-]?key|set-cookie)$/i;
const SECRET_TEXT = /(password\s*[:=]|secret\s*[:=]|api[_-]?key|authorization\s*:|bearer\s+\S+|cookie\s*[:=])/i;
const KINDS = new Set<string>(CANDIDATE_KINDS);
const STATUSES = new Set<CandidateStatus>(['pending', 'ingested', 'rejected']);
const CANDIDATE_FIELDS = new Set([
  'schema_version', 'id', 'domain', 'hostname', 'observed_at', 'observed_date_utc',
  'kind', 'claim', 'evidence', 'consequence', 'environment', 'status',
  'evidence_role', 'memory_commit', 'reviewed_at', 'rejection_reason',
]);
const ENV_FIELDS = new Set(['machine', 'local_ip', 'public_ip', 'os', 'browser_version', 'webcmd_version']);
const CALLER_ENV_FIELDS = new Set(['machine', 'localIp', 'publicIp', 'os', 'browserVersion', 'webcmdVersion']);

export interface AddCandidateInput extends LocalStoreOptions {
  product: string;
  hostname?: string;
  kind: string;
  claim: string;
  evidence: string;
  consequence: string;
  observedAt?: string;
  environment?: Candidate['environment'];
  browserVersion?: string;
  webcmdVersion?: string;
  fetch?: typeof fetch;
}

export async function addCandidate(input: AddCandidateInput): Promise<CandidateSummary> {
  rejectSecrets(input);
  if (!KINDS.has(input.kind)) throw new Error(`Invalid candidate kind: ${input.kind}`);
  const product = canonicalProductKey(input.product);
  const host = canonicalProductKey(input.hostname ?? input.product);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.getTime())) throw new Error(`Invalid observedAt: ${observedAt}`);
  const environment = input.environment === undefined
    ? await collectEnvironment({
      browserVersion: input.browserVersion,
      webcmdVersion: input.webcmdVersion,
      fetch: input.fetch,
    })
    : decodeCallerEnvironment(input.environment);
  const id = `${compactUtc(observed)}-${randomUUID()}`;
  const candidate: Candidate = {
    schemaVersion: 1,
    id,
    domain: host.registrableDomain,
    hostname: host.hostname,
    observedAt,
    observedDateUtc: observed.toISOString().slice(0, 10),
    kind: input.kind,
    claim: requiredText(input.claim, 'claim'),
    evidence: requiredText(input.evidence, 'evidence'),
    consequence: requiredText(input.consequence, 'consequence'),
    environment,
    status: 'pending',
    evidenceRole: null,
    memoryCommit: null,
    reviewedAt: null,
    rejectionReason: null,
  };
  const relative = candidatePath(id);
  const repo = await openSitesRepository(input);
  await repo.withRepositoryLock(async () => {
    try {
      await writeProductFile(product.key, relative, `${JSON.stringify(encodeCandidate(candidate), null, 2)}\n`, input);
      await repo.commit([`${product.key}/${relative}`], `capture candidate ${id}`);
    } catch (err) {
      await unlinkProductFile(product.key, relative, input);
      throw err;
    }
  });
  return toSummary(candidate);
}

export async function searchCandidates(
  product: string,
  query: string,
  limit = SEARCH_CANDIDATE_LIMIT,
  opts: LocalStoreOptions = {},
): Promise<CandidateSummary[]> {
  const cap = boundedSearchLimit(limit);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const ranked = (await loadCandidates(product, opts))
    .filter((candidate) => candidate.status === 'pending')
    .map((candidate) => ({ candidate, score: fieldMatches(candidate, tokens) }))
    .filter((entry) => tokens.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.observedAt.localeCompare(b.candidate.observedAt) || a.candidate.id.localeCompare(b.candidate.id));
  return ranked.slice(0, cap).map((entry) => toSummary(entry.candidate));
}

export async function listCandidates(product: string, opts: LocalStoreOptions = {}): Promise<CandidateSummary[]> {
  return (await loadCandidates(product, opts)).map(toSummary);
}

export async function showCandidate(product: string, id: string, opts: LocalStoreOptions = {}): Promise<Candidate> {
  const key = canonicalProductKey(product).key;
  const body = await readProductFile(key, candidatePath(id), opts);
  if (body === null) throw new Error(`Candidate ${id} was not found.`);
  return parseCandidate(body, id);
}

function candidatePath(id: string): string {
  if (!id || id.includes('/') || id.includes('\\') || id === '.' || id === '..' || id.startsWith('.')) {
    throw new Error(`Invalid site memory path: ${id}`);
  }
  return `candidates/${id}.json`;
}

async function loadCandidates(product: string, opts: LocalStoreOptions): Promise<Candidate[]> {
  const key = canonicalProductKey(product).key;
  const dir = join(sitesRoot(opts), key, 'candidates');
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const loaded = await Promise.all(names.map(async (name) => {
    const body = await readProductFile(key, `candidates/${name}`, opts);
    return body ? parseCandidate(body, name.slice(0, -'.json'.length)) : null;
  }));
  return loaded.filter((candidate): candidate is Candidate => candidate !== null);
}

function encodeCandidate(candidate: Candidate): Record<string, unknown> {
  return {
    schema_version: candidate.schemaVersion,
    id: candidate.id,
    domain: candidate.domain,
    hostname: candidate.hostname,
    observed_at: candidate.observedAt,
    observed_date_utc: candidate.observedDateUtc,
    kind: candidate.kind,
    claim: candidate.claim,
    evidence: candidate.evidence,
    consequence: candidate.consequence,
    environment: encodeEnvironment(candidate.environment),
    status: candidate.status,
    evidence_role: candidate.evidenceRole,
    memory_commit: candidate.memoryCommit,
    reviewed_at: candidate.reviewedAt,
    rejection_reason: candidate.rejectionReason,
  };
}

function encodeEnvironment(env: CandidateEnvironment): Record<string, string> {
  const encoded: Record<string, string> = {};
  if (env.machine !== undefined) encoded.machine = env.machine;
  if (env.localIp !== undefined) encoded.local_ip = env.localIp;
  if (env.publicIp !== undefined) encoded.public_ip = env.publicIp;
  if (env.os !== undefined) encoded.os = env.os;
  if (env.browserVersion !== undefined) encoded.browser_version = env.browserVersion;
  if (env.webcmdVersion !== undefined) encoded.webcmd_version = env.webcmdVersion;
  return encoded;
}

function parseCandidate(body: string, expectedId: string): Candidate {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error('Invalid candidate JSON.');
  }
  return decodeCandidate(value, expectedId);
}

function decodeCandidate(value: unknown, expectedId: string): Candidate {
  const raw = knownObject(value, CANDIDATE_FIELDS, 'JSON');
  const id = requiredString(raw.id, 'id');
  if (id !== expectedId) throw new Error('Invalid candidate id mismatch.');
  const kind = requiredString(raw.kind, 'kind');
  if (!KINDS.has(kind)) throw new Error(`Invalid candidate kind: ${kind}`);
  const status = requiredString(raw.status, 'status');
  if (!STATUSES.has(status as CandidateStatus)) throw new Error(`Invalid candidate status: ${status}`);
  if (raw.schema_version !== 1) throw new Error('Invalid candidate schema_version.');
  const evidenceRole = raw.evidence_role === null || raw.evidence_role === 'supporting' || raw.evidence_role === 'dissenting'
    ? raw.evidence_role
    : null;
  if (raw.evidence_role !== evidenceRole) throw new Error('Invalid candidate evidence_role.');
  return {
    schemaVersion: 1,
    id,
    domain: requiredString(raw.domain, 'domain'),
    hostname: requiredString(raw.hostname, 'hostname'),
    observedAt: requiredString(raw.observed_at, 'observed_at'),
    observedDateUtc: requiredString(raw.observed_date_utc, 'observed_date_utc'),
    kind,
    claim: requiredText(requiredString(raw.claim, 'claim'), 'claim'),
    evidence: requiredText(requiredString(raw.evidence, 'evidence'), 'evidence'),
    consequence: requiredText(requiredString(raw.consequence, 'consequence'), 'consequence'),
    environment: decodeEnvironment(raw.environment),
    status: status as CandidateStatus,
    evidenceRole,
    memoryCommit: nullableString(raw.memory_commit, 'memory_commit'),
    reviewedAt: nullableString(raw.reviewed_at, 'reviewed_at'),
    rejectionReason: nullableString(raw.rejection_reason, 'rejection_reason'),
  };
}

function decodeEnvironment(value: unknown): CandidateEnvironment {
  const raw = knownObject(value, ENV_FIELDS, 'environment');
  return {
    ...optionalString(raw, 'machine', 'machine'),
    ...optionalString(raw, 'local_ip', 'localIp'),
    ...optionalString(raw, 'public_ip', 'publicIp'),
    ...optionalString(raw, 'os', 'os'),
    ...optionalString(raw, 'browser_version', 'browserVersion'),
    ...optionalString(raw, 'webcmd_version', 'webcmdVersion'),
  };
}

function decodeCallerEnvironment(value: unknown): CandidateEnvironment {
  const raw = knownObject(value, CALLER_ENV_FIELDS, 'environment');
  return {
    ...optionalString(raw, 'machine', 'machine'),
    ...optionalString(raw, 'localIp', 'localIp'),
    ...optionalString(raw, 'publicIp', 'publicIp'),
    ...optionalString(raw, 'os', 'os'),
    ...optionalString(raw, 'browserVersion', 'browserVersion'),
    ...optionalString(raw, 'webcmdVersion', 'webcmdVersion'),
  };
}

function knownObject(value: unknown, allowed: Set<string>, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid candidate ${label}.`);
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (SECRET_KEY.test(key)) throw new Error('Candidate evidence cannot include secret-bearing fields.');
    if (!allowed.has(key)) throw new Error(`Invalid candidate ${label}.`);
  }
  return obj;
}

function optionalString(obj: Record<string, unknown>, from: string, to: keyof CandidateEnvironment): CandidateEnvironment {
  if (obj[from] === undefined) return {};
  if (typeof obj[from] !== 'string' || !obj[from]) throw new Error('Invalid candidate environment.');
  return { [to]: obj[from] };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid candidate ${field}.`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value) throw new Error(`Invalid candidate ${field}.`);
  return value;
}

function boundedSearchLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid search limit: ${limit}`);
  return Math.min(limit, SEARCH_CANDIDATE_LIMIT);
}

function fieldMatches(candidate: Candidate, tokens: string[]): number {
  const fields = [candidate.claim, candidate.kind, candidate.hostname, candidate.consequence].map((value) => value.toLowerCase());
  let score = 0;
  for (const token of tokens) {
    for (const field of fields) {
      if (field.includes(token)) score += 1;
    }
  }
  return score;
}

function toSummary(candidate: Candidate): CandidateSummary {
  return {
    id: candidate.id,
    domain: candidate.domain,
    hostname: candidate.hostname,
    observedAt: candidate.observedAt,
    observedDateUtc: candidate.observedDateUtc,
    kind: candidate.kind,
    claim: candidate.claim,
    consequence: candidate.consequence,
    status: candidate.status,
  };
}

function rejectSecrets(input: object): void {
  for (const key of Object.keys(input)) {
    if (SECRET_KEY.test(key)) throw new Error('Candidate evidence cannot include secret-bearing fields.');
  }
}

function requiredText(value: string, field: string): string {
  if (!value.trim()) throw new Error(`Invalid candidate ${field}.`);
  if (SECRET_TEXT.test(value)) throw new Error('Candidate evidence cannot include secret-bearing fields.');
  return value;
}

function compactUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function unlinkProductFile(productKey: string, path: string, opts: LocalStoreOptions): Promise<void> {
  const productRoot = join(sitesRoot(opts), productKey);
  const relative = containedRelativePath(productRoot, path);
  try {
    await unlink(join(productRoot, ...relative.split('/')));
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}
