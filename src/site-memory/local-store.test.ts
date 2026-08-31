import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addFieldMapping,
  addResponseSample,
  appendNote,
  copyDraftFiles,
  getVerifyFixture,
  listProductKeys,
  listSiteMemory,
  markEndpointStale,
  putVerifyFixture,
  readProductFile,
  setEndpoint,
  showSiteMemory,
  writeProductFile,
} from './local-store.js';

const tempHomes: string[] = [];
const base = { site: 'example.test' };
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  await rm(join(process.cwd(), '.webcmd/sites/no-home.test'), { recursive: true, force: true });
});

describe('local site memory store', () => {
  it('atomically stores valid verify fixtures and response samples', async () => {
    const homeDir = await tempHome();
    await putVerifyFixture({ ...base, homeDir, command: 'search', body: '{"expect":{"columns":["id"]}}\n' });
    await addResponseSample({ ...base, homeDir, command: 'search', body: '{"items":[{"id":1}]}\n' });

    await expect(getVerifyFixture(base.site, 'search', { homeDir })).resolves.toBe('{"expect":{"columns":["id"]}}\n');
    await expect(listSiteMemory(base.site, { homeDir })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'verify/search.json' }),
      expect.objectContaining({ path: expect.stringMatching(/^fixtures\/search-/) }),
    ]));
  });

  it('does not follow a fixture symlink outside site memory', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, homeDir, text: 'hello' });
    const outside = join(homeDir, 'outside.json');
    await writeFile(outside, '{"secret":true}\n');
    await symlink(outside, join(homeDir, '.webcmd/sites', base.site, 'verify', 'search.json'));

    await expect(getVerifyFixture(base.site, 'search', { homeDir })).rejects.toThrow(/Invalid site memory path/);
  });

  it('does not write through a symlinked fixture directory', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, homeDir, text: 'hello' });
    const root = join(homeDir, '.webcmd/sites', base.site);
    const outside = join(homeDir, 'outside');
    await mkdir(outside);
    await rm(join(root, 'verify'), { recursive: true });
    await symlink(outside, join(root, 'verify'));

    await expect(putVerifyFixture({ ...base, homeDir, command: 'search', body: '{"expect":{"columns":["id"]}}' }))
      .rejects.toThrow(/Invalid site memory path/);
  });

  it('rejects invalid verify fixture shapes before storing them', async () => {
    const homeDir = await tempHome();
    await expect(putVerifyFixture({ ...base, homeDir, command: 'search', body: '{"expect":{"columns":42}}' }))
      .rejects.toThrow(/Fixture field columns is invalid/);
  });

  it('prepends a dated section and preserves earlier entries', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, text: 'first', homeDir });
    await appendNote({ ...base, text: 'second', homeDir });

    const body = await readNotes(homeDir);
    expect(body.indexOf('second')).toBeLessThan(body.indexOf('first'));
    expect(body).toMatch(/^## \d{4}-\d{2}-\d{2} by /);
  });

  it('generates the dated header rather than trusting caller text', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, text: '## 1999-01-01 by someone\nbody', homeDir });

    await expect(readNotes(homeDir)).resolves.toMatch(/^## \d{4}-\d{2}-\d{2} by webcmd-agent/);
  });

  it('stamps verified_at on an endpoint upsert', async () => {
    const homeDir = await tempHome();
    await setEndpoint({
      ...base,
      homeDir,
      name: 'search',
      url: 'https://example.test/search',
      method: 'GET',
      params: { q: 'term' },
      rowsPath: 'items',
      sampleFields: ['id'],
      notes: 'works',
    });

    const endpoints = JSON.parse(await readFileBody(homeDir, 'endpoints.json'));
    expect(endpoints.search).toMatchObject({
      url: 'https://example.test/search',
      method: 'GET',
      verified_at: expect.any(String),
    });
  });

  it('cannot delete an endpoint - stale marks it and keeps the record', async () => {
    const homeDir = await tempHome();
    await setEndpoint({ ...base, homeDir, name: 'search', url: 'https://example.test/search', method: 'GET' });
    await markEndpointStale({ ...base, homeDir, name: 'search' });

    const endpoints = JSON.parse(await readFileBody(homeDir, 'endpoints.json'));
    expect(endpoints.search).toBeDefined();
    expect(endpoints.search.stale).toBe(true);
  });

  it('refuses to overwrite an existing field mapping without force', async () => {
    const homeDir = await tempHome();
    await addFieldMapping({ ...base, homeDir, key: 'num_comments', meaning: 'commentCount', source: 'page' });

    await expect(addFieldMapping({ ...base, homeDir, key: 'num_comments', meaning: 'other', source: 'guess' }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('overwrites an existing field mapping with force', async () => {
    const homeDir = await tempHome();
    await addFieldMapping({ ...base, homeDir, key: 'num_comments', meaning: 'commentCount', source: 'page' });
    await addFieldMapping({ ...base, homeDir, key: 'num_comments', meaning: 'other', source: 'guess', force: true });

    await expect(readFileBody(homeDir, 'field-map.json')).resolves.toMatch(/"meaning": "other"/);
  });

  it('survives two concurrent in-process appendNote calls', async () => {
    const homeDir = await tempHome();
    await Promise.all([
      appendNote({ ...base, homeDir, text: 'alpha' }),
      appendNote({ ...base, homeDir, text: 'beta' }),
    ]);

    const body = await readNotes(homeDir);
    expect(body).toContain('alpha');
    expect(body).toContain('beta');
  });

  it('keeps every note when separate processes append at the same time', async () => {
    const homeDir = await tempHome();

    await runWriters(homeDir, 'note');

    const body = await readNotes(homeDir);
    for (const text of expectedWrites('note')) expect(body).toContain(text);
  }, 120_000);

  it('keeps every endpoint when separate processes write at the same time', async () => {
    const homeDir = await tempHome();

    await runWriters(homeDir, 'endpoint');

    const endpoints = JSON.parse(await readFileBody(homeDir, 'endpoints.json'));
    expect(Object.keys(endpoints).sort()).toEqual(expectedWrites('endpoint').sort());
  }, 120_000);

  it('hides write lock markers from readers', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, homeDir, text: 'hello' });
    await writeFile(join(homeDir, '.webcmd/sites', base.site, 'notes.md.lock'), '{"pid":1}\n');

    await expect(showSiteMemory(base.site, { homeDir })).resolves.toEqual([
      expect.objectContaining({ path: 'notes.md' }),
    ]);
    await expect(listSiteMemory(base.site, { homeDir })).resolves.toEqual([
      expect.objectContaining({ path: 'notes.md' }),
    ]);
  });

  it('uses the injected home instead of the real home directory', async () => {
    const homeDir = await tempHome();
    process.env.HOME = await tempHome();
    await appendNote({ ...base, homeDir, text: 'isolated' });

    await expect(readNotes(homeDir)).resolves.toContain('isolated');
    await expect(showSiteMemory(base.site)).resolves.toEqual([]);
  });

  it('shows site memory bodies', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, homeDir, text: 'hello' });

    await expect(showSiteMemory(base.site, { homeDir })).resolves.toEqual([
      expect.objectContaining({ path: 'notes.md', body: expect.stringContaining('hello') }),
    ]);
  });

  it('lists site memory metadata', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, homeDir, text: 'hello' });
    await writeFile(join(homeDir, '.webcmd/sites', base.site, 'verify/search.json'), '{"ok":true}\n');

    const notes = await readNotes(homeDir);
    await expect(listSiteMemory(base.site, { homeDir })).resolves.toEqual([
      {
        path: 'notes.md',
        byteSize: Buffer.byteLength(notes),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        sha256: createHash('sha256').update(notes).digest('hex'),
      },
      {
        path: 'verify/search.json',
        byteSize: Buffer.byteLength('{"ok":true}\n'),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        sha256: createHash('sha256').update('{"ok":true}\n').digest('hex'),
      },
    ]);
  });

  it('hides in-directory temp writes from readers', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, homeDir, text: 'hello' });
    await writeFile(
      join(homeDir, '.webcmd/sites', base.site, '.notes.md.123.11111111-1111-4111-8111-111111111111.tmp'),
      'partial',
    );

    await expect(showSiteMemory(base.site, { homeDir })).resolves.toEqual([
      expect.objectContaining({ path: 'notes.md' }),
    ]);
    await expect(listSiteMemory(base.site, { homeDir })).resolves.toEqual([
      expect.objectContaining({ path: 'notes.md' }),
    ]);
  });

  it('rejects requested symlink paths instead of reading outside the site root', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, homeDir, text: 'hello' });
    const outside = join(homeDir, 'outside.json');
    await writeFile(outside, '{"secret":true}\n');
    await symlink(outside, join(homeDir, '.webcmd/sites', base.site, 'inside-link'));

    await expect(showSiteMemory(base.site, { homeDir, paths: ['inside-link'] })).rejects.toThrow(/Invalid site memory path/);
    await expect(listSiteMemory(base.site, { homeDir, paths: ['inside-link'] })).rejects.toThrow(/Invalid site memory path/);
  });

  it('rejects requested paths through a symlinked directory', async () => {
    const homeDir = await tempHome();
    await appendNote({ ...base, homeDir, text: 'hello' });
    const outsideDir = join(homeDir, 'outside-dir');
    await mkdir(outsideDir);
    await writeFile(join(outsideDir, 'secret.txt'), 'secret');
    await symlink(outsideDir, join(homeDir, '.webcmd/sites', base.site, 'linkdir'));

    await expect(showSiteMemory(base.site, { homeDir, paths: ['linkdir/secret.txt'] })).rejects.toThrow(/Invalid site memory path/);
    await expect(listSiteMemory(base.site, { homeDir, paths: ['linkdir/secret.txt'] })).rejects.toThrow(/Invalid site memory path/);
  });

  it('writes and reads a contained product file', async () => {
    const homeDir = await tempHome();
    await writeProductFile('example.test', 'sitemap/SITE.md', '# Example\n', { homeDir });

    await expect(readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).resolves.toBe('# Example\n');
  });

  it('rejects a product path that escapes the sites root', async () => {
    const homeDir = await tempHome();

    await expect(writeProductFile('example.test', '../outside.md', 'nope\n', { homeDir }))
      .rejects.toThrow(/Invalid site memory path/);
    await expect(readProductFile('example.test', '../outside.md', { homeDir }))
      .rejects.toThrow(/Invalid site memory path/);
  });

  it('copies contained draft files into product memory', async () => {
    const homeDir = await tempHome();
    const draft = join(homeDir, '.webcmd/sites/.drafts/task-1/example.test/sitemap/SITE.md');
    await mkdir(join(draft, '..'), { recursive: true });
    await writeFile(draft, '# Draft\n');

    await copyDraftFiles('example.test', 'task-1', ['sitemap/SITE.md'], { homeDir });

    await expect(readProductFile('example.test', 'sitemap/SITE.md', { homeDir })).resolves.toBe('# Draft\n');
  });

  it('lists product keys while skipping .git, .drafts, and other dot entries', async () => {
    const homeDir = await tempHome();
    await writeProductFile('example.test', 'manifest.json', '{}\n', { homeDir });
    const sites = join(homeDir, '.webcmd/sites');
    await mkdir(join(sites, '.git'), { recursive: true });
    await mkdir(join(sites, '.drafts', 'task'), { recursive: true });
    await mkdir(join(sites, '.cache'), { recursive: true });
    await writeFile(join(sites, '.hidden'), 'nope');

    await expect(listProductKeys({ homeDir })).resolves.toEqual(['example.test']);
  });

  it('uses USERPROFILE instead of writing under cwd when HOME is unset', async () => {
    const homeDir = await tempHome();
    delete process.env.HOME;
    process.env.USERPROFILE = homeDir;

    await appendNote({ site: 'no-home.test', text: 'nope' });

    await expect(showSiteMemory('no-home.test', { homeDir })).resolves.toEqual([
      expect.objectContaining({ path: 'notes.md', body: expect.stringContaining('nope') }),
    ]);
    await expect(showSiteMemory('no-home.test', { homeDir: process.cwd() })).resolves.toEqual([]);
  });
});

