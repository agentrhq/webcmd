/**
 * E2E tests for management/built-in commands.
 * These commands require no external network access (except verify --smoke).
 *
 * Site commands are no longer bundled in core (they ship as independent
 * plugins), so `list`/`validate` need at least one plugin installed to have
 * anything to render. A small local plugin is installed once into an
 * isolated HOME for that purpose.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runCli, parseJsonOutput, installFixturePlugin } from './helpers.js';

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-management-e2e-'));
const FIXTURE_SITE = 'dictionary';
const FIXTURE_ENV = { HOME: TEST_HOME, USERPROFILE: TEST_HOME };

function runManagementCli(args: string[], opts: { timeout?: number } = {}) {
  return runCli(args, { ...opts, env: FIXTURE_ENV });
}

describe('management commands E2E', () => {
  beforeAll(() => {
    installFixturePlugin(TEST_HOME, FIXTURE_SITE);
  });

  afterAll(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  // ── list ──
  it('list shows all registered commands', async () => {
    const { stdout, code } = await runManagementCli(['list', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    // The fixture plugin (dictionary) contributes 3 commands: search, synonyms, examples.
    expect(data.length).toBeGreaterThanOrEqual(3);
    // Each entry should have the standard fields
    expect(data[0]).toHaveProperty('command');
    expect(data[0]).toHaveProperty('site');
    expect(data[0]).toHaveProperty('name');
    expect(data[0]).toHaveProperty('strategy');
    expect(data[0]).toHaveProperty('browser');
  });

  it('list default table format renders sites', async () => {
    const { stdout, code } = await runManagementCli(['list']);
    expect(code).toBe(0);
    expect(stdout).toContain(FIXTURE_SITE);
    expect(stdout).toContain('commands across');
  });

  it('list -f yaml produces valid yaml', async () => {
    const { stdout, code } = await runManagementCli(['list', '-f', 'yaml']);
    expect(code).toBe(0);
    expect(stdout).toContain('command:');
    expect(stdout).toContain('site:');
  });

  it('list -f csv produces valid csv', async () => {
    const { stdout, code } = await runManagementCli(['list', '-f', 'csv']);
    expect(code).toBe(0);
    const lines = stdout.trim().split('\n');
    // header + at least the 3 fixture commands
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });

  it('list -f md produces markdown table', async () => {
    const { stdout, code } = await runManagementCli(['list', '-f', 'md']);
    expect(code).toBe(0);
    expect(stdout).toContain('|');
    expect(stdout).toContain('command');
  });

  // ── validate ──
  it('validate passes for all built-in adapters', async () => {
    const { stdout, code } = await runManagementCli(['validate']);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
    expect(stdout).not.toContain('❌');
  });

  it('validate works for specific site', async () => {
    const { stdout, code } = await runManagementCli(['validate', FIXTURE_SITE]);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
  });

  it('validate works for specific command', async () => {
    const { stdout, code } = await runManagementCli(['validate', `${FIXTURE_SITE}/search`]);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
  });

  it('validate unknown target fails instead of passing zero commands', async () => {
    const { stdout, stderr, code } = await runManagementCli(['validate', 'nope']);
    expect(code).toBe(2);
    expect(stdout).not.toContain('PASS');
    expect(stderr).toContain('No command matches "nope"');
    expect(stderr).toContain(FIXTURE_SITE);
  });

  // ── verify ──
  it('verify runs validation without smoke tests', async () => {
    const { stdout, code } = await runManagementCli(['verify']);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
  });

  // ── version ──
  it('--version shows version number', async () => {
    const { stdout, code } = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // ── help ──
  it('--help shows usage', async () => {
    const { stdout, code } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('webcmd');
    expect(stdout).toContain('list');
    expect(stdout).toContain('validate');
  });

  // ── unknown command ──
  it('unknown command shows error', async () => {
    const { stderr, code } = await runCli(['nonexistent-command-xyz']);
    expect(code).toBe(2);
  });
});
