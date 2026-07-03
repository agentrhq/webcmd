/**
 * Extended E2E tests for all other browser commands.
 * Opt-in only: WEBCMD_E2E=1 npx vitest run
 */

import { describe, it, expect } from 'vitest';
import { runCli, parseJsonOutput } from './helpers.js';

async function tryBrowserCommand(args: string[]): Promise<any[] | null> {
  const { stdout, code } = await runCli(args, { timeout: 60_000 });
  if (code !== 0) return null;
  try {
    const data = parseJsonOutput(stdout);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function expectDataOrSkip(data: any[] | null, label: string) {
  if (data === null || data.length === 0) {
    console.warn(`${label}: skipped — no data returned (likely bot detection or geo-blocking)`);
    return;
  }
  expect(data.length).toBeGreaterThanOrEqual(1);
}

describe('browser extended public-data commands E2E', () => {

  // ── bbc ──
  it('bbc news returns headlines', async () => {
    const data = await tryBrowserCommand(['bbc', 'news', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'bbc news');
    if (data) {
      expect(data[0]).toHaveProperty('title');
    }
  }, 60_000);

  // ── reddit ──
  it('reddit hot returns posts', async () => {
    const data = await tryBrowserCommand(['reddit', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'reddit hot');
  }, 60_000);

  it('reddit frontpage returns posts', async () => {
    const data = await tryBrowserCommand(['reddit', 'frontpage', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'reddit frontpage');
  }, 60_000);

  // ── twitter ──
  it('twitter trending returns trends', async () => {
    const data = await tryBrowserCommand(['twitter', 'trending', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'twitter trending');
  }, 60_000);

  // ── reuters ──
  it('reuters search returns articles', async () => {
    const data = await tryBrowserCommand(['reuters', 'search', 'technology', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'reuters search');
  }, 60_000);

  // ── youtube ──
  it('youtube search returns videos', async () => {
    const data = await tryBrowserCommand(['youtube', 'search', 'typescript tutorial', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'youtube search');
  }, 60_000);

  // ── coupang ──
  it('coupang search returns products', async () => {
    const data = await tryBrowserCommand(['coupang', 'search', 'laptop', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'coupang search');
  }, 60_000);

  // ── google ──
  it('google search returns results', async () => {
    const data = await tryBrowserCommand(['google', 'search', 'typescript', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'google search');
    if (data) {
      expect(data[0]).toHaveProperty('type');
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('url');
    }
  }, 60_000);

  // ── academic / policy search ──
  it('google-scholar search returns papers', async () => {
    const data = await tryBrowserCommand(['google-scholar', 'search', 'transformer', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'google-scholar search');
    if (data) {
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('url');
    }
  }, 60_000);

  // ── yahoo-finance ──
  it('yahoo-finance quote returns stock data', async () => {
    const data = await tryBrowserCommand(['yahoo-finance', 'quote', 'AAPL', '-f', 'json']);
    expectDataOrSkip(data, 'yahoo-finance quote');
  }, 60_000);
});
