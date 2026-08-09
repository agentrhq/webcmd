import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addFieldMapping,
  appendNote,
  listSiteMemory,
  markEndpointStale,
  setEndpoint,
  showSiteMemory,
} from './local-store.js';

const tempHomes: string[] = [];
const base = { site: 'example.test' };
const originalHome = process.env.HOME;

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('local site memory store', () => {
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

  it('survives two concurrent appendNote calls', async () => {
    const homeDir = await tempHome();
    await Promise.all([
      appendNote({ ...base, homeDir, text: 'alpha' }),
      appendNote({ ...base, homeDir, text: 'beta' }),
    ]);

    const body = await readNotes(homeDir);
    expect(body).toContain('alpha');
    expect(body).toContain('beta');
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
});

async function tempHome() {
  const dir = await mkdtemp(join(tmpdir(), 'webcmd-site-memory-'));
  tempHomes.push(dir);
  return dir;
}

async function readNotes(homeDir: string) {
  return readFileBody(homeDir, 'notes.md');
}

async function readFileBody(homeDir: string, path: string) {
  const [entry] = await showSiteMemory(base.site, { homeDir, paths: [path] });
  return entry?.body ?? '';
}
