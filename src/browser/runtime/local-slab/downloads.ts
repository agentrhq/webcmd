import type { Page } from 'playwright-core';
import type { BrowserDownloadWaitResult } from '../../../types.js';

export async function waitForDownload(page: Page, pattern: string, timeoutMs: number): Promise<BrowserDownloadWaitResult> {
  const startedAt = Date.now();
  try {
    const download = await page.waitForEvent('download', {
      timeout: timeoutMs,
      predicate: (candidate) => {
        if (!pattern) return true;
        return candidate.url().includes(pattern) || candidate.suggestedFilename().includes(pattern);
      },
    });
    const failure = await download.failure();
    return {
      downloaded: !failure,
      filename: download.suggestedFilename(),
      url: download.url(),
      error: failure ?? undefined,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      downloaded: false,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - startedAt,
    };
  }
}
