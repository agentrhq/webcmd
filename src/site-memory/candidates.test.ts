import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { addCandidate, listCandidates, searchCandidates, showCandidate } from './candidates.js';
import { listSiteMemory, showSiteMemory, writeProductFile } from './local-store.js';
import type { Candidate } from './model.js';

const run = promisify(execFile);
const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('candidate capture', () => {
  it('writes unique lexical filenames and derives UTC date from offset timestamps', async () => {
    const { homeDir, sites } = await tempSites();
    const first = await addCandidate(base(homeDir, {
      claim: 'Old Reddit is denser',
      observedAt: '2026-08-31T00:30:00+05:30',
    }));
    const second = await addCandidate(base(homeDir, {
      claim: 'RSS skips paging',
      observedAt: '2026-08-31T00:30:01+05:30',
    }));

    const files = (await readdir(join(sites, 'example.test/candidates'))).sort();
    expect(first.id).not.toBe(second.id);
    expect(first.observedDateUtc).toBe('2026-08-30');
    expect(files).toEqual([`${first.id}.json`, `${second.id}.json`]);
    expect(files[0] < files[1]).toBe(true);
    expect(files[0]).toMatch(/^20260830T190000Z-/);
    expect(files[1]).toMatch(/^20260830T190001Z-/);
  });

  it('rejects invalid schema, paths, kinds, and secret-bearing fields', async () => {
    const { homeDir } = await tempSites();

    await expect(addCandidate(base(homeDir, { kind: 'trivial_success' }))).rejects.toThrow(/kind/i);
    await expect(addCandidate(base(homeDir, { product: '../escape' }))).rejects.toThrow(/invalid/i);
    await expect(addCandidate(base(homeDir, { claim: 'Cookie: session=abc' }))).rejects.toThrow(/secret/i);
    await expect(addCandidate({
      ...base(homeDir),
      password: 'hunter2',
    } as Parameters<typeof addCandidate>[0] & { password: string })).rejects.toThrow(/secret/i);
    await expect(showCandidate('example.test', '../manifest.json', { homeDir })).rejects.toThrow(/invalid/i);
  });

  it('captures even when provenance collection fails', async () => {
    const { homeDir } = await tempSites();

    const summary = await addCandidate(base(homeDir, {
      environment: undefined,
      fetch: async () => {
        throw new TypeError('offline');
      },
    }));
    const stored = await showCandidate('example.test', summary.id, { homeDir });

    expect(summary.status).toBe('pending');
    expect(stored.evidence).toBe('Used /new while /hot spun.');
    expect(stored.environment.publicIp).toBeUndefined();
  });

  it('commits each candidate once and keeps concurrent captures', async () => {
    const { homeDir, sites } = await tempSites();
    const [a, b] = await Promise.all([
      addCandidate(base(homeDir, { claim: 'First concurrent path' })),
      addCandidate(base(homeDir, { claim: 'Second concurrent path' })),
    ]);

    const files = (await git(sites, ['ls-files', '--', 'example.test/candidates'])).trim().split('\n').sort();
    expect(files).toEqual([`example.test/candidates/${a.id}.json`, `example.test/candidates/${b.id}.json`].sort());
    expect((await git(sites, ['log', '--oneline', '--', `example.test/candidates/${a.id}.json`])).trim().split('\n')).toHaveLength(1);
    expect((await git(sites, ['log', '--oneline', '--', `example.test/candidates/${b.id}.json`])).trim().split('\n')).toHaveLength(1);
    expect((await git(sites, ['log', '--oneline'])).trim().split('\n')).toHaveLength(2);
  });
});

describe('candidate discovery', () => {
  it('searches pending candidates with compact lexical ranking and hides completed ones', async () => {
    const { homeDir } = await tempSites();
    const ranked = await addCandidate(base(homeDir, {
      hostname: 'old.reddit.com',
      kind: 'better_path',
      claim: 'Old Reddit denser listing',
      consequence: 'Fewer page loads',
    }));
    const weaker = await addCandidate(base(homeDir, {
      hostname: 'www.reddit.com',
      kind: 'access',
      claim: 'Login wall on old posts',
      consequence: 'Need an account',
    }));
    const ingested = await addCandidate(base(homeDir, {
      hostname: 'old.reddit.com',
      kind: 'better_path',
      claim: 'Old Reddit denser listing again',
      consequence: 'Fewer page loads',
    }));
    await markStatus(homeDir, ingested.id, 'ingested');

    const hits = await searchCandidates('example.test', 'old reddit denser', 10, { homeDir });

    expect(hits.map((hit) => hit.id)).toEqual([ranked.id, weaker.id]);
    expect(hits[0]).toEqual(expect.objectContaining({
      id: ranked.id,
      kind: 'better_path',
      hostname: 'old.reddit.com',
      claim: 'Old Reddit denser listing',
      consequence: 'Fewer page loads',
      status: 'pending',
    }));
    expect(hits[0]).not.toHaveProperty('evidence');
    expect(hits[0]).not.toHaveProperty('environment');
    expect(await searchCandidates('example.test', 'old reddit denser', 1, { homeDir })).toEqual([hits[0]]);
    expect((await listCandidates('example.test', { homeDir })).map((item) => item.id).sort()).toEqual(
      [ranked.id, weaker.id, ingested.id].sort(),
    );
  });

  it('hides candidates and raw environment values from ordinary memory listing', async () => {
    const { homeDir } = await tempSites();
    await writeProductFile('example.test', 'notes.md', 'hello\n', { homeDir });
    const summary = await addCandidate(base(homeDir, {
      environment: { publicIp: '203.0.113.9', localIp: '192.168.1.8', machine: 'secret-host' },
    }));

    const listed = await listSiteMemory('example.test', { homeDir });
    const shown = await showSiteMemory('example.test', { homeDir });
    const explicit = await listSiteMemory('example.test', { homeDir, paths: [`candidates/${summary.id}.json`] });

    expect(listed.map((item) => item.path)).toEqual(['notes.md']);
    expect(shown.map((item) => item.path)).toEqual(['notes.md']);
    expect(explicit).toEqual([]);
    expect(JSON.stringify({ listed, shown, explicit })).not.toMatch(/203\.0\.113\.9|192\.168\.1\.8|secret-host/);
    expect((await showCandidate('example.test', summary.id, { homeDir })).environment.publicIp).toBe('203.0.113.9');
  });
});

function base(homeDir: string, extra: Record<string, unknown> = {}) {
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

async function markStatus(homeDir: string, id: string, status: Candidate['status']) {
  const stored = await showCandidate('example.test', id, { homeDir });
  await writeProductFile('example.test', `candidates/${id}.json`, `${JSON.stringify({ ...stored, status }, null, 2)}\n`, { homeDir });
}

async function tempSites() {
  const homeDir = await mkdtemp(join(tmpdir(), 'webcmd-candidates-'));
  tempHomes.push(homeDir);
  return { homeDir, sites: join(homeDir, '.webcmd', 'sites') };
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}
