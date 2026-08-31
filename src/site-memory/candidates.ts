import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { collectEnvironment } from './environment.js';
import { openSitesRepository } from './git-store.js';
import { readProductFile, sitesRoot, writeProductFile, type LocalStoreOptions } from './local-store.js';
import { CANDIDATE_KINDS, type Candidate, type CandidateSummary } from './model.js';
import { canonicalProductKey } from './product-resolver.js';

const SECRET_KEY = /^(password|passwd|secret|token|cookie|cookies|authorization|api[_-]?key|set-cookie)$/i;
const SECRET_TEXT = /(password\s*[:=]|secret\s*[:=]|api[_-]?key|authorization\s*:|bearer\s+\S+|cookie\s*[:=])/i;
const KINDS = new Set<string>(CANDIDATE_KINDS);

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
    environment: input.environment ?? await collectEnvironment({
      browserVersion: input.browserVersion,
      webcmdVersion: input.webcmdVersion,
      fetch: input.fetch,
    }),
    status: 'pending',
    evidenceRole: null,
    memoryCommit: null,
    reviewedAt: null,
    rejectionReason: null,
  };
  const relative = candidatePath(id);
  await writeProductFile(product.key, relative, `${JSON.stringify(candidate, null, 2)}\n`, input);
  const repo = await openSitesRepository(input);
  await repo.commit([`${product.key}/${relative}`], `capture candidate ${id}`);
  return toSummary(candidate);
}

export async function searchCandidates(
  product: string,
  query: string,
  limit = 20,
  opts: LocalStoreOptions = {},
): Promise<CandidateSummary[]> {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const ranked = (await loadCandidates(product, opts))
    .filter((candidate) => candidate.status === 'pending')
    .map((candidate) => ({ candidate, score: fieldMatches(candidate, tokens) }))
    .filter((entry) => tokens.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.observedAt.localeCompare(b.candidate.observedAt) || a.candidate.id.localeCompare(b.candidate.id));
  return ranked.slice(0, limit).map((entry) => toSummary(entry.candidate));
}

export async function listCandidates(product: string, opts: LocalStoreOptions = {}): Promise<CandidateSummary[]> {
  return (await loadCandidates(product, opts)).map(toSummary);
}

export async function showCandidate(product: string, id: string, opts: LocalStoreOptions = {}): Promise<Candidate> {
  const key = canonicalProductKey(product).key;
  const body = await readProductFile(key, candidatePath(id), opts);
  if (body === null) throw new Error(`Candidate ${id} was not found.`);
  return JSON.parse(body) as Candidate;
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
    return body ? JSON.parse(body) as Candidate : null;
  }));
  return loaded.filter((candidate): candidate is Candidate => candidate !== null);
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

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}
