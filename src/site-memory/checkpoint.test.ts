import { execFile } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCandidate, showCandidate } from './candidates.js';
import { checkpointMemory, type CheckpointInput } from './checkpoint.js';
import { classifyProduct } from './classify.js';
import { getMemoryContext, parseProductManifest } from './context.js';
import { installGitShim, restoreGitShim } from './git-shim.js';
import { openSitesRepository } from './git-store.js';
import { readProductFile, writeProductFile } from './local-store.js';
import { GIT_TEST_TIMEOUT_MS, removeTempDirs } from './__fixtures__/git-test-support.js';

vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT_MS });

const run = promisify(execFile);
const tempHomes: string[] = [];
const FACT = '- [verified 2026-08-31] Prefer /new for fresh posts.\n';
const SITE = `# Example\n\n${FACT}`;
const POINTER = '- More: [references/listing.md](references/listing.md).\n';
const REF = `# Listing\n\n${FACT}`;

if (process.platform === 'win32') {
  vi.setConfig({ testTimeout: 30_000 });
}

afterEach(async () => {
  restoreGitShim();
  await removeTempDirs(tempHomes);
});

describe('checkpoint compare-and-swap', () => {
  it('returns a stale-revision conflict without copying the draft', async () => {
    const { homeDir, revision } = await primed();
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Stale\n\n${FACT}` });

    const result = await checkpoint(homeDir, { expectedRevision: '0'.repeat(40) });

    expect(result).toEqual({
      status: 'conflict',
      expectedRevision: '0'.repeat(40),
      actualRevision: revision,
    });
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(SITE);
  });

  it('accepts only contained Markdown sitemap paths', async () => {
    const { homeDir } = await primed();
    await writeDraft(homeDir, { 'sitemap/SITE.md': SITE });

    await expect(checkpoint(homeDir, { paths: ['manifest.json'] })).rejects.toThrow(/markdown|path/i);
    await expect(checkpoint(homeDir, { paths: ['candidates/x.json'] })).rejects.toThrow(/markdown|path/i);
    await expect(checkpoint(homeDir, { paths: ['sitemap/../manifest.json'] })).rejects.toThrow(/markdown|path|invalid/i);
    await expect(checkpoint(homeDir, { paths: ['notes.md'] })).rejects.toThrow(/markdown|path/i);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(SITE);
  });

  it('requires a valid [verified YYYY-MM-DD] marker on every fact', async () => {
    const { homeDir } = await primed();
    await writeDraft(homeDir, { 'sitemap/SITE.md': '# Example\n\n- Prefer /new for fresh posts.\n' });
    await expect(checkpoint(homeDir)).rejects.toThrow(/verified/i);

    await writeDraft(homeDir, { 'sitemap/SITE.md': '# Example\n\n- Prefer /new for fresh posts.\nOrdinary prose without a date.\n' });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/verified/i);

    await writeDraft(homeDir, { 'sitemap/SITE.md': '# Example\n\n- [verified 2026-13-40] Prefer /new.\n' });
    await expect(checkpoint(homeDir)).rejects.toThrow(/verified/i);
  });

  it('accepts fenced code, table header syntax, HTML, references, and list continuations without dates', async () => {
    const { homeDir } = await primed();
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example

- [verified 2026-08-31] Prefer /new.

\`\`\`bash
echo hello
not a fact
\`\`\`

| col | val |
| --- | --- |
| a | [verified 2026-08-31] b |

> [verified 2026-08-31] quoted fact

- [verified 2026-08-31] Nested:
  continuation line

[ref]: https://example.test
<!-- comment -->
` });

    const result = await checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] });
    expect(result.status).toBe('committed');
  });

  it('requires dates on nested bullets, numbered bullets, blockquotes, and table data rows', async () => {
    const { homeDir } = await primed();
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n- [verified 2026-08-31] Parent.\n  - Nested without date.\n` });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/verified/i);

    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n1. Numbered without date.\n` });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/verified/i);

    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n- [verified 2026-08-31] Parent.\n  1. Nested numbered without date.\n` });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/verified/i);

    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n> quoted structure\n` });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/verified/i);

    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n| col | val |\n| --- | --- |\n| a | b |\n` });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/verified/i);
  });

  it('rejects unclosed frontmatter and unclosed backtick or tilde fences', async () => {
    const { homeDir } = await primed();
    await writeDraft(homeDir, { 'sitemap/SITE.md': '---\ntitle: open\n# Example\n\n- Prefer /new.\n' });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/unclosed|frontmatter|fence/i);

    await writeDraft(homeDir, { 'sitemap/SITE.md': '# Example\n\n```\nnot a fact\n' });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/unclosed|fence/i);

    await writeDraft(homeDir, { 'sitemap/SITE.md': '# Example\n\n~~~\nnot a fact\n' });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/unclosed|fence/i);
  });

  it('accepts closed tilde fences without dates inside them', async () => {
    const { homeDir } = await primed();
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example

- [verified 2026-08-31] Prefer /new.

~~~
not a fact
~~~
` });
    const result = await checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] });
    expect(result.status).toBe('committed');
  });

  it('refuses a legacy beta SITE.md without copying the draft', async () => {
    const { homeDir, sites } = await tempSites();
    const product = join(sites, 'example.test', 'sitemap');
    await mkdir(product, { recursive: true });
    const legacy = '---\nsite: example\nkind: site\nid: example\nstatus: verified\nverified_at: 2026-01-01\nsource: beta\n---\n# Beta\n';
    await writeFile(join(product, 'SITE.md'), legacy);
    await git(sites, ['init']);
    await git(sites, ['add', 'example.test/sitemap/SITE.md']);
    await git(sites, ['-c', 'user.name=webcmd', '-c', 'user.email=webcmd@local', 'commit', '-m', 'legacy']);
    const revision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    await writeDraft(homeDir, { 'sitemap/SITE.md': SITE });

    await expect(checkpoint(homeDir, { expectedRevision: revision })).rejects.toThrow(/incompatible beta schema/i);
    expect(await readFile(join(product, 'SITE.md'), 'utf8')).toBe(legacy);
  });

  it.each([
    ['missing', null],
    ['malformed', '{'],
    ['non-v1', JSON.stringify({
      schemaVersion: 2,
      product: { key: 'example.test', hostname: 'example.test', displayHostname: 'example.test', registrableDomain: 'example.test' },
      interfaces: [],
      seed: { status: 'absent' },
    })],
    ['partial', JSON.stringify({
      schemaVersion: 1,
      product: { key: 'example.test', hostname: 'example.test', displayHostname: 'example.test', registrableDomain: 'example.test' },
      seed: { status: 'absent' },
    })],
    ['mismatched key', JSON.stringify({
      schemaVersion: 1,
      product: { key: 'other.test', hostname: 'other.test', displayHostname: 'other.test', registrableDomain: 'other.test' },
      interfaces: [],
      seed: { status: 'absent' },
    })],
  ] as const)('refuses a %s product manifest without copying the draft', async (_label, body) => {
    const { homeDir, sites, revision: initial } = await primed();
    const manifest = join(sites, 'example.test', 'manifest.json');
    if (body === null) await rm(manifest);
    else await writeFile(manifest, `${body}\n`);
    await git(sites, ['add', '-A', 'example.test/manifest.json']);
    await git(sites, ['-c', 'user.name=webcmd', '-c', 'user.email=webcmd@local', 'commit', '-m', 'bad-manifest']);
    const revision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    expect(revision).not.toBe(initial);
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Next\n\n${FACT}` });

    await expect(checkpoint(homeDir, { expectedRevision: revision, reason: 'direct_correction' })).rejects.toThrow(/incompatible beta schema|manifest|schema/i);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(SITE);
  });

  it('refuses checkpoint writes from a provisional parent fallback draft', async () => {
    const { homeDir, revision } = await primed();
    const context = await getMemoryContext({
      url: 'https://www.example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: { lookup: async () => ({ status: 'absent' as const }) },
    });
    expect(context.readOnly).toBe(true);
    expect(context.resolution.status).toBe('provisional-fallback');
    const next = `# Example\n\n${FACT}- [verified 2026-09-01] Extra.\n`;
    await writeFile(join(context.draftPath, 'SITE.md'), next);

    await expect(checkpoint(homeDir, {
      expectedRevision: context.revision ?? revision,
      reason: 'direct_correction',
      dispositions: [],
    })).rejects.toThrow(/read-only|provisional|classify|metadata/i);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(SITE);
  });

  it('refuses checkpoint writes when draft context metadata is malformed', async () => {
    const { homeDir, revision } = await primed();
    const next = `# Example\n\n${FACT}- [verified 2026-09-01] Extra.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    await writeFile(
      join(homeDir, '.webcmd/sites/.drafts/task-1/example.test/context.json'),
      '{"readOnly":"true"}\n',
    );

    await expect(checkpoint(homeDir, {
      expectedRevision: revision,
      reason: 'direct_correction',
      dispositions: [],
    })).rejects.toThrow(/invalid draft context/i);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(SITE);
  });

  it('refuses checkpoint when draft context metadata is absent', async () => {
    const { homeDir, revision } = await primed();
    const next = `# Example\n\n${FACT}- [verified 2026-09-01] Extra.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    await rm(join(homeDir, '.webcmd/sites/.drafts/task-1/example.test/context.json'), { force: true });

    await expect(checkpoint(homeDir, {
      expectedRevision: revision,
      reason: 'direct_correction',
      dispositions: [],
    })).rejects.toThrow(/draft context|metadata/i);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(SITE);
  });

  it('allows checkpoint after fallback classify and fresh context in the same task', async () => {
    const { homeDir, revision } = await primed();
    const fallback = await getMemoryContext({
      url: 'https://www.example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: { lookup: async () => ({ status: 'absent' as const }) },
    });
    const classified = await classifyProduct({
      requested: 'https://www.example.test/',
      decision: 'same-product',
      parent: 'example.test',
      expectedRevision: fallback.revision ?? revision,
      homeDir,
    });
    expect(classified.status).toBe('classified');

    const again = await getMemoryContext({
      url: 'https://www.example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: { lookup: async () => ({ status: 'absent' as const }) },
    });
    expect(again.resolution.status).toBe('confirmed-interface');
    expect(again.readOnly).toBe(false);
    expect(again.draftPath).toBe(join(homeDir, '.webcmd/sites/.drafts/task-1/example.test/sitemap'));
    const next = `# Example\n\n${FACT}- [verified 2026-09-01] Extra.\n`;
    await writeFile(join(again.draftPath, 'SITE.md'), next);
    const result = await checkpoint(homeDir, {
      expectedRevision: again.revision ?? revision,
      reason: 'direct_correction',
      dispositions: [],
    });
    expect(result.status).toBe('committed');
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(next);
  });

  it('keeps an exact draft publishable after visiting a provisional sibling host', async () => {
    const { homeDir, revision } = await primed();
    const exact = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: { lookup: async () => ({ status: 'absent' as const }) },
    });
    expect(exact.readOnly).toBe(false);
    const next = `# Example\n\n${FACT}- [verified 2026-09-01] Extra.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });

    const sibling = await getMemoryContext({
      url: 'https://www.example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: { lookup: async () => ({ status: 'absent' as const }) },
    });
    expect(sibling.readOnly).toBe(true);
    expect(sibling.resolution.status).toBe('provisional-fallback');

    const result = await checkpoint(homeDir, {
      expectedRevision: exact.revision ?? revision,
      reason: 'direct_correction',
      dispositions: [],
    });
    expect(result.status).toBe('committed');
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(next);
  });

  it('does not publish edits written through a provisional sibling draftPath', async () => {
    const { homeDir, revision } = await primed();
    const exact = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: { lookup: async () => ({ status: 'absent' as const }) },
    });
    expect(exact.readOnly).toBe(false);
    const exactNext = `# Example\n\n${FACT}- [verified 2026-09-01] Extra.\n`;
    await writeFile(join(exact.draftPath, 'SITE.md'), exactNext);

    const sibling = await getMemoryContext({
      url: 'https://www.example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: { lookup: async () => ({ status: 'absent' as const }) },
    });
    expect(sibling.readOnly).toBe(true);
    expect(sibling.resolution.status).toBe('provisional-fallback');
    const hijack = `# Example\n\n${FACT}- [verified 2026-09-01] Sibling hijack.\n`;
    await writeFile(join(sibling.draftPath, 'SITE.md'), hijack);

    const result = await checkpoint(homeDir, {
      expectedRevision: exact.revision ?? revision,
      reason: 'direct_correction',
      dispositions: [],
    });
    expect(result.status).toBe('committed');
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(exactNext);
  });
});

