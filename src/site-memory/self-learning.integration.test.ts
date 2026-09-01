import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCandidate, listCandidates, showCandidate } from './candidates.js';
import { checkpointMemory, type CheckpointInput } from './checkpoint.js';
import { classifyProduct } from './classify.js';
import { getMemoryContext, parseProductManifest } from './context.js';
import { installGitShim, restoreGitShim } from './git-shim.js';
import { openSitesRepository } from './git-store.js';
import { listSiteMemory, readProductFile, showSiteMemory, writeProductFile } from './local-store.js';
import type { CandidateDisposition, SeedLookupResult } from './model.js';
import { createHttpSeedProvider } from './seed-client.js';

const run = promisify(execFile);
const tempHomes: string[] = [];
const seedEnv = { WEBCMD_GLOBAL_MEMORY_URL: 'https://api.webcmd.dev' };
const FACT = '- [verified 2026-08-31] Prefer /new for fresh posts.\n';
const SITE = `# Example\n\n${FACT}`;
const POINTER = '- More: [references/listing.md](references/listing.md).\n';
const REF = `# Listing\n\n${FACT}`;
const CLOCK = {
  sameMorning: '2026-08-31T01:00:00.000Z',
  sameEvening: '2026-08-31T23:00:00.000Z',
  later: '2026-09-01T12:00:00.000Z',
  earlier: '2026-08-30T12:00:00.000Z',
} as const;

