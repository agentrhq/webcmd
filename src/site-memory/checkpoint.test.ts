import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { addCandidate, showCandidate } from './candidates.js';
import { checkpointMemory, type CheckpointInput } from './checkpoint.js';
import { parseProductManifest } from './context.js';
import { openSitesRepository } from './git-store.js';
import { readProductFile, writeProductFile } from './local-store.js';

const run = promisify(execFile);
const tempHomes: string[] = [];
const FACT = '- [verified 2026-08-31] Prefer /new for fresh posts.\n';
const SITE = `# Example\n\n${FACT}`;
const POINTER = '- More: [references/listing.md](references/listing.md).\n';
const REF = `# Listing\n\n${FACT}`;

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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
  });
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
  });

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

  it('combines memory commit and rollback errors', async () => {
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
  });
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
    hostname: 'www.example.test',
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
  for (const [path, body] of Object.entries(files)) {
    const target = join(homeDir, '.webcmd/sites/.drafts', taskId, 'example.test', path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
}

async function withGitWrapper(homeDir: string, fail: 'memory' | 'provenance', fn: () => Promise<void>, chmodOnFail?: string) {
  const originalPath = process.env.PATH;
  const wrapperDir = await mkdtemp(join(tmpdir(), 'webcmd-checkpoint-git-'));
  tempHomes.push(wrapperDir);
  const { stdout } = await run('/usr/bin/which', ['git'], { encoding: 'utf8' });
  const needle = fail === 'memory' ? 'checkpoint memory' : 'checkpoint provenance';
  const wrapper = join(wrapperDir, 'git');
  await writeFile(wrapper, `#!/usr/bin/env node
const { chmodSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const msg = args.includes('-m') ? args[args.indexOf('-m') + 1] : '';
if (args.includes('commit') && msg.includes(${JSON.stringify(needle)})) {
  ${chmodOnFail ? `try { chmodSync(${JSON.stringify(chmodOnFail)}, 0o555); } catch {}` : ''}
  process.exit(1);
}
const result = spawnSync(${JSON.stringify(stdout.trim())}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  await chmod(wrapper, 0o755);
  process.env.PATH = `${wrapperDir}:${originalPath}`;
  try {
    await fn();
  } finally {
    process.env.PATH = originalPath;
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
