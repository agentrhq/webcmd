import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readCandidateRecord, recoverInterruptedProvenance, updateCandidateRecord } from './candidates.js';
import { parseDraftContextMetadata, parseProductManifest } from './context.js';
import { openSitesRepository } from './git-store.js';
import { containedRelativePath, copyDraftFiles, deleteProductFile, readProductFile, sitesRoot, writeProductFile, type LocalStoreOptions } from './local-store.js';
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
  const paths = unique(input.paths.map(assertMarkdownPath), 'Duplicate site memory Markdown path.');
  const product = canonicalProductKey(input.product).key;
  const taskId = memorySegment(input.taskId);
  const dispositions = uniqueBy(input.dispositions ?? [], (row) => row.id, 'Duplicate candidate id.');
  const repo = await openSitesRepository(input);

  return repo.withRepositoryLock(async () => {
    const actual = await repo.revision();
    const manifestRaw = await readProductFile(product, 'manifest.json', input);
    const manifest = parseProductManifest(manifestRaw);
    if (!manifest || manifest.product.key !== product) {
      throw new Error('Incompatible beta schema; learning is read-only until this SITE.md is cleared.');
    }
    const loaded = await Promise.all(dispositions.map((row) => readCandidateRecord(product, row.id, input)));
    for (const row of dispositions) validateDispositionFields(row);
    const candidatePaths = dispositions.map((row) => `${product}/candidates/${row.id}.json`);
    await assertWritableDraft(input, taskId, product);
    const drafts = await readDrafts(input, taskId, product, paths);
    const prior = new Map<string, string | null>();
    const changed: string[] = [];
    for (const path of paths) {
      const current = await readProductFile(product, path, input);
      prior.set(path, current);
      if (drafts.get(path) !== current) changed.push(path);
    }

    if (actual && input.expectedRevision === actual && await isProvenanceRecovery(loaded, dispositions, repo)) {
      if (changed.length > 0) {
        throw new Error('Finish provenance recovery with an unchanged draft first.');
      }
      if (await repo.pathsChanged(candidatePaths)) {
        const memoryCommit = loaded.find((row) => row.status === 'ingested')?.memoryCommit ?? actual;
        await writeDispositions(product, loaded, dispositions, memoryCommit, input);
        const provenanceCommit = await repo.commit(candidatePaths, `checkpoint provenance ${product}`);
        return { status: 'committed', memoryCommit, provenanceCommit };
      }
    }

    if (actual !== input.expectedRevision) {
      return { status: 'conflict', expectedRevision: input.expectedRevision, actualRevision: actual };
    }

    await recoverInterruptedProvenance(product, repo, input);

    for (const body of drafts.values()) validateFacts(body);
    const currentSite = await readProductFile(product, 'sitemap/SITE.md', input);
    const siteDraft = drafts.get('sitemap/SITE.md');
    validateLineBounds(
      currentSite,
      siteDraft,
      input.reason,
      changed.length > 0,
      manifest.postRewrite === true,
    );
    if (input.reason === 'candidate_ingestion') {
      if (dispositions.length === 0) throw new Error('candidate_ingestion requires dispositions.');
    } else if (dispositions.length > 0) {
      throw new Error('Checkpoint reason rejects dispositions.');
    }
    validateDispositions(loaded, dispositions);
    if (input.reason === 'candidate_ingestion') {
      const ingested = dispositions.some((row) => row.status === 'ingested');
      if (ingested && changed.length === 0) throw new Error('candidate_ingestion requires a memory change.');
      if (!ingested && changed.length > 0) throw new Error('candidate_ingestion rejections require unchanged memory.');
    }
    let memoryCommit = actual;
    if (changed.length > 0) {
      try {
        await copyDraftFiles(product, taskId, paths, input);
        const commitPaths = paths.map((path) => `${product}/${path}`);
        if (marksPostRewrite(input.reason, currentSite, siteDraft, changed) && manifest.postRewrite !== true) {
          prior.set('manifest.json', manifestRaw);
          await writeProductFile(product, 'manifest.json', `${JSON.stringify({ ...manifest, postRewrite: true }, null, 2)}\n`, input);
          commitPaths.push(`${product}/manifest.json`);
        }
        memoryCommit = await repo.commit(commitPaths, `checkpoint memory ${product}`);
      } catch (err) {
        const rollback = await restoreCopiedMarkdown(product, prior, input);
        if (rollback.length > 0) {
          throw new AggregateError([err, ...rollback], 'Memory commit failed and rollback also failed');
        }
        throw err;
      }
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

async function isProvenanceRecovery(
  loaded: Candidate[],
  dispositions: CandidateDisposition[],
  repo: Awaited<ReturnType<typeof openSitesRepository>>,
): Promise<boolean> {
  if (dispositions.length === 0) return false;
  let seenTerminal = false;
  for (const [index, row] of dispositions.entries()) {
    const candidate = loaded[index];
    if (candidate.status === 'pending') continue;
    if (!await matchesRequestedTerminal(candidate, row, repo)) throw new Error('Invalid candidate status transition.');
    seenTerminal = true;
  }
  return seenTerminal;
}

async function matchesRequestedTerminal(
  candidate: Candidate,
  row: CandidateDisposition,
  repo: Awaited<ReturnType<typeof openSitesRepository>>,
): Promise<boolean> {
  if (row.status === 'ingested') {
    return candidate.status === 'ingested'
      && candidate.memoryCommit !== null
      && await repo.isAncestor(candidate.memoryCommit)
      && candidate.evidenceRole === row.evidenceRole
      && candidate.rejectionReason === null;
  }
  if (row.status === 'rejected') {
    return candidate.status === 'rejected'
      && candidate.memoryCommit === null
      && candidate.evidenceRole === null
      && candidate.reviewedAt !== null
      && candidate.rejectionReason !== null
      && (!row.rejectionReason || candidate.rejectionReason === row.rejectionReason);
  }
  return false;
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
    if (current.status !== 'pending') continue;
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

function validateDispositionFields(row: CandidateDisposition): void {
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

function validateDispositions(loaded: Candidate[], dispositions: CandidateDisposition[]): void {
  for (const candidate of loaded) {
    if (candidate.status !== 'pending') throw new Error('Invalid candidate status transition.');
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

function validateLineBounds(
  current: string | null,
  draft: string | undefined,
  reason: CheckpointReason,
  memoryChanged: boolean,
  postRewrite: boolean,
): void {
  const currentLines = physicalLines(current ?? '');
  const unchangedSite = draft !== undefined && (current ?? '') === draft;
  if (currentLines > 500 && memoryChanged) {
    if (draft === undefined || physicalLines(draft) > 200) {
      throw new Error('SITE.md updates over 500 lines require a rewrite to at most 200 lines.');
    }
    if (!POINTER.test(draft)) throw new Error('A major rewrite requires contextual reference pointers.');
  }
  if (draft === undefined || unchangedSite) return;
  const draftLines = physicalLines(draft);
  const draftPointers = POINTER.test(draft);
  if (currentLines > 500 || reason === 'major_rewrite') {
    if (draftLines > 200) throw new Error('SITE.md updates over 500 lines require a rewrite to at most 200 lines.');
    if (!draftPointers) throw new Error('A major rewrite requires contextual reference pointers.');
    return;
  }
  if (postRewrite) {
    if (draftLines > 200) throw new Error('Post-rewrite SITE.md updates must stay at or below 200 lines.');
    if (!draftPointers) throw new Error('Post-rewrite updates require contextual reference pointers.');
    return;
  }
  if (draftLines > 500) throw new Error('SITE.md updates over 500 lines require a rewrite to at most 200 lines.');
}

function marksPostRewrite(
  reason: CheckpointReason,
  current: string | null,
  draft: string | undefined,
  changed: string[],
): boolean {
  if (draft === undefined || !changed.includes('sitemap/SITE.md') || (current ?? '') === draft) return false;
  return reason === 'major_rewrite' || physicalLines(current ?? '') > 500;
}

function validateFacts(body: string): void {
  let fence: string | null = null;
  let frontmatter: boolean | null = null;
  const lines = body.split('\n');
  for (const [index, line] of lines.entries()) {
    const text = line.trim();
    if (index === 0 && text === '---') {
      frontmatter = true;
      continue;
    }
    if (frontmatter) {
      if (text === '---') frontmatter = false;
      continue;
    }
    const marker = /^(`{3,}|~{3,})/.exec(text);
    if (marker) {
      const kind = marker[1][0];
      if (fence === null) fence = kind;
      else if (fence === kind) fence = null;
      continue;
    }
    if (fence || isStructuralMarkdown(line, text, lines[index + 1] ?? '')) continue;
    const match = VERIFIED.exec(text);
    if (!match || !validUtcDate(match[1])) {
      throw new Error('Each durable fact requires a valid [verified YYYY-MM-DD] date.');
    }
  }
  if (frontmatter || fence) throw new Error('Unclosed frontmatter or fenced code block.');
}

function isStructuralMarkdown(line: string, text: string, next: string): boolean {
  if (!text) return true;
  if (/^#{1,6}\s/.test(text)) return true;
  if (POINTER.test(text) && !VERIFIED.test(text)) return true;
  if (isTableSeparator(text)) return true;
  if (text.startsWith('|') && isTableSeparator(next.trim())) return true;
  if (/^[-*_]{3,}$/.test(text) || /^=+$/.test(text)) return true;
  if (/^\s/.test(line) && !/^([-*+]\s|\d+[.)]\s|>|\|)/.test(line.trimStart())) return true;
  if (/^\[.+\]:\s*\S/.test(text) || /^<!--/.test(text)) return true;
  return false;
}

function isTableSeparator(text: string): boolean {
  return /^\|?[\s:|-]+\|$/.test(text) && text.includes('---');
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

async function restoreCopiedMarkdown(
  product: string,
  prior: Map<string, string | null>,
  opts: LocalStoreOptions,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const [path, body] of prior) {
    try {
      if (body === null) await deleteProductFile(product, path, opts);
      else await writeProductFile(product, path, body, opts);
    } catch (err) {
      errors.push(err);
    }
  }
  return errors;
}

function unique<T>(values: T[], message: string): T[] {
  if (new Set(values).size !== values.length) throw new Error(message);
  return values;
}

function uniqueBy<T>(values: T[], key: (value: T) => string, message: string): T[] {
  unique(values.map(key), message);
  return values;
}

async function assertWritableDraft(input: LocalStoreOptions, taskId: string, product: string): Promise<void> {
  const path = join(sitesRoot(input), '.drafts', taskId, product, 'context.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error('Missing draft context metadata.');
    }
    throw err;
  }
  if (parseDraftContextMetadata(raw).readOnly) {
    throw new Error('Provisional parent fallback is read-only until classified.');
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
