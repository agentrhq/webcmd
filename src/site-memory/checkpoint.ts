import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readCandidateRecord, updateCandidateRecord } from './candidates.js';
import { openSitesRepository } from './git-store.js';
import { containedRelativePath, copyDraftFiles, readProductFile, sitesRoot, type LocalStoreOptions } from './local-store.js';
import type {
  Candidate,
  CandidateDisposition,
  CheckpointReason,
  CheckpointResult,
  MemoryRevision,
} from './model.js';
import { canonicalProductKey } from './product-resolver.js';

export interface CheckpointInput extends LocalStoreOptions {
  product: string;
  taskId: string;
  expectedRevision: MemoryRevision | null;
  reason: CheckpointReason;
  paths: string[];
  dispositions?: CandidateDisposition[];
}

const REASONS = new Set<CheckpointReason>(['candidate_ingestion', 'direct_correction', 'major_rewrite']);
const VERIFIED = /\[verified (\d{4}-\d{2}-\d{2})\]/;
const POINTER = /\]\(references\/[^)]+\)/;

export async function checkpointMemory(input: CheckpointInput): Promise<CheckpointResult> {
  if (!REASONS.has(input.reason)) throw new Error(`Invalid checkpoint reason: ${input.reason}`);
  const paths = input.paths.map(assertMarkdownPath);
  const product = canonicalProductKey(input.product).key;
  const taskId = memorySegment(input.taskId);
  const dispositions = input.dispositions ?? [];
  const repo = await openSitesRepository(input);

  return repo.withRepositoryLock(async () => {
    const actual = await repo.revision();
    const loaded = await Promise.all(dispositions.map((row) => readCandidateRecord(product, row.id, input)));

    if (actual && input.expectedRevision === actual && isIncompleteProvenance(loaded, dispositions, actual)) {
      await writeDispositions(product, loaded, dispositions, actual, input);
      const provenanceCommit = await repo.commit(
        dispositions.map((row) => `${product}/candidates/${row.id}.json`),
        `checkpoint provenance ${product}`,
      );
      return { status: 'committed', memoryCommit: actual, provenanceCommit };
    }

    if (actual !== input.expectedRevision) {
      return { status: 'conflict', expectedRevision: input.expectedRevision, actualRevision: actual };
    }

    if (await isLegacy(product, input)) {
      throw new Error('Incompatible beta schema; learning is read-only until this SITE.md is cleared.');
    }

    const drafts = await readDrafts(input, taskId, product, paths);
    for (const body of drafts.values()) validateFacts(body);
    validateLineBounds(await readProductFile(product, 'sitemap/SITE.md', input), drafts.get('sitemap/SITE.md'), input.reason);
    validateDispositions(loaded, dispositions);

    const changed: string[] = [];
    for (const path of paths) {
      if (drafts.get(path) !== await readProductFile(product, path, input)) changed.push(path);
    }
    let memoryCommit = actual;
    if (changed.length > 0) {
      await copyDraftFiles(product, taskId, paths, input);
      memoryCommit = await repo.commit(paths.map((path) => `${product}/${path}`), `checkpoint memory ${product}`);
    }
    if (!memoryCommit) throw new Error('Refusing to checkpoint without a memory revision.');

    if (dispositions.length === 0) return { status: 'committed', memoryCommit, provenanceCommit: null };

    await writeDispositions(product, loaded, dispositions, memoryCommit, input);
    const provenanceCommit = await repo.commit(
      dispositions.map((row) => `${product}/candidates/${row.id}.json`),
      `checkpoint provenance ${product}`,
    );
    return { status: 'committed', memoryCommit, provenanceCommit };
  });
}

function isIncompleteProvenance(
  loaded: Candidate[],
  dispositions: CandidateDisposition[],
  actual: MemoryRevision,
): boolean {
  if (dispositions.length === 0) return false;
  return dispositions.every((row, index) => {
    const candidate = loaded[index];
    if (candidate.status !== row.status) return false;
    if (row.status === 'ingested') return candidate.memoryCommit === actual;
    return candidate.reviewedAt !== null && candidate.rejectionReason !== null;
  });
}

async function writeDispositions(
  product: string,
  loaded: Candidate[],
  dispositions: CandidateDisposition[],
  memoryCommit: MemoryRevision,
  opts: LocalStoreOptions,
): Promise<void> {
  const reviewedAt = new Date().toISOString();
  for (const [index, row] of dispositions.entries()) {
    const current = loaded[index];
    const next: Candidate = row.status === 'ingested'
      ? {
        ...current,
        status: 'ingested',
        evidenceRole: row.evidenceRole === 'supporting' || row.evidenceRole === 'dissenting' ? row.evidenceRole : current.evidenceRole,
        memoryCommit,
        reviewedAt: current.reviewedAt ?? reviewedAt,
        rejectionReason: null,
      }
      : {
        ...current,
        status: 'rejected',
        evidenceRole: null,
        memoryCommit: null,
        reviewedAt: current.reviewedAt ?? reviewedAt,
        rejectionReason: row.rejectionReason ?? current.rejectionReason,
      };
    await updateCandidateRecord(product, next, opts);
  }
}

