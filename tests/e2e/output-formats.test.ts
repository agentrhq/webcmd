/**
 * E2E tests for output format rendering.
 * Uses the built-in list command so renderer coverage does not depend on
 * external network availability.
 *
 * Site commands are no longer bundled in core, so a small local plugin is
 * installed into an isolated HOME to give `list` something deterministic
 * to render.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runCli, parseJsonOutput, installFixturePlugin } from './helpers.js';

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-output-formats-e2e-'));
const FIXTURE_SITE = 'dictionary';
const FIXTURE_ENV = { HOME: TEST_HOME, USERPROFILE: TEST_HOME };

const FORMATS = ['json', 'yaml', 'csv', 'md'] as const;

describe('output formats E2E', () => {
  beforeAll(() => {
    installFixturePlugin(TEST_HOME, FIXTURE_SITE);
  });

  afterAll(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  for (const fmt of FORMATS) {
    it(`list -f ${fmt} produces valid output`, async () => {
      const { stdout, code } = await runCli(['list', '-f', fmt], { env: FIXTURE_ENV });
      expect(code).toBe(0);
      expect(stdout.trim().length).toBeGreaterThan(0);

      if (fmt === 'json') {
        const data = parseJsonOutput(stdout);
        expect(Array.isArray(data)).toBe(true);
        // The fixture plugin (dictionary) contributes 3 commands.
        expect(data.length).toBeGreaterThanOrEqual(3);
        expect(data[0]).toHaveProperty('command');
        expect(data[0]).toHaveProperty('site');
      }

      if (fmt === 'yaml') {
        expect(stdout).toContain('command:');
        expect(stdout).toContain('site:');
      }

      if (fmt === 'csv') {
        // CSV should have a header row + data rows
        const lines = stdout.trim().split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(2);
      }

      if (fmt === 'md') {
        // Markdown table should have pipe characters
        expect(stdout).toContain('| command |');
      }
    }, 30_000);
  }
});
