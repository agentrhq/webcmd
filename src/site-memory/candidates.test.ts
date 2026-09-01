import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { addCandidate, listCandidates, searchCandidates, showCandidate } from './candidates.js';
import { installGitShim } from './git-shim.js';
import { openSitesRepository } from './git-store.js';
import { listSiteMemory, readProductFile, showSiteMemory, writeProductFile } from './local-store.js';
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

  it('refuses capturing a.test while b.test is pre-staged', async () => {
    const { homeDir, sites } = await tempSites();
    await writeProductFile('a.test', 'manifest.json', '{}\n', { homeDir });
    await writeProductFile('b.test', 'sitemap/SITE.md', '# B\n\nUNVALIDATED user text with no date and secrets: password=hunter2\n', { homeDir });
    await (await openSitesRepository({ homeDir })).commit(['a.test/manifest.json'], 'init a');
    await git(sites, ['add', '--', 'b.test/sitemap/SITE.md']);
    const stagedBefore = await git(sites, ['diff', '--cached', '--name-only', '-z']);

    await expect(addCandidate(base(homeDir, { product: 'a.test', hostname: 'a.test' }))).rejects.toThrow(/staged/i);

    expect(await git(sites, ['diff', '--cached', '--name-only', '-z'])).toBe(stagedBefore);
    expect((await git(sites, ['ls-tree', '-r', '--name-only', 'HEAD'])).trim().split('\n')).not.toContain('b.test/sitemap/SITE.md');
    expect((await git(sites, ['log', '-1', '--format=%s'])).trim()).toBe('init a');
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

  it('persists the approved snake_case candidate schema', async () => {
    const { homeDir } = await tempSites();
    const summary = await addCandidate(base(homeDir, {
      observedAt: '2026-08-31T14:23:00+05:30',
      environment: {
        machine: 'box',
        localIp: '192.168.1.8',
        publicIp: '203.0.113.9',
        os: 'Darwin 24.0',
        browserVersion: '1.61.1',
        webcmdVersion: '0.7.11',
      },
    }));

    const raw = JSON.parse(await readProductFile('example.test', `candidates/${summary.id}.json`, { homeDir }) ?? '');
    expect(raw).toEqual({
      schema_version: 1,
      id: summary.id,
      domain: 'example.test',
      hostname: 'www.example.test',
      observed_at: '2026-08-31T14:23:00+05:30',
      observed_date_utc: '2026-08-31',
      kind: 'better_path',
      claim: 'New listing is faster',
      evidence: 'Used /new while /hot spun.',
      consequence: 'Prefer /new for fresh posts',
      environment: {
        machine: 'box',
        local_ip: '192.168.1.8',
        public_ip: '203.0.113.9',
        os: 'Darwin 24.0',
        browser_version: '1.61.1',
        webcmd_version: '0.7.11',
      },
      status: 'pending',
      evidence_role: null,
      memory_commit: null,
      reviewed_at: null,
      rejection_reason: null,
    });
  });

  it('fails closed on malformed, unknown, secret, and mismatched candidate JSON', async () => {
    const { homeDir } = await tempSites();
    const summary = await addCandidate(base(homeDir));
    const path = `candidates/${summary.id}.json`;
    const raw = JSON.parse(await readProductFile('example.test', path, { homeDir }) ?? '');

    await writeProductFile('example.test', 'candidates/not-json.json', '{\n', { homeDir });
    await expect(showCandidate('example.test', 'not-json', { homeDir })).rejects.toThrow(/invalid|json|parse/i);
    await expect(listCandidates('example.test', { homeDir })).rejects.toThrow(/invalid|json|parse/i);
    await expect(searchCandidates('example.test', 'listing', 10, { homeDir })).rejects.toThrow(/invalid|json|parse/i);

    await writeProductFile('example.test', 'candidates/not-json.json', `${JSON.stringify({ ...raw, extra: true }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', 'not-json', { homeDir })).rejects.toThrow(/invalid/i);

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, schema_version: 2 }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/schema/i);

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, status: 'draft' }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/status/i);

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, evidence_role: 'maybe' }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/role/i);

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, kind: 'trivial_success' }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/kind/i);

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, cookie: 'session' }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/secret/i);

    await writeProductFile('example.test', `candidates/other-id.json`, `${JSON.stringify(raw, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', 'other-id', { homeDir })).rejects.toThrow(/mismatch|invalid/i);

    await expect(addCandidate(base(homeDir, { environment: { cookie: 'session' } }))).rejects.toThrow(/secret/i);
    await expect(addCandidate(base(homeDir, { environment: { extra: 'nope' } }))).rejects.toThrow(/environment|invalid/i);
    await expect(addCandidate(base(homeDir, { environment: { localIp: { nested: true } } }))).rejects.toThrow(/environment|invalid/i);
    await expect(addCandidate(base(homeDir, { environment: { machine: 'password: hunter2' } }))).rejects.toThrow(/secret/i);
  });

  it('rejects invalid timestamps, hosts, environment secrets, and status metadata', async () => {
    const { homeDir } = await tempSites();
    const summary = await addCandidate(base(homeDir, { observedAt: '2026-08-31T14:23:00+05:30' }));
    const path = `candidates/${summary.id}.json`;
    const raw = JSON.parse(await readProductFile('example.test', path, { homeDir }) ?? '');

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, observed_at: 'not-a-timestamp' }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/observed_at|timestamp|invalid/i);

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, observed_date_utc: '2026-08-30' }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/observed_date_utc|invalid/i);

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, hostname: 'not a host' }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/hostname|invalid/i);

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, domain: 'www.example.test' }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/domain|invalid/i);

    await writeProductFile('example.test', path, `${JSON.stringify({
      ...raw,
      environment: { ...raw.environment, machine: 'password: hunter2' },
    }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/secret/i);

    await writeProductFile('example.test', path, `${JSON.stringify({ ...raw, evidence_role: 'supporting' }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/status|role|invalid/i);

    await writeProductFile('example.test', path, `${JSON.stringify({
      ...raw,
      status: 'ingested',
      evidence_role: 'supporting',
      memory_commit: 'abc',
      reviewed_at: '2026-08-31T14:23:00Z',
      rejection_reason: 'nope',
    }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/status|rejection|invalid/i);

    await writeProductFile('example.test', path, `${JSON.stringify({
      ...raw,
      status: 'ingested',
      evidence_role: null,
      memory_commit: 'abc',
      reviewed_at: '2026-08-31T14:23:00Z',
      rejection_reason: null,
    }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/status|role|invalid/i);

    await writeProductFile('example.test', path, `${JSON.stringify({
      ...raw,
      status: 'rejected',
      evidence_role: null,
      memory_commit: null,
      reviewed_at: null,
      rejection_reason: 'transient',
    }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/status|reviewed|invalid/i);

    await writeProductFile('example.test', path, `${JSON.stringify({
      ...raw,
      status: 'rejected',
      evidence_role: 'dissenting',
      memory_commit: null,
      reviewed_at: '2026-08-31T14:23:00Z',
      rejection_reason: 'transient',
    }, null, 2)}\n`, { homeDir });
    await expect(showCandidate('example.test', summary.id, { homeDir })).rejects.toThrow(/status|role|invalid/i);
  });

  it('does not leave a staged candidate after commit failure', async () => {
    const { homeDir, sites } = await tempSites();
    await mkdir(sites, { recursive: true });
    await writeFile(join(sites, 'keep-me.txt'), 'unrelated\n');
    const { dir, restore } = await installGitShim((git) => `
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('commit')) process.exit(1);
const result = spawnSync(${JSON.stringify(git)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    tempHomes.push(dir);
    try {
      await expect(addCandidate(base(homeDir))).rejects.toThrow();
    } finally {
      restore();
    }

    expect(await jsonNames(sites)).toEqual([]);
    expect((await git(sites, ['ls-files', '--stage'])).trim()).toBe('');
    expect(await git(sites, ['status', '--porcelain', '-uall'])).toMatch(/^\?\? keep-me\.txt$/m);
    expect(await git(sites, ['status', '--porcelain', '-uall'])).not.toMatch(/candidates/);
  });

  it('does not leave an uncommitted candidate when git open or commit fails', async () => {
    const ancestor = await tempSites();
    await mkdir(ancestor.sites, { recursive: true });
    await git(ancestor.homeDir, ['init']);
    await expect(addCandidate(base(ancestor.homeDir))).rejects.toThrow(/ancestor/i);
    expect(await jsonNames(ancestor.sites)).toEqual([]);

    const { homeDir, sites } = await tempSites();
    const kept = await addCandidate(base(homeDir, { claim: 'Keep concurrent unique capture' }));
    await writeProductFile('example.test', `candidates/${kept.id}.json`, 'dirty\n', { homeDir });
    await expect(addCandidate(base(homeDir, { claim: 'Transient uncommitted row' }))).rejects.toThrow(/unrelated/i);
    expect(await jsonNames(sites)).toEqual([`${kept.id}.json`]);
  });

  it.skipIf(process.platform === 'win32')('reports non-ENOENT cleanup errors after a failed commit', async () => {
    const { homeDir, sites } = await tempSites();
    const candidatesDir = join(sites, 'example.test', 'candidates');
    const { dir, restore } = await installGitShim((git) => `
const { chmodSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('commit')) {
  try { chmodSync(${JSON.stringify(candidatesDir)}, 0o555); } catch {}
  process.exit(1);
}
const result = spawnSync(${JSON.stringify(git)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    tempHomes.push(dir);
    try {
      await expect(addCandidate(base(homeDir))).rejects.toThrow(/EACCES|EPERM|permission denied/i);
    } finally {
      restore();
      await chmod(candidatesDir, 0o755).catch(() => undefined);
    }
  });

  it('validates and hard-caps search limit with deterministic ordering', async () => {
    const { homeDir } = await tempSites();
    await expect(searchCandidates('example.test', 'listing', 0, { homeDir })).rejects.toThrow(/limit/i);
    await expect(searchCandidates('example.test', 'listing', -1, { homeDir })).rejects.toThrow(/limit/i);
    await expect(searchCandidates('example.test', 'listing', 1.5, { homeDir })).rejects.toThrow(/limit/i);

    const earlier = await addCandidate(base(homeDir, {
      claim: 'Equal score path',
      observedAt: '2026-08-31T01:00:00Z',
    }));
    const later = await addCandidate(base(homeDir, {
      claim: 'Equal score path',
      observedAt: '2026-08-31T02:00:00Z',
    }));
    const ordered = await searchCandidates('example.test', 'equal score path', 10, { homeDir });
    expect(ordered.map((hit) => hit.id)).toEqual([earlier.id, later.id]);

    await Promise.all(Array.from({ length: 21 }, (_, index) => addCandidate(base(homeDir, {
      claim: `Cap row ${index}`,
      observedAt: `2026-08-31T03:00:${String(index).padStart(2, '0')}Z`,
    }))));
    const capped = await searchCandidates('example.test', 'cap row', 999, { homeDir });
    expect(capped).toHaveLength(20);
    expect(capped.map((hit) => hit.id)).toEqual([...capped].sort((a, b) => (
      a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id)
    )).map((hit) => hit.id).slice(0, 20));
  }, 20_000);
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
  const path = `candidates/${id}.json`;
  const body = await readProductFile('example.test', path, { homeDir });
  if (body === null) throw new Error(`missing ${id}`);
  const raw = JSON.parse(body) as Record<string, unknown>;
  raw.status = status;
  if (status === 'ingested') {
    raw.evidence_role = 'supporting';
    raw.memory_commit = 'abc';
    raw.reviewed_at = '2026-08-31T14:23:00Z';
    raw.rejection_reason = null;
  } else if (status === 'rejected') {
    raw.evidence_role = null;
    raw.memory_commit = null;
    raw.reviewed_at = '2026-08-31T14:23:00Z';
    raw.rejection_reason = 'transient';
  }
  await writeProductFile('example.test', path, `${JSON.stringify(raw, null, 2)}\n`, { homeDir });
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
  const homeDir = await mkdtemp(join(tmpdir(), 'webcmd-candidates-'));
  tempHomes.push(homeDir);
  return { homeDir, sites: join(homeDir, '.webcmd', 'sites') };
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}
