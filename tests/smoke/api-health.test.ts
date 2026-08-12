/**
 * Smoke tests for external API health.
 * Only run on schedule or manual dispatch — NOT on every push/PR.
 * These verify that external APIs haven't changed their structure.
 *
 * hackernews is no longer bundled in core; it's installed as a local plugin
 * into an isolated HOME before this suite runs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseJsonOutput, runCli as runCliBase, installFixturePlugin } from '../e2e/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-smoke-e2e-'));
const FIXTURE_ENV = { HOME: TEST_HOME, USERPROFILE: TEST_HOME };

function runCli(args: string[], opts: { timeout?: number; env?: Record<string, string> } = {}) {
  return runCliBase(args, { ...opts, env: { ...FIXTURE_ENV, ...opts.env } });
}

describe('API health smoke tests', () => {
  beforeAll(() => {
    installFixturePlugin(TEST_HOME, 'hackernews');
  });

  afterAll(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  // ── Public API commands (should always work) ──
  it('hackernews API is responsive and returns expected structure', async () => {
    const { stdout, code } = await runCli(['hackernews', 'top', '--limit', '5', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(data.length).toBe(5);
    for (const item of data) {
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('score');
      expect(item).toHaveProperty('author');
      expect(item).toHaveProperty('rank');
    }
  }, 30_000);

  // ── Validate all adapters ──
  it('all adapter definitions are valid', async () => {
    const { stdout, code } = await runCli(['validate']);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
  });

  // ── Plugin catalog integrity ──
  // Site adapters now ship as independent plugins rather than core-bundled
  // commands, so the equivalent invariant is "these sites are cataloged
  // under plugins/", not "these sites are registered by default".
  it('all expected sites are cataloged as installable plugins', () => {
    const catalogedSites = new Set(fs.readdirSync(path.join(REPO_ROOT, 'plugins')));
    for (const expected of [
      'hackernews',
      'bbc',
      'twitter',
      'reddit',
      'reuters',
      'youtube',
      'coupang',
      'google',
      'google-scholar',
      'yahoo-finance',
    ]) {
      expect(catalogedSites.has(expected)).toBe(true);
    }
  });
});
