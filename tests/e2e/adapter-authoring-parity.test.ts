/**
 * E2E coverage for the local-mode portion of the manual QA checklist in
 * https://github.com/agentrhq/webcmd/issues/311 ("validate adapter
 * authoring and override parity in local and hosted modes").
 *
 * Issue #311 is a manual test plan spanning local mode AND a hosted Cloud
 * deployment (API keys, two tenants, hosted browser infra, workspace
 * isolation, marketplace metadata). This file automates everything in that
 * checklist that is testable purely in local mode:
 *   1. Mode boundaries — local commands need no Cloud auth
 *   2. Plugin override / adapter source get/put/path/reset
 *   3. Site memory: notes, endpoints, field maps, fixtures, samples
 *   4. `browser init` / `browser verify` and its flags
 *   5. Mutable input-output files, local mode
 *   8. Regression checks that apply locally
 * Sections 6 (workspace/user isolation) and 7 (hosted marketplace) require a
 * live WebCMD Cloud deployment and are out of scope here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runCli, parseJsonOutput, installFixturePlugin } from './helpers.js';

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-adapter-parity-e2e-'));
const FIXTURE_SITE = 'dictionary';
const FIXTURE_ENV = { HOME: TEST_HOME, USERPROFILE: TEST_HOME };

function run(args: string[], opts: { timeout?: number } = {}) {
  return runCli(args, { ...opts, env: FIXTURE_ENV });
}

describe('adapter authoring & override parity (local mode) — issue #311', () => {
  beforeAll(() => {
    installFixturePlugin(TEST_HOME, FIXTURE_SITE);
  });

  afterAll(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  // ── 1. Mode boundaries: local mode needs no Cloud auth ──────────────────
  describe('1. mode boundaries', () => {
    it('list works with no hosted credentials in the environment', async () => {
      expect(FIXTURE_ENV).not.toHaveProperty('WEBCMD_API_KEY');
      const { stdout, code } = await run(['list', '-f', 'json']);
      expect(code).toBe(0);
      const data = parseJsonOutput(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('plugin list works with no hosted credentials in the environment', async () => {
      const { stdout, code } = await run(['plugin', 'list', '-f', 'json']);
      expect(code).toBe(0);
      const data = parseJsonOutput(stdout);
      expect(data.some((p: any) => p.name === FIXTURE_SITE)).toBe(true);
    });
  });

  // ── 2. Plugin override and adapter source behavior ───────────────────────
  describe('2. plugin override and adapter source', () => {
    const COMMAND = `${FIXTURE_SITE}/search`;

    it('override creates a local editable adapter that status/path/source get agree on', async () => {
      const overridePath = path.join(TEST_HOME, '.webcmd', 'clis', FIXTURE_SITE, 'search.js');
      expect(fs.existsSync(overridePath)).toBe(false);

      const overrideResult = await run(['adapter', 'override', COMMAND]);
      expect(overrideResult.code).toBe(0);
      expect(fs.existsSync(overridePath)).toBe(true);

      const status = await run(['adapter', 'status', '-f', 'json']);
      expect(status.code).toBe(0);
      const entries = parseJsonOutput(status.stdout);
      const entry = entries.find((e: any) => e.command === COMMAND);
      expect(entry).toMatchObject({ kind: 'override', plugin: FIXTURE_SITE, orphaned: false });

      const adapterPath = await run(['adapter', 'path', COMMAND]);
      expect(adapterPath.code).toBe(0);
      expect(adapterPath.stdout.trim()).toBe(overridePath);

      const sourceGet = await run(['adapter', 'source', 'get', COMMAND]);
      expect(sourceGet.code).toBe(0);
      expect(sourceGet.stdout.trim()).toBe(overridePath);
    });

    it('executing the command uses the override, not the plugin copy', async () => {
      const overridePath = path.join(TEST_HOME, '.webcmd', 'clis', FIXTURE_SITE, 'search.js');
      const original = fs.readFileSync(overridePath, 'utf8');
      fs.writeFileSync(overridePath, original.replace(/description:\s*'[^']*'/, "description: 'PARITY_OVERRIDE_MARKER'"));

      const list = await run(['list', '-f', 'json']);
      expect(list.code).toBe(0);
      const data = parseJsonOutput(list.stdout);
      const entry = data.find((c: any) => c.command === COMMAND);
      expect(entry?.description).toBe('PARITY_OVERRIDE_MARKER');
    });

    it('rejects local adapter source get --output without writing anything', async () => {
      const destination = path.join(TEST_HOME, 'should-not-exist.js');
      const { stderr, code } = await run(['adapter', 'source', 'get', COMMAND, '--output', destination]);
      expect(code).toBe(2);
      expect(stderr).toContain(`webcmd adapter path ${COMMAND}`);
      expect(fs.existsSync(destination)).toBe(false);
    });

    it('rejects local adapter source put without modifying the adapter', async () => {
      const overridePath = path.join(TEST_HOME, '.webcmd', 'clis', FIXTURE_SITE, 'search.js');
      const before = fs.readFileSync(overridePath, 'utf8');
      const scratch = path.join(TEST_HOME, 'scratch-source.js');
      fs.writeFileSync(scratch, '// attempted overwrite\n');

      const { stderr, code } = await run(['adapter', 'source', 'put', COMMAND, scratch]);
      expect(code).toBe(2);
      expect(stderr).toContain(`webcmd adapter path ${COMMAND}`);
      expect(fs.readFileSync(overridePath, 'utf8')).toBe(before);
    });

    it('reset removes the override and restores plugin provenance', async () => {
      const overridePath = path.join(TEST_HOME, '.webcmd', 'clis', FIXTURE_SITE, 'search.js');
      const { stdout, code } = await run(['adapter', 'reset', FIXTURE_SITE]);
      expect(code).toBe(0);
      expect(stdout).toContain('Removed local adapter override');
      expect(fs.existsSync(overridePath)).toBe(false);

      const status = await run(['adapter', 'status', '-f', 'json']);
      const entries = parseJsonOutput(status.stdout);
      expect(entries.find((e: any) => e.command === COMMAND)).toBeUndefined();

      const list = await run(['list', '-f', 'json']);
      const data = parseJsonOutput(list.stdout);
      expect(data.find((c: any) => c.command === COMMAND)?.description).not.toBe('PARITY_OVERRIDE_MARKER');
    });

    it('adapter path fails clearly for an unregistered command', async () => {
      const { stderr, code } = await run(['adapter', 'path', `${FIXTURE_SITE}/does-not-exist`]);
      expect(code).toBe(2);
      expect(stderr).toContain('Adapter source is unavailable');
    });
  });

  // ── 3. Site memory: notes, endpoints, field maps, fixtures, samples ─────
  describe('3. site memory', () => {
    const SITE = 'parity-site';
    const COMMAND = `${SITE}/search`;

    it('note add / memory show / memory list round-trip', async () => {
      const note = await run(['site', 'note', 'add', SITE, '--text', 'Manual parity note', '--author', 'e2e-tester']);
      expect(note.code).toBe(0);

      const show = await run(['site', 'memory', 'show', SITE, '--kind', 'notes']);
      expect(show.code).toBe(0);
      const body = parseJsonOutput(show.stdout);
      expect(body[0].body).toContain('Manual parity note');

      const list = await run(['site', 'memory', 'list', SITE]);
      expect(list.code).toBe(0);
      expect(list.stdout).toContain('notes.md');
    });

    it('endpoint set / stale round-trip', async () => {
      const set = await run([
        'site', 'endpoint', 'set', SITE, 'search-api',
        '--url', 'https://example.com/api/search', '--method', 'GET',
        '--params', '{"q":"test"}', '--rows-path', 'items', '--fields', 'title,url',
      ]);
      expect(set.code).toBe(0);

      let show = await run(['site', 'memory', 'show', SITE, '--kind', 'endpoints']);
      let body = parseJsonOutput(show.stdout);
      let endpoints = JSON.parse(body[0].body);
      expect(endpoints['search-api']).toMatchObject({ url: 'https://example.com/api/search', method: 'GET' });
      expect(endpoints['search-api'].stale).not.toBe(true);

      const stale = await run(['site', 'endpoint', 'stale', SITE, 'search-api']);
      expect(stale.code).toBe(0);

      show = await run(['site', 'memory', 'show', SITE, '--kind', 'endpoints']);
      body = parseJsonOutput(show.stdout);
      endpoints = JSON.parse(body[0].body);
      expect(endpoints['search-api'].stale).toBe(true);
    });

    it('marking an unknown endpoint stale fails cleanly instead of crashing', async () => {
      const { stderr, code } = await run(['site', 'endpoint', 'stale', SITE, 'does-not-exist']);
      expect(code).not.toBe(0);
      expect(stderr).toContain('ok: false');
      expect(stderr).toContain('was not found');
      expect(stderr).not.toContain('at Command');
    });

    it('field-map add rejects a duplicate key without --force, accepts it with --force', async () => {
      const first = await run(['site', 'field-map', 'add', SITE, 'items[].title', '--meaning', 'Result title', '--source', 'manual-test']);
      expect(first.code).toBe(0);

      const duplicate = await run(['site', 'field-map', 'add', SITE, 'items[].title', '--meaning', 'dup', '--source', 'manual-test']);
      expect(duplicate.code).not.toBe(0);
      expect(duplicate.stderr).toContain('ok: false');
      expect(duplicate.stderr).toContain('already exists');
      expect(duplicate.stderr).not.toContain('at Command');

      const forced = await run(['site', 'field-map', 'add', SITE, 'items[].title', '--meaning', 'Result title v2', '--source', 'manual-test', '--force']);
      expect(forced.code).toBe(0);

      const show = await run(['site', 'memory', 'show', SITE, '--kind', 'field-map']);
      const body = parseJsonOutput(show.stdout);
      const mapping = JSON.parse(body[0].body);
      expect(mapping['items[].title'].meaning).toBe('Result title v2');
    });

    it('fixture put/get round-trips and rejects invalid fixtures without disturbing the valid one', async () => {
      const goodFixture = path.join(TEST_HOME, 'good-fixture.json');
      const badJsonFixture = path.join(TEST_HOME, 'bad-fixture.json');
      const badRangeFixture = path.join(TEST_HOME, 'bad-range-fixture.json');
      fs.writeFileSync(goodFixture, JSON.stringify({
        args: { q: 'agent' },
        expect: { columns: ['title', 'url'], notEmpty: ['title'], rowCount: { min: 1 } },
      }));
      fs.writeFileSync(badJsonFixture, 'not json');
      fs.writeFileSync(badRangeFixture, JSON.stringify({ expect: { rowCount: { min: 5, max: 1 } } }));

      const put = await run(['site', 'fixture', 'put', COMMAND, goodFixture]);
      expect(put.code).toBe(0);

      const roundtripOut = path.join(TEST_HOME, 'roundtrip.json');
      const get = await run(['site', 'fixture', 'get', COMMAND, '--output', roundtripOut]);
      expect(get.code).toBe(0);
      expect(JSON.parse(fs.readFileSync(roundtripOut, 'utf8'))).toEqual(JSON.parse(fs.readFileSync(goodFixture, 'utf8')));

      const putBadJson = await run(['site', 'fixture', 'put', COMMAND, badJsonFixture]);
      expect(putBadJson.code).not.toBe(0);
      expect(putBadJson.stderr).toContain('valid JSON');

      const putBadRange = await run(['site', 'fixture', 'put', COMMAND, badRangeFixture]);
      expect(putBadRange.code).not.toBe(0);

      // Previous valid fixture must survive both rejected writes.
      const getAfter = await run(['site', 'fixture', 'get', COMMAND]);
      expect(getAfter.code).toBe(0);
      expect(JSON.parse(getAfter.stdout)).toEqual(JSON.parse(fs.readFileSync(goodFixture, 'utf8')));
    });

    it('fixture get on a missing fixture fails cleanly with an empty-result exit code', async () => {
      const { stderr, code } = await run(['site', 'fixture', 'get', `${SITE}/never-written`]);
      expect(code).toBe(66);
      expect(stderr).toContain('ok: false');
      expect(stderr).toContain('was not found');
      expect(stderr).not.toContain('at Command');
    });

    it('sample add stores a response sample under fixtures/', async () => {
      const sampleFile = path.join(TEST_HOME, 'sample.json');
      fs.writeFileSync(sampleFile, JSON.stringify({ items: [{ title: 'x', url: 'y' }] }));
      const { code } = await run(['site', 'sample', 'add', COMMAND, sampleFile]);
      expect(code).toBe(0);

      const list = await run(['site', 'memory', 'list', SITE]);
      expect(list.code).toBe(0);
      expect(list.stdout).toMatch(/fixtures\/search-\d+-/);
    });

    it('rejects a site name that attempts to escape the storage root', async () => {
      const { stderr, code } = await run(['site', 'note', 'add', '../escape-attempt', '--text', 'x']);
      expect(code).not.toBe(0);
      expect(stderr).toContain('ok: false');
      expect(stderr).toContain('Invalid site memory site');
      expect(stderr).not.toContain('at Command');
      expect(fs.existsSync(path.join(TEST_HOME, '.webcmd', 'sites', '..', 'escape-attempt'))).toBe(false);
    });
  });

  // ── 4. Adapter authoring: browser init and verify ────────────────────────
  describe('4. browser init and verify', () => {
    const NAME = 'parityverify/rows';
    const scaffoldPath = path.join(TEST_HOME, '.webcmd', 'clis', 'parityverify', 'rows.js');

    it('init scaffolds an adapter and is idempotent', async () => {
      expect(fs.existsSync(scaffoldPath)).toBe(false);
      const first = await run(['browser', 'init', NAME]);
      expect(first.code).toBe(0);
      expect(first.stdout).toContain('Created:');
      expect(fs.existsSync(scaffoldPath)).toBe(true);

      const second = await run(['browser', 'init', NAME]);
      expect(second.code).toBe(0);
      expect(second.stdout).toContain('already exists');

      const adapterPath = await run(['adapter', 'path', NAME]);
      expect(adapterPath.stdout.trim()).toBe(scaffoldPath);
    }, 20_000);

    it('verify runs the scaffold, reports no fixture, and warns (not fails) on missing memory', async () => {
      const { stdout, code } = await run(['browser', 'verify', NAME, '--no-fixture'], { timeout: 20_000 });
      expect(code).toBe(0);
      expect(stdout).toContain('Adapter runs');
      expect(stdout).toContain('Memory: missing endpoints.json, notes.md');
    }, 20_000);

    it('--strict-memory turns the missing-memory warning into a failure', async () => {
      const { code } = await run(['browser', 'verify', NAME, '--no-fixture', '--strict-memory'], { timeout: 20_000 });
      expect(code).not.toBe(0);
    }, 20_000);

    it('--write-fixture seeds a fixture, --update-fixture is required to overwrite it', async () => {
      const fixturePath = path.join(TEST_HOME, '.webcmd', 'sites', 'parityverify', 'verify', 'rows.json');
      const first = await run(['browser', 'verify', NAME, '--write-fixture'], { timeout: 20_000 });
      expect(first.code).toBe(0);
      expect(first.stdout).toContain('Wrote fixture');
      expect(fs.existsSync(fixturePath)).toBe(true);

      const second = await run(['browser', 'verify', NAME, '--write-fixture'], { timeout: 20_000 });
      expect(second.code).toBe(0);
      expect(second.stdout).toContain('already exists');
      expect(second.stdout).toContain('--update-fixture');

      const third = await run(['browser', 'verify', NAME, '--update-fixture'], { timeout: 20_000 });
      expect(third.code).toBe(0);
      expect(third.stdout).toContain('Updated fixture');
    }, 30_000);

    it('rejects a non-positive --max-top-level-keys client-side', async () => {
      const { stderr, code } = await run(['browser', 'verify', NAME, '--no-fixture', '--max-top-level-keys', '0']);
      expect(code).toBe(2);
      expect(stderr).toContain('--max-top-level-keys must be a positive integer');
    });

    it('an invalid --trace mode fails the run instead of silently succeeding', async () => {
      const { code } = await run(['browser', 'verify', NAME, '--no-fixture', '--trace', 'bogus'], { timeout: 20_000 });
      expect(code).not.toBe(0);
    }, 20_000);

    it('--seed-args seeds adapter args when no fixture is used', async () => {
      const { code } = await run(['browser', 'verify', NAME, '--no-fixture', '--seed-args', '{"limit":2}'], { timeout: 20_000 });
      expect(code).toBe(0);
    }, 20_000);
  });

  // ── 5. Mutable input-output files, local mode ─────────────────────────────
  describe('5. mutable input-output files', () => {
    const filetestDir = path.join(TEST_HOME, '.webcmd', 'clis', 'filetest');

    beforeAll(() => {
      fs.mkdirSync(filetestDir, { recursive: true });
      fs.writeFileSync(path.join(filetestDir, 'resume.js'), `
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import * as fs from 'node:fs';

cli({
  site: 'filetest',
  name: 'resume',
  description: 'mutable input-output file test adapter',
  access: 'write',
  example: 'webcmd filetest resume --resume-file /tmp/x.json',
  domain: 'filetest',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'resume-file', type: 'string', required: false, file: { direction: 'input-output', pathKind: 'file', multiple: false, contentTypes: ['application/json'] }, help: 'Resume file' },
  ],
  columns: ['status', 'count', 'path'],
  func: async (kwargs) => {
    const filePath = kwargs['resume-file'];
    let state = { count: 0 };
    if (filePath && fs.existsSync(filePath)) {
      state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    state.count += 1;
    if (filePath) fs.writeFileSync(filePath, JSON.stringify(state));
    return [{ status: 'ok', count: state.count, path: filePath ?? null }];
  },
});
`);
    });

    it('a missing mutable file is created by the command', async () => {
      const resumeFile = path.join(TEST_HOME, 'resume-missing.json');
      expect(fs.existsSync(resumeFile)).toBe(false);

      const { stdout, code } = await run(['filetest', 'resume', '--resume-file', resumeFile, '-f', 'json']);
      expect(code).toBe(0);
      const rows = parseJsonOutput(stdout);
      expect(rows[0]).toMatchObject({ status: 'ok', count: 1, path: resumeFile });
      expect(JSON.parse(fs.readFileSync(resumeFile, 'utf8'))).toEqual({ count: 1 });
    });

    it('local mode passes the same path directly for an existing mutable file, and state persists across runs', async () => {
      const resumeFile = path.join(TEST_HOME, 'resume-existing.json');
      fs.writeFileSync(resumeFile, JSON.stringify({ count: 5 }));

      const { stdout, code } = await run(['filetest', 'resume', '--resume-file', resumeFile, '-f', 'json']);
      expect(code).toBe(0);
      const rows = parseJsonOutput(stdout);
      expect(rows[0]).toMatchObject({ status: 'ok', count: 6, path: resumeFile });
      expect(JSON.parse(fs.readFileSync(resumeFile, 'utf8'))).toEqual({ count: 6 });
    });

    it('an ordinary command with no file argument still works unaffected', async () => {
      const { code } = await run(['filetest', 'resume', '-f', 'json']);
      expect(code).toBe(0);
    });
  });

  // ── 8. Regression checks (local-testable subset) ─────────────────────────
  describe('8. regressions', () => {
    it('unsupported output format on a built-in command produces a clean usage error', async () => {
      const { stderr, code } = await run(['adapter', 'status', '-f', 'xml']);
      expect(code).toBe(2);
      expect(stderr).toContain('Unknown output format "xml"');
    });

    it('site memory writes cannot escape their storage root via a crafted command key', async () => {
      const fixtureFile = path.join(TEST_HOME, 'escape-fixture.json');
      fs.writeFileSync(fixtureFile, JSON.stringify({ expect: {} }));
      const { stderr, code } = await run(['site', 'fixture', 'put', 'sitex/../../etc/passwd', fixtureFile]);
      expect(code).not.toBe(0);
      expect(stderr).toContain('site/command format');
    });
  });
});
