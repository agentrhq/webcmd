/**
 * Cross-surface coverage for the `web fetch` command surface (#252).
 *
 * Lives in the `plugin` project rather than `e2e`: it drives the built binary
 * (so it needs dist/), and that project is the one CI runs in full on every
 * OS. The `e2e` project runs only a named subset of browser files.
 *
 * The bug was cross-surface: the command always executed, but help, list and
 * completions did not know it existed. Unit tests on the parser cannot catch
 * that, so these assertions drive the built binary and check each surface.
 *
 * They also pin the ownership contract: `web fetch` is client-owned. It is
 * present everywhere the CLI presents commands, and marked local-only in the
 * hosted contract so Cloud can never advertise or execute a second copy of it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCli, parseJsonOutput } from '../../../tests/e2e/helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-web-fetch-e2e-'));
const LOCAL_ENV = { HOME: TEST_HOME, USERPROFILE: TEST_HOME };
// Hosted mode is selected by config.json, so pointing the config dir at a
// fixture is enough to make the CLI believe it is a hosted client.
const HOSTED_CONFIG_DIR = path.join(TEST_HOME, 'hosted-config');
const HOSTED_ENV = { ...LOCAL_ENV, WEBCMD_CONFIG_DIR: HOSTED_CONFIG_DIR };

describe('web fetch command surface', () => {
  beforeAll(() => {
    fs.mkdirSync(HOSTED_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(HOSTED_CONFIG_DIR, 'config.json'), `${JSON.stringify({
      mode: 'hosted',
      updatedAt: new Date().toISOString(),
      hosted: { apiBaseUrl: 'https://cloud.invalid' },
    })}\n`);
  });

  afterAll(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it('lists the web site group in top-level help', async () => {
    const { stdout, code } = await runCli(['--help'], { env: LOCAL_ENV });
    expect(code).toBe(0);
    expect(stdout).toMatch(/\bweb\b/);
  });

  it('reports exactly one web/fetch entry in list -f json', async () => {
    const { stdout, code } = await runCli(['list', '-f', 'json'], { env: LOCAL_ENV });
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout) as Array<{ command: string }>;
    expect(data.filter(entry => entry.command === 'web/fetch')).toHaveLength(1);
  });

  it('offers fetch as a completion under web', async () => {
    const { stdout, code } = await runCli(['--get-completions', '--cursor', '2', 'web'], { env: LOCAL_ENV });
    expect(code).toBe(0);
    expect(stdout.split('\n')).toContain('fetch');
  });

  it('prints help without requiring --url', async () => {
    const { stdout, code } = await runCli(['web', 'fetch', '--help'], { env: LOCAL_ENV });
    expect(code).toBe(0);
    expect(stdout).toContain('--url');
    expect(stdout).not.toMatch(/required|missing/i);
  });

  it('prints structured help without requiring --url', async () => {
    const { stdout, code } = await runCli(['web', 'fetch', '--help', '-f', 'json'], { env: LOCAL_ENV });
    expect(code).toBe(0);
    const help = parseJsonOutput(stdout) as { command?: string };
    expect(help.command).toContain('fetch');
  });

  it('executes locally on the client-owned fast path, in hosted mode too', async () => {
    // A missing --url must be rejected by the local argument parser, not by a
    // Cloud round-trip: the fixture API base URL does not resolve, so any
    // hosted dispatch would surface as a network error instead.
    for (const env of [LOCAL_ENV, HOSTED_ENV]) {
      const { stdout, stderr, code } = await runCli(['web', 'fetch'], { env });
      expect(code).not.toBe(0);
      expect(`${stdout}${stderr}`).toMatch(/--url/);
      expect(`${stdout}${stderr}`).not.toMatch(/cloud\.invalid|ENOTFOUND|EAI_AGAIN/);
    }
  });

  it('is marked local-only in the hosted contract so Cloud cannot serve it', () => {
    const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'hosted-contract.json'), 'utf-8')) as {
      commands: Array<{ command: string; sessionPolicy: string; availability: { mode: string; reason?: string } }>;
    };
    const entry = contract.commands.find(command => command.command === 'web/fetch');
    expect(entry).toBeDefined();
    expect(entry!.availability).toEqual({ mode: 'local-only', reason: 'client-owned' });
    expect(entry!.sessionPolicy).toBe('local-only');
  });
});
