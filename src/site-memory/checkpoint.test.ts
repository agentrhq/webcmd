import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { addCandidate, showCandidate } from './candidates.js';
import { checkpointMemory, type CheckpointInput } from './checkpoint.js';
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

    await writeDraft(homeDir, { 'sitemap/SITE.md': '# Example\n\n- [verified 2026-13-40] Prefer /new.\n' });
    await expect(checkpoint(homeDir)).rejects.toThrow(/verified/i);
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

  it('preserves the 200-line cap and contextual pointers after a rewrite', async () => {
    const { homeDir, revision } = await primed(siteLines(501));
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

async function withGitWrapper(homeDir: string, fail: 'memory' | 'provenance', fn: () => Promise<void>) {
  const originalPath = process.env.PATH;
  const wrapperDir = await mkdtemp(join(tmpdir(), 'webcmd-checkpoint-git-'));
  tempHomes.push(wrapperDir);
  const { stdout } = await run('/usr/bin/which', ['git'], { encoding: 'utf8' });
  const needle = fail === 'memory' ? 'checkpoint memory' : 'checkpoint provenance';
  const wrapper = join(wrapperDir, 'git');
  await writeFile(wrapper, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const msg = args.includes('-m') ? args[args.indexOf('-m') + 1] : '';
if (args.includes('commit') && msg.includes(${JSON.stringify(needle)})) process.exit(1);
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
