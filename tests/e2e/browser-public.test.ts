/**
 * E2E tests for core browser commands that use public, English/global pages.
 * These launch a headless Chromium in CI.
 *
 * NOTE: Some sites may block headless browsers with bot detection.
 * Tests are wrapped with tryBrowserCommand() which allows graceful failure.
 */

import { describe, it, expect } from 'vitest';
import { runCli, parseJsonOutput, type CliResult } from './helpers.js';

const BROWSER_UNAVAILABLE_ENV = { WEBCMD_BROWSER_CONNECT_TIMEOUT: '5' };

function isImdbChallenge(result: CliResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`;
  return /IMDb blocked this request|Robot Check|Are you a robot|verify that you are human|captcha/i.test(text);
}

function isBrowserRuntimeUnavailable(result: CliResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`;
  return /Browser runtime.*not connected|Runtime.*not connected|Browser profile .*not connected/i.test(text);
}

function isTransientBrowserNavigation(result: CliResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`;
  return /Execution context was destroyed|Detached while handling command|No tab with id|Debugger is not attached to the tab/i.test(text);
}

async function expectImdbDataOrChallengeSkip(args: string[], label: string): Promise<any[] | null> {
  const result = await runCli(args, { timeout: 60_000, env: BROWSER_UNAVAILABLE_ENV });
  if (result.code !== 0) {
    if (isImdbChallenge(result)) {
      console.warn(`${label}: skipped — IMDb challenge page detected`);
      return null;
    }
    if (isBrowserRuntimeUnavailable(result)) {
      console.warn(`${label}: skipped — browser runtime is unavailable in this environment`);
      return null;
    }
    if (isTransientBrowserNavigation(result)) {
      console.warn(`${label}: skipped — transient browser navigation interrupted extraction`);
      return null;
    }
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }

  const data = parseJsonOutput(result.stdout);
  if (!Array.isArray(data)) {
    throw new Error(`${label} returned non-array JSON:\n${result.stdout.slice(0, 500)}`);
  }
  if (data.length === 0) {
    throw new Error(`${label} returned an empty result`);
  }
  return data;
}

describe('browser public-data commands E2E', () => {
  // ── imdb ──
  it('imdb top returns chart data', async () => {
    const data = await expectImdbDataOrChallengeSkip(['imdb', 'top', '--limit', '3', '-f', 'json'], 'imdb top');
    if (data?.length) {
      expect(data[0]).toHaveProperty('title');
    }
  }, 60_000);

  it('imdb search returns results', async () => {
    const data = await expectImdbDataOrChallengeSkip(['imdb', 'search', 'inception', '--limit', '3', '-f', 'json'], 'imdb search');
    if (data?.length) {
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('title');
    }
  }, 60_000);

  it('imdb title returns movie details', async () => {
    const data = await expectImdbDataOrChallengeSkip(['imdb', 'title', 'tt1375666', '-f', 'json'], 'imdb title');
    if (data?.length) {
      expect(data[0]).toHaveProperty('field');
      expect(data[0]).toHaveProperty('value');
    }
  }, 60_000);
});
