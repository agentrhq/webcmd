/**
 * Smoke tests for external API health.
 * Only run on schedule or manual dispatch — NOT on every push/PR.
 * These verify that external APIs haven't changed their structure.
 */

import { describe, expect, it } from 'vitest';
import { parseJsonOutput, runCli } from '../e2e/helpers.js';

describe('API health smoke tests', () => {
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

  // ── Command registry integrity ──
  it('all expected sites are registered', async () => {
    const { stdout, code } = await runCli(['list', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    const sites = new Set(data.map((d: any) => d.site));
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
      expect(sites.has(expected)).toBe(true);
    }
  });
});