async function tempHome() {
  const dir = await mkdtemp(join(tmpdir(), 'webcmd-site-memory-'));
  tempHomes.push(dir);
  return dir;
}

const WRITER_PROCESSES = 6;
const WRITES_PER_PROCESS = 4;
const run = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * The in-process promise chain cannot see another `webcmd` invocation, so the
 * only way to cover the read-modify-write race is to run real processes. Each
 * child writes several times to widen the window they can interleave in.
 */
async function runWriters(homeDir: string, mode: 'note' | 'endpoint') {
  const script = fileURLToPath(new URL('./__fixtures__/concurrent-writer.mts', import.meta.url));
  await Promise.all(Array.from({ length: WRITER_PROCESSES }, (_unused, index) => run(
    process.execPath,
    [require.resolve('tsx/cli'), script, homeDir, base.site, mode, `w${index}`, String(WRITES_PER_PROCESS)],
    { env: { ...process.env, HOME: homeDir } },
  )));
}

function expectedWrites(mode: 'note' | 'endpoint'): string[] {
  return Array.from({ length: WRITER_PROCESSES }, (_unused, index) => index).flatMap((index) => (
    Array.from({ length: WRITES_PER_PROCESS }, (_item, write) => `${mode}-w${index}-${write}`)
  ));
}

async function readNotes(homeDir: string) {
  return readFileBody(homeDir, 'notes.md');
}

async function readFileBody(homeDir: string, path: string) {
  const [entry] = await showSiteMemory(base.site, { homeDir, paths: [path] });
  return entry?.body ?? '';
}