afterEach(async () => {
  restoreGitShim();
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('self-learning lifecycle', () => {
  it('persists seeded, offline, and disabled cold starts differently', async () => {
    const { homeDir, sites } = await tempSites();
    const { fetch, calls } = recordingFetch(seedFetch({
      'seeded.test': {
        status: 'available',
        revision: 'seed-1',
        site: SITE,
        references: { 'listing.md': REF },
      },
      'offline.test': 'throw',
      'disabled.test': { status: 'available', revision: 'nope', site: '# No\n' },
    }));

    const seeded = await getMemoryContext({
      url: 'https://seeded.test/',
      taskId: 'task-seeded',
      homeDir,
      seedProvider: createHttpSeedProvider({ fetch, env: seedEnv }),
    });
    const offline = await getMemoryContext({
      url: 'https://offline.test/',
      taskId: 'task-offline',
      homeDir,
      seedProvider: createHttpSeedProvider({ fetch, env: seedEnv }),
    });
    const disabled = await getMemoryContext({
      url: 'https://disabled.test/',
      taskId: 'task-disabled',
      homeDir,
      seedProvider: createHttpSeedProvider({ fetch, env: { ...seedEnv, WEBCMD_GLOBAL_MEMORY: 'off' } }),
    });
    const localFetch = vi.fn(async () => {
      throw new TypeError('seed fetch must not run');
    });
    const localOnly = await getMemoryContext({
      url: 'https://local.test/',
      taskId: 'task-local',
      homeDir,
      seedProvider: createHttpSeedProvider({ fetch: localFetch, env: {} }),
    });

    expect(seeded.manifest?.seed).toEqual({ status: 'available', revision: 'seed-1' });
    expect(seeded.siteMarkdown).toBe(SITE);
    expect(seeded.readOnly).toBe(false);
    expect(await readProductFile('seeded.test', 'sitemap/SITE.md', { homeDir })).toBe(SITE);
    expect(await readProductFile('seeded.test', 'sitemap/references/listing.md', { homeDir })).toBe(REF);
    expect(await git(sites, ['ls-files'])).toContain('seeded.test/sitemap/SITE.md');

    expect(offline.manifest?.seed).toEqual({ status: 'lookup-failed' });
    expect(offline.siteMarkdown).toBeNull();
    expect(await readProductFile('offline.test', 'sitemap/SITE.md', { homeDir })).toBeNull();
    expect(await git(sites, ['ls-files'])).toContain('offline.test/manifest.json');
    expect(await git(sites, ['ls-files'])).not.toContain('offline.test/sitemap/SITE.md');

    expect(disabled.manifest?.seed).toEqual({ status: 'unattempted' });
    expect(disabled.readOnly).toBe(false);
    expect(disabled.siteMarkdown).toBeNull();
    expect(disabled.resolution.status).toBe('exact');
    expect(parseProductManifest(await readProductFile('disabled.test', 'manifest.json', { homeDir }))?.seed)
      .toEqual({ status: 'unattempted' });
    expect(await readProductFile('disabled.test', 'sitemap/SITE.md', { homeDir })).toBeNull();

    expect(localOnly.manifest?.seed).toEqual({ status: 'unattempted' });
    expect(localOnly.siteMarkdown).toBeNull();
    expect(parseProductManifest(await readProductFile('local.test', 'manifest.json', { homeDir }))?.seed)
      .toEqual({ status: 'unattempted' });
    expect(await readProductFile('local.test', 'sitemap/SITE.md', { homeDir })).toBeNull();
    expect(localFetch).not.toHaveBeenCalled();

    const learnedLocal = await learnFromDraft(homeDir, {
      product: 'local.test',
      taskId: 'task-local',
      site: `# Local\n\n${FACT}`,
    });
    expect(learnedLocal.status).toBe('committed');
    expect(await readProductFile('local.test', 'sitemap/SITE.md', { homeDir })).toBe(`# Local\n\n${FACT}`);

    const learned = await learnFromDraft(homeDir, {
      product: 'disabled.test',
      taskId: 'task-disabled',
      site: `# Disabled\n\n${FACT}`,
    });
    expect(learned.status).toBe('committed');
    expect(await readProductFile('disabled.test', 'sitemap/SITE.md', { homeDir })).toBe(`# Disabled\n\n${FACT}`);

    expect(calls.filter((call) => call.url.endsWith('/seeded.test'))).toEqual([{
      url: 'https://api.webcmd.dev/v1/site-memory/seeds/seeded.test',
      method: 'GET',
      credentials: 'omit',
      authorization: null,
    }]);
    expect(calls.filter((call) => call.url.endsWith('/offline.test'))).toHaveLength(1);
    expect(calls.some((call) => call.url.endsWith('/disabled.test'))).toBe(false);

    const enabled = await getMemoryContext({
      url: 'https://disabled.test/',
      taskId: 'task-disabled-2',
      homeDir,
      seedProvider: createHttpSeedProvider({
        fetch,
        env: {},
      }),
    });
    expect(enabled.manifest?.seed).toEqual({ status: 'unattempted' });
    expect(enabled.siteMarkdown).toBe(`# Disabled\n\n${FACT}`);
    expect(parseProductManifest(await readProductFile('disabled.test', 'manifest.json', { homeDir }))?.seed)
      .toEqual({ status: 'unattempted' });
    expect(await readProductFile('disabled.test', 'sitemap/SITE.md', { homeDir })).toBe(`# Disabled\n\n${FACT}`);
    expect(calls.filter((call) => call.url.endsWith('/disabled.test'))).toHaveLength(0);

    await getMemoryContext({
      url: 'https://disabled.test/',
      taskId: 'task-disabled-3',
      homeDir,
      seedProvider: createHttpSeedProvider({ fetch, env: {} }),
    });
    expect(calls.filter((call) => call.url.endsWith('/disabled.test'))).toHaveLength(0);
  });

  it('keeps Old Reddit a read-only parent fallback until interface confirmation and keeps Hacker News separate', async () => {
    const { homeDir } = await tempSites();
    const fetch = seedFetch({
      'reddit.com': { status: 'available', revision: 'reddit-1', site: '# Reddit\n' },
      'ycombinator.com': { status: 'available', revision: 'yc-1', site: '# YC\n' },
    });
    const seedProvider = createHttpSeedProvider({ fetch, env: seedEnv });

    await getMemoryContext({ url: 'https://reddit.com/', taskId: 'task-reddit', homeDir, seedProvider });
    const fallback = await getMemoryContext({
      url: 'https://old.reddit.com/r/typescript',
      taskId: 'task-old',
      homeDir,
      seedProvider,
    });

    expect(fallback.resolution).toMatchObject({
      status: 'provisional-fallback',
      readOnly: true,
      product: { key: 'reddit.com' },
      requested: { key: 'old.reddit.com' },
    });
    expect(fallback.readOnly).toBe(true);
    expect(fallback.siteMarkdown).toBe('# Reddit\n');
    expect(await readProductFile('old.reddit.com', 'manifest.json', { homeDir })).toBeNull();

    const classified = await classifyProduct({
      requested: 'https://old.reddit.com/',
      decision: 'same-product',
      parent: 'reddit.com',
      expectedRevision: fallback.revision,
      homeDir,
    });
    expect(classified).toMatchObject({ status: 'classified', decision: 'same-product', existing: false });

    const confirmed = await getMemoryContext({
      url: 'https://old.reddit.com/r/typescript',
      taskId: 'task-old-2',
      homeDir,
      seedProvider,
    });
    expect(confirmed.resolution).toMatchObject({
      status: 'confirmed-interface',
      readOnly: false,
      product: { key: 'reddit.com' },
      requested: { key: 'old.reddit.com' },
    });
    expect(confirmed.readOnly).toBe(false);

    await getMemoryContext({ url: 'https://ycombinator.com/', taskId: 'task-yc', homeDir, seedProvider });
    const hnFallback = await getMemoryContext({
      url: 'https://news.ycombinator.com/',
      taskId: 'task-hn',
      homeDir,
      seedProvider,
    });
    expect(hnFallback.resolution).toMatchObject({
      status: 'provisional-fallback',
      readOnly: true,
      product: { key: 'ycombinator.com' },
      requested: { key: 'news.ycombinator.com' },
    });
    expect(hnFallback.readOnly).toBe(true);
    expect(await readProductFile('news.ycombinator.com', 'manifest.json', { homeDir })).toBeNull();

    const distinct = await classifyProduct({
      requested: 'https://news.ycombinator.com/',
      decision: 'distinct',
      expectedRevision: hnFallback.revision,
      homeDir,
    });
    expect(distinct).toMatchObject({ status: 'classified', decision: 'distinct', existing: false });

    const hn = await getMemoryContext({
      url: 'https://news.ycombinator.com/',
      taskId: 'task-hn-2',
      homeDir,
      seedProvider,
    });
    expect(hn.resolution).toMatchObject({
      status: 'exact',
      readOnly: false,
      product: { key: 'news.ycombinator.com' },
    });
    expect(hn.readOnly).toBe(false);
    expect(parseProductManifest(await readProductFile('ycombinator.com', 'manifest.json', { homeDir }))?.interfaces)
      .toEqual([]);
    expect(await readProductFile('reddit.com', 'sitemap/SITE.md', { homeDir })).toBe('# Reddit\n');
  });

  it('keeps an incompatible beta SITE.md read-only through distinct classify', async () => {
    const { homeDir } = await tempSites();
    await mkdir(join(homeDir, '.webcmd/sites/beta.test/sitemap'), { recursive: true });
    await writeFile(join(homeDir, '.webcmd/sites/beta.test/sitemap/SITE.md'), '# beta schema\nold beta content\n');
    const seedProvider = createHttpSeedProvider({ fetch: seedFetch({}), env: {} });

    const context = await getMemoryContext({
      url: 'https://beta.test/',
      taskId: 'task-beta',
      homeDir,
      seedProvider,
    });
    expect(context.readOnly).toBe(true);
    expect(context.diagnostics.join('\n')).toMatch(/incompatible beta schema/i);

    await expect(classifyProduct({
      requested: 'https://beta.test/',
      decision: 'distinct',
      expectedRevision: context.revision,
      homeDir,
    })).rejects.toThrow(/incompatible beta schema/i);

    expect(await readProductFile('beta.test', 'manifest.json', { homeDir })).toBeNull();
    const again = await getMemoryContext({
      url: 'https://beta.test/',
      taskId: 'task-beta-2',
      homeDir,
      seedProvider,
    });
    expect(again.readOnly).toBe(true);
    expect(again.siteMarkdown).toBe('# beta schema\nold beta content\n');
    expect(again.diagnostics.join('\n')).toMatch(/incompatible beta schema/i);
  });

  it('leaves candidate inventory unchanged when the task is a no-op', async () => {
    const { homeDir, sites } = await tempSites();
    const context = await coldStart(homeDir);
    const before = {
      log: (await git(sites, ['log', '--oneline'])).trim(),
      files: (await git(sites, ['ls-files'])).trim(),
      candidates: (await git(sites, ['ls-files', '--', 'example.test/candidates'])).trim(),
      inventory: await listCandidates('example.test', { homeDir }),
      site: await readProductFile('example.test', 'sitemap/SITE.md', { homeDir }),
    };

    const noop = await checkpointMemory({
      product: 'example.test',
      taskId: 'task-1',
      expectedRevision: context.revision,
      reason: 'direct_correction',
      paths: ['sitemap/SITE.md'],
      dispositions: [],
      homeDir,
    });

    expect(noop).toEqual({
      status: 'committed',
      memoryCommit: context.revision,
      provenanceCommit: null,
    });
    expect(await listCandidates('example.test', { homeDir })).toEqual(before.inventory);
    expect(before.inventory).toEqual([]);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(before.site);
    expect((await git(sites, ['log', '--oneline'])).trim()).toBe(before.log);
    expect((await git(sites, ['ls-files'])).trim()).toBe(before.files);
    expect((await git(sites, ['ls-files', '--', 'example.test/candidates'])).trim()).toBe(before.candidates);
    expect(before.files).not.toMatch(/candidates/);
  });

  it('keeps same-date evidence pending, checkpoints later-date and immediate high_consequence, and records dissenting provenance', async () => {
    const { homeDir, sites } = await tempSites();
    await coldStart(homeDir);
    const sameA = await addCandidate(candidate(homeDir, {
      claim: 'Same morning path',
      observedAt: CLOCK.sameMorning,
    }));
    const sameB = await addCandidate(candidate(homeDir, {
      claim: 'Same evening path',
      observedAt: CLOCK.sameEvening,
    }));
    await writeDraft(homeDir, { 'sitemap/SITE.md': `# Example\n\n${FACT}- [verified 2026-08-31] Same day is not enough.\n` });

    await expect(checkpoint(homeDir, await revision(homeDir), {
      dispositions: [
        { id: sameA.id, status: 'ingested', evidenceRole: 'supporting' },
        { id: sameB.id, status: 'ingested', evidenceRole: 'supporting' },
      ],
    })).rejects.toThrow(/date/i);
    expect((await showCandidate('example.test', sameA.id, { homeDir })).status).toBe('pending');
    expect((await showCandidate('example.test', sameB.id, { homeDir })).status).toBe('pending');

    const later = await addCandidate(candidate(homeDir, {
      claim: 'Later path disagrees',
      observedAt: CLOCK.later,
    }));
    const dated = `# Example\n\n${FACT}- [verified 2026-09-01] Keep /new after a later date.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': dated });
    const ingested = await checkpoint(homeDir, await revision(homeDir), {
      dispositions: [
        { id: sameA.id, status: 'ingested', evidenceRole: 'supporting' },
        { id: later.id, status: 'ingested', evidenceRole: 'dissenting' },
      ],
    });
    expect(ingested.status).toBe('committed');
    if (ingested.status !== 'committed') throw new Error('expected commit');
    expect((await showCandidate('example.test', sameA.id, { homeDir }))).toMatchObject({
      status: 'ingested',
      evidenceRole: 'supporting',
      memoryCommit: ingested.memoryCommit,
    });
    expect((await showCandidate('example.test', later.id, { homeDir }))).toMatchObject({
      status: 'ingested',
      evidenceRole: 'dissenting',
      memoryCommit: ingested.memoryCommit,
    });
    expect((await showCandidate('example.test', sameB.id, { homeDir })).status).toBe('pending');
    const provenance = await git(sites, ['show', `HEAD:example.test/candidates/${later.id}.json`]);
    expect(provenance).toMatch(/"status": "ingested"/);
    expect(provenance).toMatch(/"evidence_role": "dissenting"/);
    expect(JSON.parse(provenance).memory_commit).toBe(ingested.memoryCommit);

    const warning = await addCandidate(candidate(homeDir, {
      kind: 'high_consequence',
      claim: 'Ban risk on bulk delete',
      observedAt: CLOCK.later,
    }));
    const warned = `# Example\n\n${FACT}- [verified 2026-09-01] Keep /new after a later date.\n- [verified 2026-09-01] Bulk delete can ban the account.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': warned }, 'task-2');
    const immediate = await checkpoint(homeDir, await revision(homeDir), {
      taskId: 'task-2',
      dispositions: [{ id: warning.id, status: 'ingested', evidenceRole: 'supporting' }],
    });
    expect(immediate.status).toBe('committed');
    expect((await showCandidate('example.test', warning.id, { homeDir })).status).toBe('ingested');
  });

  it('hides candidates and environment values from ordinary legacy listing', async () => {
    const { homeDir } = await tempSites();
    await coldStart(homeDir);
    await writeProductFile('example.test', 'notes.md', 'hello\n', { homeDir });
    const summary = await addCandidate(candidate(homeDir, {
      environment: { publicIp: '203.0.113.9', localIp: '192.168.1.8', machine: 'secret-host' },
    }));

    const listed = await listSiteMemory('example.test', { homeDir });
    const shown = await showSiteMemory('example.test', { homeDir });
    const explicit = await listSiteMemory('example.test', { homeDir, paths: [`candidates/${summary.id}.json`] });

    expect(listed.map((item) => item.path)).not.toContain(`candidates/${summary.id}.json`);
    expect(shown.map((item) => item.path)).not.toContain(`candidates/${summary.id}.json`);
    expect(explicit).toEqual([]);
    expect(JSON.stringify({ listed, shown, explicit })).not.toMatch(/203\.0\.113\.9|192\.168\.1\.8|secret-host/);
    expect((await showCandidate('example.test', summary.id, { homeDir })).environment.publicIp).toBe('203.0.113.9');
    expect((await listCandidates('example.test', { homeDir })).map((item) => item.id)).toEqual([summary.id]);
  });

  it('stays read-only under an ancestor repository and leaves the ancestor untouched', async () => {
    const { homeDir, sites } = await tempSites();
    await mkdir(sites, { recursive: true });
    await git(homeDir, ['init']);
    await git(homeDir, ['-c', 'user.name=owner', '-c', 'user.email=owner@local', 'commit', '--allow-empty', '-m', 'ancestor']);
    const head = (await git(homeDir, ['rev-parse', 'HEAD'])).trim();
    const before = await git(homeDir, ['status', '--porcelain', '-uall']);

    const context = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: createHttpSeedProvider({
        fetch: seedFetch({ 'example.test': { status: 'available', revision: 'seed-1', site: SITE } }),
        env: seedEnv,
      }),
    });

    expect(context.readOnly).toBe(true);
    expect(context.manifest).toBeUndefined();
    expect(context.siteMarkdown).toBe(SITE);
    expect(await readProductFile('example.test', 'manifest.json', { homeDir })).toBeNull();
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBeNull();
    expect((await git(homeDir, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect((await git(homeDir, ['log', '--oneline'])).trim()).toBe(`${head.slice(0, 7)} ancestor`);
    expect(await git(homeDir, ['diff', '--cached'])).toBe(before.includes('\n') ? before : '');
    expect((await git(homeDir, ['status', '--porcelain', '-uall'])).trim()).not.toMatch(/^(A |M |D )/m);
    await expect(addCandidate(candidate(homeDir))).rejects.toThrow(/ancestor/i);
    expect(await jsonNames(sites)).toEqual([]);
  });

  it('keeps an edited draft byte-identical across conflict retry and then publishes it', async () => {
    const { homeDir } = await tempSites();
    const context = await coldStart(homeDir, 'task-1');
    const edited = `# Example\n\n${FACT}- [verified 2026-09-01] IMPORTANT: /del bans the account.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': edited }, 'task-1');
    await addCandidate(candidate(homeDir, { observedAt: CLOCK.later }));

    const conflict = await checkpointMemory({
      product: 'example.test',
      taskId: 'task-1',
      expectedRevision: context.revision,
      reason: 'direct_correction',
      paths: ['sitemap/SITE.md'],
      dispositions: [],
      homeDir,
    });
    expect(conflict.status).toBe('conflict');

    const reloaded = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-1',
      homeDir,
      seedProvider: createHttpSeedProvider({ fetch: seedFetch({}), env: {} }),
    });
    const draft = join(homeDir, '.webcmd/sites/.drafts/task-1/example.test/sitemap/SITE.md');
    expect(await readFile(draft, 'utf8')).toBe(edited);
    expect(reloaded.revision).not.toBe(context.revision);

    const retried = await checkpointMemory({
      product: 'example.test',
      taskId: 'task-1',
      expectedRevision: reloaded.revision,
      reason: 'direct_correction',
      paths: ['sitemap/SITE.md'],
      dispositions: [],
      homeDir,
    });
    expect(retried.status).toBe('committed');
    expect(await readFile(draft, 'utf8')).toBe(edited);
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(edited);
  });

  it('returns a CAS conflict for a competing draft and succeeds after one reload/retry', async () => {
    const { homeDir } = await tempSites();
    const context = await coldStart(homeDir, 'task-a');
    await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-b',
      homeDir,
      seedProvider: createHttpSeedProvider({ fetch: seedFetch({}), env: {} }),
    });
    const aBody = `# Example\n\n${FACT}- [verified 2026-08-31] Task A correction.\n`;
    const bBody = `# Example\n\n${FACT}- [verified 2026-08-31] Task B correction.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': aBody }, 'task-a');
    await writeDraft(homeDir, { 'sitemap/SITE.md': bBody }, 'task-b');

    const first = await checkpointMemory({
      product: 'example.test',
      taskId: 'task-a',
      expectedRevision: context.revision,
      reason: 'direct_correction',
      paths: ['sitemap/SITE.md'],
      dispositions: [],
      homeDir,
    });
    const conflict = await checkpointMemory({
      product: 'example.test',
      taskId: 'task-b',
      expectedRevision: context.revision,
      reason: 'direct_correction',
      paths: ['sitemap/SITE.md'],
      dispositions: [],
      homeDir,
    });

    expect(first.status).toBe('committed');
    if (first.status !== 'committed') throw new Error('expected commit');
    expect(conflict).toEqual({
      status: 'conflict',
      expectedRevision: context.revision,
      actualRevision: first.memoryCommit,
    });
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(aBody);

    const reloaded = await getMemoryContext({
      url: 'https://example.test/',
      taskId: 'task-b',
      homeDir,
      seedProvider: createHttpSeedProvider({ fetch: seedFetch({}), env: {} }),
    });
    expect(reloaded.revision).toBe(first.memoryCommit);
    const retryBody = `# Example\n\n${FACT}- [verified 2026-08-31] Task A correction.\n- [verified 2026-08-31] Task B after reload.\n`;
    await writeDraft(homeDir, { 'sitemap/SITE.md': retryBody }, 'task-b');
    const retried = await checkpointMemory({
      product: 'example.test',
      taskId: 'task-b',
      expectedRevision: reloaded.revision,
      reason: 'direct_correction',
      paths: ['sitemap/SITE.md'],
      dispositions: [],
      homeDir,
    });
    expect(retried.status).toBe('committed');
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(retryBody);
  });

  it('rejects a >500-line SITE.md rewrite unless the draft is at most 200 lines', async () => {
    const { homeDir } = await tempSites();
    const oversized = siteLines(501);
    const context = await coldStart(homeDir, 'task-1', oversized);
    expect((await readProductFile('example.test', 'sitemap/SITE.md', { homeDir }))?.split('\n').filter(Boolean).length).toBe(501);

    await writeDraft(homeDir, { 'sitemap/SITE.md': siteLines(500) });
    await expect(checkpointMemory({
      product: 'example.test',
      taskId: 'task-1',
      expectedRevision: context.revision,
      reason: 'direct_correction',
      paths: ['sitemap/SITE.md'],
      dispositions: [],
      homeDir,
    })).rejects.toThrow(/200|rewrite/i);

    const rewritten = siteLines(200, true);
    await writeDraft(homeDir, {
      'sitemap/SITE.md': rewritten,
      'sitemap/references/listing.md': REF,
    });
    const result = await checkpointMemory({
      product: 'example.test',
      taskId: 'task-1',
      expectedRevision: context.revision,
      reason: 'major_rewrite',
      paths: ['sitemap/SITE.md', 'sitemap/references/listing.md'],
      dispositions: [],
      homeDir,
    });
    expect(result.status).toBe('committed');
    expect(await readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).toBe(rewritten);
    expect(rewritten.split('\n').filter(Boolean)).toHaveLength(200);
  });

  it('keeps concurrent captures, their commits, and unrelated untracked files', async () => {
    const { homeDir, sites } = await tempSites();
    await coldStart(homeDir);
    await writeFile(join(sites, 'keep-me.txt'), 'unrelated\n');
    await writeProductFile('example.test', 'scratch.md', 'also unrelated\n', { homeDir });

    const [a, b] = await Promise.all([
      addCandidate(candidate(homeDir, { claim: 'First concurrent path', observedAt: CLOCK.sameMorning })),
      addCandidate(candidate(homeDir, { claim: 'Second concurrent path', observedAt: CLOCK.sameEvening })),
    ]);

    const files = (await git(sites, ['ls-files', '--', 'example.test/candidates'])).trim().split('\n').sort();
    expect(files).toEqual([`example.test/candidates/${a.id}.json`, `example.test/candidates/${b.id}.json`].sort());
    expect((await git(sites, ['log', '--oneline', '--', `example.test/candidates/${a.id}.json`])).trim().split('\n')).toHaveLength(1);
    expect((await git(sites, ['log', '--oneline', '--', `example.test/candidates/${b.id}.json`])).trim().split('\n')).toHaveLength(1);
    expect(await git(sites, ['status', '--porcelain', '-uall'])).toMatch(/^\?\? keep-me\.txt$/m);
    expect(await git(sites, ['status', '--porcelain', '-uall'])).toMatch(/^\?\? example\.test\/scratch\.md$/m);
    expect((await git(sites, ['ls-files'])).trim().split('\n')).not.toContain('keep-me.txt');
    expect((await git(sites, ['ls-files'])).trim().split('\n')).not.toContain('example.test/scratch.md');
    expect((await git(sites, ['diff', '--cached', '--name-only'])).trim()).toBe('');
  });

  it('rolls back a failed memory commit exactly and recovers a failed provenance commit without replay', async () => {
    const blocked = await tempSites();
    await coldStart(blocked.homeDir);
    const pending = await addCandidate(candidate(blocked.homeDir, { observedAt: CLOCK.earlier }));
    const later = await addCandidate(candidate(blocked.homeDir, { observedAt: CLOCK.later, claim: 'Later' }));
    const next = `# Example\n\n${FACT}- [verified 2026-09-01] Later path is denser.\n`;
    await writeDraft(blocked.homeDir, {
      'sitemap/SITE.md': next,
      'sitemap/references/listing.md': REF,
    });
    const memoryHead = (await git(blocked.sites, ['rev-parse', 'HEAD'])).trim();

    await withGitWrapper(blocked.homeDir, 'memory', async () => {
      await expect(checkpoint(blocked.homeDir, memoryHead, {
        paths: ['sitemap/SITE.md', 'sitemap/references/listing.md'],
        dispositions: [
          { id: pending.id, status: 'ingested', evidenceRole: 'supporting' },
          { id: later.id, status: 'ingested', evidenceRole: 'supporting' },
        ],
      })).rejects.toThrow();
    });

    expect(await readProductFile('example.test', 'sitemap/references/listing.md', { homeDir: blocked.homeDir })).toBeNull();
    expect((await showCandidate('example.test', pending.id, { homeDir: blocked.homeDir })).status).toBe('pending');
    expect((await showCandidate('example.test', later.id, { homeDir: blocked.homeDir })).status).toBe('pending');
    expect((await git(blocked.sites, ['rev-parse', 'HEAD'])).trim()).toBe(memoryHead);
    expect((await git(blocked.sites, ['status', '--porcelain', '-uall'])).trim()).toBe('');
    expect((await git(blocked.sites, ['diff', '--cached', '--name-only'])).trim()).toBe('');

    const { homeDir, sites } = await tempSites();
    await coldStart(homeDir);
    const first = await addCandidate(candidate(homeDir, { observedAt: CLOCK.earlier }));
    const second = await addCandidate(candidate(homeDir, { observedAt: CLOCK.later, claim: 'Later' }));
    await writeDraft(homeDir, { 'sitemap/SITE.md': next });
    const dispositions: CandidateDisposition[] = [
      { id: first.id, status: 'ingested', evidenceRole: 'supporting' },
      { id: second.id, status: 'ingested', evidenceRole: 'supporting' },
    ];

    await withGitWrapper(homeDir, 'provenance', async () => {
      await expect(checkpoint(homeDir, await revision(homeDir), { dispositions })).rejects.toThrow();
    });

    const memoryRevision = (await git(sites, ['rev-parse', 'HEAD'])).trim();
    expect(await git(sites, ['show', 'HEAD:example.test/sitemap/SITE.md'])).toBe(next);
    const siteLog = (await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim();
    expect(siteLog.split('\n')).toHaveLength(2);
    expect((await showCandidate('example.test', first.id, { homeDir })).status).toBe('ingested');

    const resumed = await checkpoint(homeDir, memoryRevision, { dispositions });
    expect(resumed.status).toBe('committed');
    if (resumed.status !== 'committed') throw new Error('expected commit');
    expect(resumed.memoryCommit).toBe(memoryRevision);
    expect(resumed.provenanceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(resumed.provenanceCommit).not.toBe(memoryRevision);
    expect((await git(sites, ['log', '--oneline', '--', 'example.test/sitemap/SITE.md'])).trim()).toBe(siteLog);
    expect((await git(sites, ['show', `HEAD:example.test/candidates/${first.id}.json`]))).toMatch(/"status": "ingested"/);
  });
});

function seedFetch(results: Record<string, SeedLookupResult | 'throw'>): typeof fetch {
  return async (input) => {
    const key = decodeURIComponent(String(input).split('/').pop() ?? '');
    const result = results[key];
    if (result === undefined || result === 'throw') throw new TypeError('offline');
    if (result.status === 'absent') return new Response('missing', { status: 404 });
    if (result.status === 'available') {
      return new Response(JSON.stringify({
        revision: result.revision,
        site: result.site,
        references: result.references,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('fail', { status: 500 });
  };
}

function recordingFetch(inner: typeof fetch) {
  const calls: { url: string; method: string; credentials: RequestInit['credentials']; authorization: string | null }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      credentials: init?.credentials,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return inner(input, init);
  };
  return { fetch, calls };
}

async function coldStart(homeDir: string, taskId = 'task-1', site = SITE) {
  return getMemoryContext({
    url: 'https://example.test/',
    taskId,
    homeDir,
    seedProvider: createHttpSeedProvider({
      fetch: seedFetch({
        'example.test': { status: 'available', revision: 'seed-1', site },
      }),
      env: seedEnv,
    }),
  });
}

async function checkpoint(
  homeDir: string,
  expectedRevision: string | null,
  extra: Partial<CheckpointInput> = {},
) {
  return checkpointMemory({
    product: 'example.test',
    taskId: 'task-1',
    reason: 'candidate_ingestion',
    paths: ['sitemap/SITE.md'],
    dispositions: [],
    ...extra,
    homeDir,
    expectedRevision,
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
    observedAt: CLOCK.sameMorning,
    fetch: async () => {
      throw new TypeError('offline');
    },
    homeDir,
    ...extra,
  };
}

function siteLines(count: number, pointer = false): string {
  const extra = pointer ? [POINTER.trimEnd()] : [];
  const heading = ['# Example'];
  const facts = Array.from({ length: count - heading.length - extra.length }, (_, i) => `- [verified 2026-08-31] Fact ${i}.`);
  return `${[...heading, ...facts, ...extra].join('\n')}\n`;
}

async function learnFromDraft(
  homeDir: string,
  input: { product: string; taskId: string; site: string },
) {
  const pending = await addCandidate(candidate(homeDir, {
    product: input.product,
    hostname: input.product,
    observedAt: CLOCK.later,
    kind: 'high_consequence',
    claim: 'Cold product learned locally',
  }));
  await writeDraft(homeDir, { 'sitemap/SITE.md': input.site }, input.taskId, input.product);
  return checkpointMemory({
    product: input.product,
    taskId: input.taskId,
    expectedRevision: await revision(homeDir),
    reason: 'candidate_ingestion',
    paths: ['sitemap/SITE.md'],
    dispositions: [{ id: pending.id, status: 'ingested', evidenceRole: 'supporting' }],
    homeDir,
  });
}

async function writeDraft(homeDir: string, files: Record<string, string>, taskId = 'task-1', product = 'example.test') {
  for (const [path, body] of Object.entries(files)) {
    const target = join(homeDir, '.webcmd/sites/.drafts', taskId, product, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
}

async function withGitWrapper(homeDir: string, fail: 'memory' | 'provenance', fn: () => Promise<void>) {
  const needle = fail === 'memory' ? 'checkpoint memory' : 'checkpoint provenance';
  const { restore } = installGitShim(async (args, runReal) => {
    const msg = args.includes('-m') ? args[args.indexOf('-m') + 1] : '';
    if (args.includes('commit') && msg.includes(needle)) {
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

async function jsonNames(sites: string): Promise<string[]> {
  try {
    return (await readdir(join(sites, 'example.test', 'candidates'))).filter((name) => name.endsWith('.json')).sort();
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return [];
    throw err;
  }
}

async function tempSites() {
  const homeDir = await mkdtemp(join(tmpdir(), 'webcmd-self-learning-'));
  tempHomes.push(homeDir);
  return { homeDir, sites: join(homeDir, '.webcmd', 'sites') };
}

async function revision(homeDir: string) {
  return (await openSitesRepository({ homeDir })).revision();
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}