function validateDispositions(loaded: Candidate[], dispositions: CandidateDisposition[]): void {
  for (const [index, row] of dispositions.entries()) {
    if (loaded[index].status !== 'pending') throw new Error('Invalid candidate status transition.');
    if (row.status === 'ingested') {
      if (row.evidenceRole !== 'supporting' && row.evidenceRole !== 'dissenting') {
        throw new Error('Invalid candidate evidence_role.');
      }
      if (row.rejectionReason) throw new Error('Invalid candidate status.');
    } else if (row.status === 'rejected') {
      if (!row.rejectionReason?.trim()) throw new Error('Rejected candidates require a reason.');
      if (row.evidenceRole) throw new Error('Invalid candidate status.');
    } else {
      throw new Error('Invalid candidate status.');
    }
  }
  const ingested = dispositions.map((row, index) => ({ row, candidate: loaded[index] })).filter((entry) => entry.row.status === 'ingested');
  if (ingested.length === 0) return;
  const dates = [...new Set(ingested.map((entry) => entry.candidate.observedDateUtc))];
  const conflicting = ingested.filter((entry) => entry.row.conflictsWithMemory);
  if (conflicting.length > 0) {
    const first = conflicting.map((entry) => entry.candidate.observedDateUtc).sort()[0];
    if (!dates.some((date) => date > first)) {
      throw new Error('Conflicting high-consequence evidence requires a later UTC date.');
    }
    return;
  }
  if (ingested.every((entry) => entry.candidate.kind === 'high_consequence')) return;
  if (dates.length < 2) throw new Error('Ingestion requires evidence on two distinct UTC dates.');
}

function validateLineBounds(current: string | null, draft: string | undefined, reason: CheckpointReason): void {
  if (draft === undefined || (current ?? '') === draft) return;
  const currentLines = physicalLines(current ?? '');
  const draftLines = physicalLines(draft);
  const draftPointers = POINTER.test(draft);
  if (currentLines > 500 || reason === 'major_rewrite') {
    if (draftLines > 200) throw new Error('SITE.md updates over 500 lines require a rewrite to at most 200 lines.');
    if (!draftPointers) throw new Error('A major rewrite requires contextual reference pointers.');
    return;
  }
  // ponytail: pointer-bearing SITE.md is treated as post-rewrite and capped at 200; persist a rewrite flag if organic 201-500 growth with pointers is required
  if (currentLines <= 200 && POINTER.test(current ?? '')) {
    if (draftLines > 200) throw new Error('Post-rewrite SITE.md updates must stay at or below 200 lines.');
    if (!draftPointers) throw new Error('Post-rewrite updates require contextual reference pointers.');
    return;
  }
  if (draftLines > 500) throw new Error('SITE.md updates over 500 lines require a rewrite to at most 200 lines.');
}

function validateFacts(body: string): void {
  for (const line of body.split('\n')) {
    const text = line.trim();
    if (!text || /^#{1,6}\s/.test(text) || (POINTER.test(text) && !VERIFIED.test(text))) continue;
    const match = VERIFIED.exec(text);
    if (!match || !validUtcDate(match[1])) {
      throw new Error('Each durable fact requires a valid [verified YYYY-MM-DD] date.');
    }
  }
}

function validUtcDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function physicalLines(text: string): number {
  if (text === '') return 0;
  return text.endsWith('\n') ? text.slice(0, -1).split('\n').length : text.split('\n').length;
}

function assertMarkdownPath(path: string): string {
  const normalized = path.split('\\').join('/');
  if (normalized.split('/').some((part) => part === '.' || part === '..' || part === '')) {
    throw new Error(`Invalid site memory path: ${path}`);
  }
  if (normalized === 'sitemap/SITE.md') return normalized;
  if (/^sitemap\/references\/[^./][^/]*\.md$/.test(normalized)) return normalized;
  throw new Error(`Invalid site memory Markdown path: ${path}`);
}

async function isLegacy(product: string, opts: LocalStoreOptions): Promise<boolean> {
  if (!await readProductFile(product, 'sitemap/SITE.md', opts)) return false;
  const raw = await readProductFile(product, 'manifest.json', opts);
  if (!raw) return true;
  try {
    const value = JSON.parse(raw) as { schemaVersion?: unknown };
    return value.schemaVersion !== 1;
  } catch {
    return true;
  }
}

async function readDrafts(
  input: LocalStoreOptions,
  taskId: string,
  product: string,
  paths: string[],
): Promise<Map<string, string>> {
  const root = join(sitesRoot(input), '.drafts', taskId, product);
  const drafts = new Map<string, string>();
  for (const path of paths) {
    const relative = containedRelativePath(root, path);
    drafts.set(path, await readFile(join(root, ...relative.split('/')), 'utf8'));
  }
  return drafts;
}

function memorySegment(value: string): string {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..' || value.startsWith('.')) {
    throw new Error(`Invalid site memory path: ${value}`);
  }
  return value;
}