describe('checkpoint candidate dispositions', () => {
  it('ingests pending candidates and rejects illegal transitions', async () => {
    const { homeDir } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later path' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });

    const result = await checkpoint(homeDir, {
      dispositions: [
        { id: first.id, status: 'ingested', evidenceRole: 'supporting' },
        { id: second.id, status: 'ingested', evidenceRole: 'supporting' },
      ],
    });
    expect(result.status).toBe('committed');
    expect((await showCandidate('example.test', first.id, { homeDir })).status).toBe('ingested');

    await writeDraft(homeDir, { 'sitemap/SITE.md': `${next}- [verified 2026-08-31] Extra.\n` }, 'task-2');
    await expect(checkpoint(homeDir, {
      taskId: 'task-2',
      dispositions: [{ id: first.id, status: 'rejected', rejectionReason: 'stale' }],
    })).rejects.toThrow(/pending|transition|status/i);
  });

  it('requires two distinct UTC dates and rejects same-date evidence', async () => {
    const { homeDir } = await primed();
    const a = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T01:00:00Z' }));
    const b = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T23:00:00Z', claim: 'Same day' }));
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n${FACT}- [verified 2026-08-31] Same day is not enough.\n` });

    await expect(checkpoint(homeDir, {
      dispositions: [
        { id: a.id, status: 'ingested', evidenceRole: 'supporting' },
        { id: b.id, status: 'ingested', evidenceRole: 'supporting' },
      ],
    })).rejects.toThrow(/date/i);
    expect((await showCandidate('example.test', a.id, { homeDir })).status).toBe('pending');
  });

  it('ingests a non-conflicting high-consequence candidate immediately', async () => {
    const { homeDir } = await primed();
    const warning = await addCandidate(candidate(homeDir, {
      kind: 'high_consequence',
      claim: 'Ban risk on bulk delete',
      observedAt: '2026-08-31T12:00:00Z',
    }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Bulk delete can ban the account.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });

    const result = await checkpoint(homeDir, {
      dispositions: [{ id: warning.id, status: 'ingested', evidenceRole: 'supporting' }],
    });

    expect(result.status).toBe('committed');
    expect((await showCandidate('example.test', warning.id, { homeDir })).status).toBe('ingested');
  });

  it('delays a conflicting high-consequence candidate until a later UTC date', async () => {
    const { homeDir } = await primed();
    const first = await addCandidate(candidate(homeDir, {
      kind: 'high_consequence',
      claim: 'Ban risk on bulk delete',
      observedAt: '2026-08-30T12:00:00Z',
    }));
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n${FACT}- [verified 2026-08-31] Overturn the safe-delete claim.\n` });

    await expect(checkpoint(homeDir, {
      dispositions: [{ id: first.id, status: 'ingested', evidenceRole: 'supporting', conflictsWithMemory: true }],
    })).rejects.toThrow(/date|conflict/i);
    expect((await showCandidate('example.test', first.id, { homeDir })).status).toBe('pending');

    const later = await addCandidate(candidate(homeDir, {
      kind: 'high_consequence',
      claim: 'Ban risk confirmed later',
      observedAt: '2026-08-31T12:00:00Z',
    }));
    const result = await checkpoint(homeDir, {
      dispositions: [
        { id: first.id, status: 'ingested', evidenceRole: 'supporting', conflictsWithMemory: true },
        { id: later.id, status: 'ingested', evidenceRole: 'supporting' },
      ],
    });
    expect(result.status).toBe('committed');
  });

  it('checkpoints a direct correction without candidate promotion', async () => {
    const { homeDir } = await primed();
    const pending = await addCandidate(candidate(homeDir));
    const next = `# Example\n\n- [verified 2026-09-01] /hot is the live listing.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });

    const result = await checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] });

    expect(result.status).toBe('committed');
    if (result.status === 'committed') expect(result.provenanceCommit).toBeNull();
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(next);
    expect((await showCandidate('example.test', pending.id, { homeDir })).status).toBe('pending');
  });

  it('requires candidate_ingestion dispositions and a memory change', async () => {
    const { homeDir } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n` });

    await expect(checkpoint(homeDir)).rejects.toThrow(/disposition/i);
    await writeDraft(homeDir, { 'sitemap/SITE.md': SITE });
    await expect(checkpoint(homeDir, {
      dispositions: [
        { id: first.id, status: 'ingested', evidenceRole: 'supporting' },
        { id: second.id, status: 'ingested', evidenceRole: 'supporting' },
      ],
    })).rejects.toThrow(/memory|change|unchanged/i);
    expect((await showCandidate('example.test', first.id, { homeDir })).status).toBe('pending');
  });

  it('commits provenance only when candidate_ingestion rejects without a memory change', async () => {
    const { homeDir, sites } = await primed();
    const pending = await addCandidate(candidate(homeDir));
    const revision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    await expect(checkpoint(homeDir, {
      dispositions: [{ id: pending.id, status: 'rejected', rejectionReason: 'stale' }],
    })).rejects.toThrow(/unchanged|memory|change/i);
    expect((await showCandidate('example.test', pending.id, { homeDir })).status).toBe('pending');

    await writeDraft(homeDir, { 'sitemap/SITE.md': SITE });
    const result = await checkpoint(homeDir, {
      dispositions: [{ id: pending.id, status: 'rejected', rejectionReason: 'stale' }],
    });
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') throw new Error('expected commit');
    expect(result.memoryCommit).toBe(revision);
    expect(result.provenanceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.provenanceCommit).not.toBe(revision);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(SITE);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(1);
    expect((await showCandidate('example.test', pending.id, { homeDir }))).toMatchObject({
      status: 'rejected',
      evidenceRole: null,
      memoryCommit: null,
      rejectionReason: 'stale',
    });
    const provenanceFiles = (await git(sites, ['show', '--name-only', '--pretty=format:', result.provenanceCommit ?? ''])).trim().split('\n');
    expect(provenanceFiles.join('\n')).toMatch(/candidates/);
    expect(provenanceFiles.join('\n')).not.toMatch(/SITE\.md/);
  });

  it('rejects dispositions on direct_correction and major_rewrite', async () => {
    const { homeDir } = await primed();
    const pending = await addCandidate(candidate(homeDir));
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n- [verified 2026-09-01] /hot is the live listing.\n` });

    await expect(checkpoint(homeDir, {
      reason: 'direct_correction',
      dispositions: [{ id: pending.id, status: 'rejected', rejectionReason: 'stale' }],
    })).rejects.toThrow(/disposition/i);
    await writeDraft(homeDir, {
      'sitemap/SITE.md': siteLines(200, true),
      'sitemap/references/listing.md': REF,
    });
    await expect(checkpoint(homeDir, {
      reason: 'major_rewrite',
      paths: ['sitemap/SITE.md', 'sitemap/references/listing.md'],
      dispositions: [{ id: pending.id, status: 'rejected', rejectionReason: 'stale' }],
    })).rejects.toThrow(/disposition/i);
    expect((await showCandidate('example.test', pending.id, { homeDir })).status).toBe('pending');
  });

  it('rejects duplicate Markdown paths and duplicate candidate ids', async () => {
    const { homeDir } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n` });

    await expect(checkpoint(homeDir, {
      paths: ['sitemap/SITE.md', 'sitemap/SITE.md'],
      dispositions: [
        { id: first.id, status: 'ingested', evidenceRole: 'supporting' },
        { id: second.id, status: 'ingested', evidenceRole: 'supporting' },
      ],
    })).rejects.toThrow(/duplicate|path/i);
    await expect(checkpoint(homeDir, {
      dispositions: [
        { id: first.id, status: 'ingested', evidenceRole: 'supporting' },
        { id: first.id, status: 'ingested', evidenceRole: 'supporting' },
      ],
    })).rejects.toThrow(/duplicate|id/i);
    expect((await showCandidate('example.test', first.id, { homeDir })).status).toBe('pending');
  });

  it('records supporting and dissenting roles and requires rejection reasons', async () => {
    const { homeDir } = await primed();
    const support = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const dissent = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Disagree' }));
    const junk = await addCandidate(candidate(homeDir, { observedAt: '2026-08-29T12:00:00Z', claim: 'Transient' }));
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n${FACT}- [verified 2026-08-31] Keep /new.\n` });

    await expect(checkpoint(homeDir, {
      dispositions: [{ id: junk.id, status: 'rejected' }],
    })).rejects.toThrow(/reason/i);

    const result = await checkpoint(homeDir, {
      dispositions: [
        { id: support.id, status: 'ingested', evidenceRole: 'supporting' },
        { id: dissent.id, status: 'ingested', evidenceRole: 'dissenting' },
        { id: junk.id, status: 'rejected', rejectionReason: 'transient' },
      ],
    });
    expect(result.status).toBe('committed');
    const storedSupport = await showCandidate('example.test', support.id, { homeDir });
    const storedDissent = await showCandidate('example.test', dissent.id, { homeDir });
    const storedJunk = await showCandidate('example.test', junk.id, { homeDir });
    expect(storedSupport.evidenceRole).toBe('supporting');
    expect(storedDissent.evidenceRole).toBe('dissenting');
    expect(storedJunk).toMatchObject({ status: 'rejected', evidenceRole: null, rejectionReason: 'transient' });
    const raw = JSON.parse(await readProductFile('example.test', `candidates/${support.id}.json`, { homeDir }) ?? '');
    expect(raw.memory_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(raw.evidence_role).toBe('supporting');
    expect(raw.schema_version).toBe(1);
  }, 20_000);
});

describe('checkpoint git transaction', () => {
  it('commits memory before provenance, stages explicit paths, and leaves candidates pending if memory commit fails', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    await writeFile(join(sites, 'example.test', 'scratch.md'), 'unrelated\n');
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });

    const result = await checkpoint(homeDir, {
      dispositions: [
        { id: first.id, status: 'ingested', evidenceRole: 'supporting' },
        { id: second.id, status: 'ingested', evidenceRole: 'supporting' },
      ],
    });
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') throw new Error('expected commit');

    const memoryFiles = (await git(sites, ['show', '--name-only', '--pretty=format:', result.memoryCommit])).trim().split('\n');
    const provenanceFiles = (await git(sites, ['show', '--name-only', '--pretty=format:', result.provenanceCommit ?? ''])).trim().split('\n');
    expect(memoryFiles).toContain('example.test/sitemap/SITE.md');
    expect(memoryFiles.join('\n')).not.toMatch(/candidates/);
    expect(provenanceFiles.join('\n')).toMatch(/candidates/);
    expect(provenanceFiles.join('\n')).not.toMatch(/SITE\.md/);
    expect((await git(sites, ['log', '--format=%H', `${result.memoryCommit}..${result.provenanceCommit}`])).trim()).toBe(result.provenanceCommit);
    expect((await git(sites, ['ls-files'])).trim().split('\n')).not.toContain('example.test/scratch.md');

    const blocked = await primed();
    const pending = await addCandidate(candidate(blocked.homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const later = await addCandidate(candidate(blocked.homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    await writeDraft(blocked.homeDir, { 'sitemap/SITE.md': next });
    await withGitWrapper(blocked.homeDir, 'memory', async () => {
      await expect(checkpoint(blocked.homeDir, {
        dispositions: [
          { id: pending.id, status: 'ingested', evidenceRole: 'supporting' },
          { id: later.id, status: 'ingested', evidenceRole: 'supporting' },
        ],
      })).rejects.toThrow();
    });
    expect((await showCandidate('example.test', pending.id, { homeDir: blocked.homeDir })).status).toBe('pending');
    expect((await showCandidate('example.test', pending.id, { homeDir: blocked.homeDir })).memoryCommit).toBeNull();
    expect((await showCandidate('example.test', later.id, { homeDir: blocked.homeDir })).status).toBe('pending');
  }, 20_000);

  it('restores prior Markdown, deletes new paths, and keeps the index clean if memory commit fails', async () => {
    const blocked = await primed();
    const pending = await addCandidate(candidate(blocked.homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const later = await addCandidate(candidate(blocked.homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(blocked.homeDir, {
      'sitemap/SITE.md': next,
      'sitemap/references/listing.md': REF,
    });

    await withGitWrapper(blocked.homeDir, 'memory', async () => {
      await expect(checkpoint(blocked.homeDir, {
        paths: ['sitemap/SITE.md', 'sitemap/references/listing.md'],
        dispositions: [
          { id: pending.id, status: 'ingested', evidenceRole: 'supporting' },
          { id: later.id, status: 'ingested', evidenceRole: 'supporting' },
        ],
      })).rejects.toThrow();
    });

    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir: blocked.homeDir })).toBe(SITE);
    expect(await readProductFile('example.test', 'sitemap/references/listing.md', { homeDir: blocked.homeDir })).toBeNull();
    expect((await showCandidate('example.test', pending.id, { homeDir: blocked.homeDir })).status).toBe('pending');
    expect((await showCandidate('example.test', later.id, { homeDir: blocked.homeDir })).status).toBe('pending');
    expect((await git(blocked.sites, ['status', '--porcelain', '-uall'])).trim()).toBe('');
    expect((await git(blocked.sites, ['diff', '--cached', '--name-only'])).trim()).toBe('');
  });

  it.skipIf(process.platform === 'win32')('combines memory commit and rollback errors', async () => {
    const blocked = await primed();
    const pending = await addCandidate(candidate(blocked.homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const later = await addCandidate(candidate(blocked.homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(blocked.homeDir, { 'sitemap/SITE.md': next });
    const sitemapDir = join(blocked.sites, 'example.test', 'sitemap');

    try {
      await withGitWrapper(blocked.homeDir, 'memory', async () => {
        const error = await checkpoint(blocked.homeDir, {
          dispositions: [
            { id: pending.id, status: 'ingested', evidenceRole: 'supporting' },
            { id: later.id, status: 'ingested', evidenceRole: 'supporting' },
          ],
        }).then(
          () => {
            throw new Error('expected checkpoint to fail');
          },
          (err: unknown) => err,
        );
        expect(error).toBeInstanceOf(AggregateError);
        const aggregate = error as AggregateError;
        expect(aggregate.errors.length).toBeGreaterThanOrEqual(2);
        expect(aggregate.message).toMatch(/rollback/i);
        expect(aggregate.errors.map((item) => (item instanceof Error ? item.message : String(item))).join('\n')).toMatch(
          /checkpoint memory/i,
        );
        expect(aggregate.errors.map((item) => (item instanceof Error ? item.message : String(item))).join('\n')).toMatch(
          /EACCES|EPERM|permission denied/i,
        );
      }, sitemapDir);
    } finally {
      await chmod(sitemapDir, 0o755).catch(() => undefined);
    }
  });

  it('resumes a failed provenance commit without replaying the memory change', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions = [
      { id: first.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
      { id: second.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    const memoryRevision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    expect(await git(sites, ['show', `HEAD:example.test/sitemap/SITE.md`])).toBe(next);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(2);
    const disk = await showCandidate('example.test', first.id, { homeDir });
    expect(disk.status).toBe('ingested');
    expect(disk.memoryCommit).toBe(memoryRevision);

    const resumed = await checkpoint(homeDir, { expectedRevision: memoryRevision, dispositions });
    expect(resumed.status).toBe('committed');
    if (resumed.status !== 'committed') throw new Error('expected commit');
    expect(resumed.memoryCommit).toBe(memoryRevision);
    expect(resumed.provenanceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(resumed.provenanceCommit).not.toBe(memoryRevision);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(2);
    expect((await git(sites, ['show', `HEAD:example.test/candidates/${first.id}.json`]))).toMatch(/"status": "ingested"/);
  });

  it('rejects provenance recovery when the draft changed and then recovers with an unchanged draft', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions = [
      { id: first.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
      { id: second.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    const memoryRevision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    const extra = `${next}- [verified 2026-09-01] Ban risk on bulk delete.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': extra });
    await expect(checkpoint(homeDir, { expectedRevision: memoryRevision, dispositions })).rejects.toThrow(/unchanged draft/i);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(next);
    expect(await readFile(join(homeDir, '.webcmd/sites/.drafts/task-1/example.test/sitemap/SITE.md'), 'utf8')).toBe(extra);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(2);

    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const resumed = await checkpoint(homeDir, { expectedRevision: memoryRevision, dispositions });
    expect(resumed.status).toBe('committed');
    if (resumed.status !== 'committed') throw new Error('expected commit');
    expect(resumed.memoryCommit).toBe(memoryRevision);
    expect(resumed.provenanceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(next);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(2);
    expect((await git(sites, ['show', `HEAD:example.test/candidates/${first.id}.json`]))).toMatch(/"status": "ingested"/);
  });

  it('finishes remaining provenance writes without replaying memory', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions = [
      { id: first.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
      { id: second.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    const memoryRevision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    const pendingBody = JSON.parse(await readProductFile('example.test', `candidates/${second.id}.json`, { homeDir }) ?? '');
    pendingBody.status = 'pending';
    pendingBody.evidence_role = null;
    pendingBody.memory_commit = null;
    pendingBody.reviewed_at = null;
    pendingBody.rejection_reason = null;
    await writeProductFile('example.test', `candidates/${second.id}.json`, `${JSON.stringify(pendingBody, null, 2)}\n`, { homeDir });

    const resumed = await checkpoint(homeDir, { expectedRevision: memoryRevision, dispositions });
    expect(resumed.status).toBe('committed');
    if (resumed.status !== 'committed') throw new Error('expected commit');
    expect(resumed.memoryCommit).toBe(memoryRevision);
    expect(resumed.provenanceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(2);
    expect((await showCandidate('example.test', first.id, { homeDir })).status).toBe('ingested');
    expect((await showCandidate('example.test', second.id, { homeDir }))).toMatchObject({
      status: 'ingested',
      memoryCommit: memoryRevision,
    });
  });

  it('rejects provenance recovery when a candidate does not match the requested terminal state', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions = [
      { id: first.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
      { id: second.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    const memoryRevision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    const mismatched = JSON.parse(await readProductFile('example.test', `candidates/${first.id}.json`, { homeDir }) ?? '');
    mismatched.status = 'rejected';
    mismatched.evidence_role = null;
    mismatched.memory_commit = null;
    mismatched.rejection_reason = 'stale';
    await writeProductFile('example.test', `candidates/${first.id}.json`, `${JSON.stringify(mismatched, null, 2)}\n`, { homeDir });

    await expect(checkpoint(homeDir, { expectedRevision: memoryRevision, dispositions })).rejects.toThrow(/pending|transition|status|mismatch/i);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(2);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(next);
  });

  it('validates the product manifest before provenance recovery', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions = [
      { id: first.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
      { id: second.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    const memoryRevision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    await writeProductFile('example.test', 'manifest.json', '{\n', { homeDir });

    await expect(checkpoint(homeDir, { expectedRevision: memoryRevision, dispositions })).rejects.toThrow(/incompatible beta schema|manifest|schema/i);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(next);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(2);
    expect(JSON.parse(await git(sites, ['show', `HEAD:example.test/candidates/${first.id}.json`])).status).toBe('pending');
  });

  it('validates disposition fields during provenance recovery', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions = [
      { id: first.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
      { id: second.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    const memoryRevision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    await expect(checkpoint(homeDir, {
      expectedRevision: memoryRevision,
      dispositions: [
        { id: first.id, status: 'ingested' },
        { id: second.id, status: 'ingested' },
      ],
    })).rejects.toThrow(/evidence_role|status/i);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(2);
    expect(JSON.parse(await git(sites, ['show', `HEAD:example.test/candidates/${first.id}.json`])).status).toBe('pending');
  });

  it('recovers unfinished provenance on a later product write without original dispositions', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions = [
      { id: first.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
      { id: second.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    const memoryRevision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    expect(await git(sites, ['status', '--porcelain', '-uall', '--', `example.test/candidates/${first.id}.json`])).toMatch(/candidates/);
    expect((await showCandidate('example.test', first.id, { homeDir })).memoryCommit).toBe(memoryRevision);

    const later = await addCandidate(candidate(homeDir, { claim: 'Ordinary later capture' }));
    expect(later.status).toBe('pending');
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim().split('\n')).toHaveLength(2);
    expect((await git(sites, ['show', `HEAD:example.test/candidates/${first.id}.json`]))).toMatch(/"status": "ingested"/);
    expect((await git(sites, ['show', `HEAD:example.test/candidates/${second.id}.json`]))).toMatch(/"status": "ingested"/);
    expect((await git(sites, ['status', '--porcelain', '-uall', '--', 'example.test/candidates'])).trim()).toBe('');
    expect(JSON.parse(await git(sites, ['show', `HEAD:example.test/candidates/${later.id}.json`])).status).toBe('pending');
  }, 20_000);

  it('recovers interrupted ingested provenance after an unrelated later product commit', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions = [
      { id: first.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
      { id: second.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    const memoryRevision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    expect((await showCandidate('example.test', first.id, { homeDir })).memoryCommit).toBe(memoryRevision);

    const other = {
      key: 'other.test',
      hostname: 'other.test',
      displayHostname: 'other.test',
      registrableDomain: 'other.test',
    };
    await writeProductFile('other.test', 'manifest.json', `${JSON.stringify({
      schemaVersion: 1,
      product: other,
      interfaces: [],
      seed: { status: 'absent' },
    }, null, 2)}\n`, { homeDir });
    await (await openSitesRepository({ homeDir })).commit(['other.test/manifest.json'], 'init other');
    const laterHead = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    expect(laterHead).not.toBe(memoryRevision);

    const statusScopes: string[][] = [];
    const { restore } = installGitShim(async (args, runReal) => {
      if (args.includes('status')) {
        const dash = args.lastIndexOf('--');
        if (dash >= 0) statusScopes.push(args.slice(dash + 1).filter((part) => !part.startsWith('-')));
      }
      return runReal();
    });
    try {
      const later = await addCandidate(candidate(homeDir, { claim: 'Ordinary later capture' }));
      expect(later.status).toBe('pending');
    } finally {
      restore();
    }

    expect(statusScopes.some((scope) => scope.some((path) => path.endsWith(`${first.id}.json`) || path.endsWith(`${second.id}.json`)))).toBe(false);
    expect(statusScopes.some((scope) => scope.includes('example.test/candidates'))).toBe(true);
    expect((await showCandidate('example.test', first.id, { homeDir })).memoryCommit).toBe(memoryRevision);
    await git(sites, ['merge-base', '--is-ancestor', memoryRevision, 'HEAD']);
    expect((await git(sites, ['show', `HEAD:example.test/candidates/${first.id}.json`]))).toMatch(/"status": "ingested"/);
    expect((await git(sites, ['show', `HEAD:example.test/candidates/${second.id}.json`]))).toMatch(/"status": "ingested"/);
    expect((await git(sites, ['status', '--porcelain', '-uall', '--', 'example.test/candidates'])).trim()).toBe('');
    expect(JSON.parse(await git(sites, ['show', `HEAD:example.test/candidates/${first.id}.json`])).memory_commit).toBe(memoryRevision);
  }, 20_000);

  it('recovers a rejected-only interrupted provenance batch on a later product write', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    await writeDraft(homeDir, { 'sitemap/SITE.md': SITE });
    const dispositions = [
      { id: first.id, status: 'rejected' as const, rejectionReason: 'stale' },
      { id: second.id, status: 'rejected' as const, rejectionReason: 'duplicate' },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    expect((await showCandidate('example.test', first.id, { homeDir })).status).toBe('rejected');
    expect(await git(sites, ['status', '--porcelain', '-uall', '--', `example.test/candidates/${first.id}.json`])).toMatch(/candidates/);

    const later = await addCandidate(candidate(homeDir, { claim: 'Ordinary later capture' }));
    expect(later.status).toBe('pending');
    expect((await git(sites, ['show', `HEAD:example.test/candidates/${first.id}.json`]))).toMatch(/"status": "rejected"/);
    expect((await git(sites, ['show', `HEAD:example.test/candidates/${second.id}.json`]))).toMatch(/"status": "rejected"/);
    expect((await git(sites, ['status', '--porcelain', '-uall', '--', 'example.test/candidates'])).trim()).toBe('');
    expect(JSON.parse(await git(sites, ['show', `HEAD:example.test/candidates/${later.id}.json`])).status).toBe('pending');
  }, 20_000);

  it('does not auto-commit a pending candidate whose payload was edited into a terminal record', async () => {
    const { homeDir, sites } = await primed();
    const ingested = await addCandidate(candidate(homeDir, { claim: 'Keep ingested payload' }));
    const rejected = await addCandidate(candidate(homeDir, { claim: 'Keep rejected payload' }));
    const head = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    const reviewedAt = '2026-09-01T12:00:00Z';
    await stampTerminal(homeDir, ingested.id, {
      claim: 'Tampered ingested claim',
      status: 'ingested',
      evidence_role: 'supporting',
      memory_commit: head,
      reviewed_at: reviewedAt,
      rejection_reason: null,
    });
    await stampTerminal(homeDir, rejected.id, {
      claim: 'Tampered rejected claim',
      status: 'rejected',
      evidence_role: null,
      memory_commit: null,
      reviewed_at: reviewedAt,
      rejection_reason: 'stale',
    });

    await expect(addCandidate(candidate(homeDir, { claim: 'Ordinary later capture' }))).rejects.toThrow(/unrelated dirty/i);
    expect((await git(sites, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect(JSON.parse(await git(sites, ['show', `HEAD:example.test/candidates/${ingested.id}.json`]))).toMatchObject({
      claim: 'Keep ingested payload',
      status: 'pending',
    });
    expect(JSON.parse(await git(sites, ['show', `HEAD:example.test/candidates/${rejected.id}.json`]))).toMatchObject({
      claim: 'Keep rejected payload',
      status: 'pending',
    });
  });

  it('does not treat a dirty already-rejected candidate as interrupted provenance', async () => {
    const { homeDir, sites } = await primed();
    const pending = await addCandidate(candidate(homeDir));
    await writeDraft(homeDir, { 'sitemap/SITE.md': SITE });
    await checkpoint(homeDir, {
      dispositions: [{ id: pending.id, status: 'rejected', rejectionReason: 'stale' }],
    });
    const head = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    const path = `candidates/${pending.id}.json`;
    const raw = JSON.parse(await readProductFile('example.test', path, { homeDir }) ?? '');
    raw.rejection_reason = 'edited after commit';
    await writeProductFile('example.test', path, `${JSON.stringify(raw, null, 2)}\n`, { homeDir });

    await expect(addCandidate(candidate(homeDir, { claim: 'Ordinary later capture' }))).rejects.toThrow(/unrelated dirty/i);
    expect((await git(sites, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect(JSON.parse(await git(sites, ['show', `HEAD:example.test/${path}`])).rejection_reason).toBe('stale');
  });

  it('rejects provenance recovery when candidate paths match HEAD', async () => {
    const { homeDir, sites } = await primed();
    const first = await addCandidate(candidate(homeDir, { observedAt: '2026-08-30T12:00:00Z' }));
    const second = await addCandidate(candidate(homeDir, { observedAt: '2026-08-31T12:00:00Z', claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-08-31] Later path is denser.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions = [
      { id: first.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
      { id: second.id, status: 'ingested' as const, evidenceRole: 'supporting' as const },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, { dispositions })).rejects.toThrow();
    });

    await git(sites, ['add', '--', `example.test/candidates/${first.id}.json`, `example.test/candidates/${second.id}.json`]);
    await git(sites, ['-c', 'user.name=webcmd', '-c', 'user.email=webcmd@local', 'commit', '-m', 'manual-provenance']);
    const head = (await git(sites, ['rev-parse', 'HEAD'])).trim();

    await expect(checkpoint(homeDir, { expectedRevision: head, dispositions })).rejects.toThrow(/pending|transition|status/i);
    expect((await git(sites, ['rev-parse', 'HEAD'])).trim()).toBe(head);
  });
});

describe('checkpoint rewrite bounds', () => {
  it('allows an unchanged oversized seed', async () => {
    const oversized = siteLines(501);
    const { homeDir } = await primed(oversized);
    await writeDraft(homeDir, { 'sitemap/SITE.md': oversized });

    const result = await checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] });

    expect(result.status).toBe('committed');
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(oversized);
  });

  it('requires a later update of an oversized SITE.md to be at most 200 lines', async () => {
    const { homeDir } = await primed(siteLines(501));
    await writeDraft(homeDir, { 'sitemap/SITE.md': siteLines(500) });
    await expect(checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] })).rejects.toThrow(/200|rewrite/i);

    await writeDraft(homeDir, { 'sitemap/references/listing.md': REF });
    await expect(checkpoint(homeDir, {
      reason: 'direct_correction',
      paths: ['sitemap/references/listing.md'],
      dispositions: [],
    })).rejects.toThrow(/200|rewrite/i);

    const oversized = siteLines(501);
    await writeDraft(homeDir, {
      'sitemap/SITE.md': oversized,
      'sitemap/references/listing.md': REF,
    });
    await expect(checkpoint(homeDir, {
      reason: 'direct_correction',
      paths: ['sitemap/SITE.md', 'sitemap/references/listing.md'],
      dispositions: [],
    })).rejects.toThrow(/200|rewrite/i);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(oversized);

    const rewritten = siteLines(200, true);
    await writeDraft(homeDir, {
      'sitemap/SITE.md': rewritten,
      'sitemap/references/listing.md': REF,
    });
    const result = await checkpoint(homeDir, {
      reason: 'major_rewrite',
      paths: ['sitemap/SITE.md', 'sitemap/references/listing.md'],
      dispositions: [],
    });
    expect(result.status).toBe('committed');
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(rewritten);
  });

  it('allows a pointer-bearing non-rewritten SITE.md to grow up to 500 lines', async () => {
    const { homeDir } = await primed(siteLines(150, true));
    const grown = siteLines(500, true);
    await writeDraft(homeDir, { 'sitemap/SITE.md': grown });

    const result = await checkpoint(homeDir, { reason: 'direct_correction', dispositions: [] });

    expect(result.status).toBe('committed');
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(grown);
    expect(parseProductManifest(await readProductFile('example.test', 'manifest.json', { homeDir }))?.postRewrite)
      .toBeUndefined();
  });

  it('preserves the 200-line cap and contextual pointers after a rewrite', async () => {
    const { homeDir, sites, revision } = await primed(siteLines(501));
    await writeDraft(homeDir, {
      'sitemap/SITE.md': siteLines(200, true),
      'sitemap/references/listing.md': REF,
    });
    const rewritten = await checkpoint(homeDir, {
      expectedRevision: revision,
      reason: 'major_rewrite',
      paths: ['sitemap/SITE.md', 'sitemap/references/listing.md'],
      dispositions: [],
    });
    expect(rewritten.status).toBe('committed');
    if (rewritten.status !== 'committed') throw new Error('expected commit');

    await writeDraft(homeDir, { 'sitemap/SITE.md': siteLines(201, true) }, 'task-2');
    await expect(checkpoint(homeDir, {
      taskId: 'task-2',
      expectedRevision: rewritten.memoryCommit,
      reason: 'direct_correction',
      dispositions: [],
    })).rejects.toThrow(/200/i);

    const next = siteLines(180, true);
    await writeDraft(homeDir, { 'sitemap/SITE.md': next }, 'task-2');
    const result = await checkpoint(homeDir, {
      taskId: 'task-2',
      expectedRevision: rewritten.memoryCommit,
      reason: 'direct_correction',
      dispositions: [],
    });
    expect(result.status).toBe('committed');
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(next);
    expect(next).toContain('](references/listing.md)');
    expect(parseProductManifest(await readProductFile('example.test', 'manifest.json', { homeDir }))?.postRewrite)
      .toBe(true);
    const memoryFiles = (await git(sites, ['show', '--name-only', '--pretty=format:', rewritten.memoryCommit])).trim();
    expect(memoryFiles).toContain('example.test/manifest.json');
    expect(memoryFiles).toContain('example.test/sitemap/SITE.md');
  }, 20_000);
});

function siteLines(count: number, pointer = false): string {
  const extra = pointer ? [POINTER.trimEnd()] : [];
  const heading = ['# Example'];
  const facts = Array.from({ length: count - heading.length - extra.length }, (_, i) => `- [verified 2026-08-31] Fact ${i}.`);
  return `${[...heading, ...facts, ...extra].join('\n')}\n`;
}

async function checkpoint(homeDir: string, extra: Partial<CheckpointInput> = {}) {
  return checkpointMemory({
    product: 'example.test',
    taskId: 'task-1',
    reason: 'candidate_ingestion',
    paths: ['sitemap/SITE.md'],
    dispositions: [],
    ...extra,
    homeDir,
    expectedRevision: extra.expectedRevision ?? await (await openSitesRepository({ homeDir })).revision(),
  });
}

function candidate(homeDir: string, extra: Record<string, unknown> = {}) {
  return {
    product: 'example.test',
    hostname: 'example.test',
    kind: 'better_path',
    claim: 'New listing is faster',
    evidence: 'Used /new while /hot spun.',
    consequence: 'Prefer /new for fresh posts',
    environment: {},
    homeDir,
    ...extra,
  };
}

async function primed(site = SITE) {
  const { homeDir, sites } = await tempSites();
  const product = {
    key: 'example.test',
    hostname: 'example.test',
    displayHostname: 'example.test',
    registrableDomain: 'example.test',
  };
  await writeProductFile('example.test', 'manifest.json', `${JSON.stringify({
    schemaVersion: 1,
    product,
    interfaces: [],
    seed: { status: 'absent' },
  }, null, 2)}\n`, { homeDir });
  await writeProductFile('example.test', 'sitemap/SITE.md', site, { homeDir });
  const repo = await openSitesRepository({ homeDir });
  const revision = await repo.commit(['example.test/manifest.json', 'example.test/sitemap/SITE.md'], 'init');
  return { homeDir, sites, revision, repo };
}

async function writeDraft(homeDir: string, files: Record<string, string>, taskId = 'task-1') {
  const draftRoot = join(homeDir, '.webcmd/sites/.drafts', taskId, 'example.test');
  for (const [path, body] of Object.entries(files)) {
    const target = join(draftRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  const meta = join(draftRoot, 'context.json');
  try {
    await readFile(meta);
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err;
    await writeFile(meta, `${JSON.stringify({ readOnly: false })}\n`);
  }
}

async function stampTerminal(homeDir: string, id: string, patch: Record<string, unknown>) {
  const path = `candidates/${id}.json`;
  const raw = JSON.parse(await readProductFile('example.test', path, { homeDir }) ?? '');
  await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, ...patch }, null, 2)}\n`, { homeDir });
}

async function withGitWrapper(homeDir: string, fail: 'memory' | 'provenance', fn: () => Promise<void>, chmodOnFail?: string) {
  const needle = fail === 'memory' ? 'checkpoint memory' : 'checkpoint provenance';
  const { restore } = installGitShim(async (args, runReal) => {
    const msg = args.includes('-m') ? args[args.indexOf('-m') + 1] : '';
    if (args.includes('commit') && msg.includes(needle)) {
      if (chmodOnFail) try { chmodSync(chmodOnFail, 0o555); } catch {}
      throw Object.assign(new Error(`Command failed: git ${args.join(' ')}`), { code: 1, stderr: '' });
    }
    return runReal();
  });
  try {
    await fn();
  } finally {
    restore();
  }
}

async function tempSites() {
  const homeDir = await mkdtemp(join(tmpdir(), 'webcmd-checkpoint-'));
  tempHomes.push(homeDir);
  return { homeDir, sites: join(homeDir, '.webcmd', 'sites') };
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}
