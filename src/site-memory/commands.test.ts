import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalSiteMemoryBackend, registerSiteCommands } from './commands.js';

const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('site commands', () => {
  it('dispatches every local site-memory command through an injected home directory', async () => {
    const homeDir = await tempHome();
    const fixture = join(homeDir, 'fixture.json');
    const sample = join(homeDir, 'sample.json');
    await writeFile(fixture, '{"expect":{"columns":["id"]}}\n');
    await writeFile(sample, '{"items":[{"id":1}]}\n');
    const output = sink();
    const program = siteProgram(homeDir, output.stream);

    await run(program, ['note', 'add', 'example.test', '--text', 'search endpoint works']);
    await run(program, ['endpoint', 'set', 'example.test', 'search', '--url', 'https://example.test/search', '--method', 'GET', '--params', '{"q":"term"}', '--rows-path', 'items', '--fields', 'id,title', '--notes', 'verified']);
    await run(program, ['endpoint', 'stale', 'example.test', 'search']);
    await run(program, ['field-map', 'add', 'example.test', 'num_comments', '--meaning', 'comment count', '--source', 'page']);
    await run(program, ['fixture', 'put', 'example.test/search', fixture]);
    await run(program, ['fixture', 'get', 'example.test/search']);
    await run(program, ['sample', 'add', 'example.test/search', sample]);
    await run(program, ['memory', 'show', 'example.test', '--kind', 'notes']);
    await run(program, ['memory', 'list', 'example.test']);

    const root = join(homeDir, '.webcmd', 'sites', 'example.test');
    await expect(readFile(join(root, 'notes.md'), 'utf8')).resolves.toContain('search endpoint works');
    await expect(readFile(join(root, 'endpoints.json'), 'utf8')).resolves.toContain('"search": {');
    await expect(readFile(join(root, 'endpoints.json'), 'utf8')).resolves.toContain('"stale": true');
    await expect(readFile(join(root, 'field-map.json'), 'utf8')).resolves.toContain('"num_comments"');
    await expect(readFile(join(root, 'verify', 'search.json'), 'utf8')).resolves.toBe('{"expect":{"columns":["id"]}}\n');
    await expect(readdir(join(root, 'fixtures'))).resolves.toEqual([expect.stringMatching(/^search-\d+\.json$/)]);
    expect(output.text()).toContain('search endpoint works');
    expect(output.text()).toContain('"columns":["id"]');
    expect(output.text()).toContain('notes.md');
  });

  it('does not write a file when showing memory', async () => {
    const homeDir = await tempHome();
    const output = sink();
    const program = siteProgram(homeDir, output.stream);

    await run(program, ['memory', 'show', 'cold.example']);

    await expect(readdir(join(homeDir, '.webcmd', 'sites'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(output.text()).toContain('[]');
  });

  it('reports a missing fixture after another local artifact creates the site', async () => {
    const homeDir = await tempHome();
    const program = siteProgram(homeDir, sink().stream);
    await run(program, ['note', 'add', 'example.test', '--text', 'site exists']);

    await expect(run(program, ['fixture', 'get', 'example.test/search']))
      .rejects.toMatchObject({ code: 'SITE_MEMORY_NOT_FOUND' });
  });

  it('makes an existing field mapping actionable', async () => {
    const homeDir = await tempHome();
    const program = siteProgram(homeDir, sink().stream);

    await run(program, ['field-map', 'add', 'example.test', 'num_comments', '--meaning', 'comment count', '--source', 'page']);

    await expect(run(program, ['field-map', 'add', 'example.test', 'num_comments', '--meaning', 'other', '--source', 'guess']))
      .rejects.toThrow('Field mapping num_comments already exists.');
  });

  it('rejects malformed fixtures before calling the backend', async () => {
    const fixture = join(await tempHome(), 'invalid.json');
    await writeFile(fixture, '{"expect":{"columns":"id"}}\n');
    let putCalled = false;
    const program = new Command();
    registerSiteCommands(program, {
      showSiteMemory: async () => [],
      listSiteMemory: async () => [],
      appendNote: async () => undefined,
      setEndpoint: async () => undefined,
      markEndpointStale: async () => undefined,
      addFieldMapping: async () => undefined,
      getFixture: async () => null,
      putFixture: async () => { putCalled = true; },
      addSample: async () => undefined,
    }, { stdout: sink().stream });

    await expect(run(program, ['fixture', 'put', 'example.test/search', fixture])).rejects.toThrow('Fixture field columns is invalid.');
    expect(putCalled).toBe(false);
  });

  it('rejects traversal in fixture site commands', async () => {
    const homeDir = await tempHome();
    const fixture = join(homeDir, 'fixture.json');
    await writeFile(fixture, '{}\n');
    const program = siteProgram(homeDir, sink().stream);

    await expect(run(program, ['fixture', 'put', '../search', fixture])).rejects.toThrow('Site command must use site/command format.');
    await expect(readdir(join(homeDir, '.webcmd'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function siteProgram(homeDir: string, stdout: Writable): Command {
  const program = new Command();
  registerSiteCommands(program, createLocalSiteMemoryBackend({ homeDir }), { stdout });
  return program;
}

async function run(program: Command, argv: string[]): Promise<void> {
  await program.parseAsync(['node', 'webcmd', 'site', ...argv], { from: 'node' });
}

function sink(): { stream: Writable; text: () => string } {
  let output = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    }),
    text: () => output,
  };
}

async function tempHome(): Promise<string> {
  const homeDir = await mkdtemp(join(tmpdir(), 'webcmd-site-commands-'));
  tempHomes.push(homeDir);
  return homeDir;
}
