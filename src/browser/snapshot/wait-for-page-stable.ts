/*
 * Minimal page-stability wait compatible with Libretto's post-exec diff flow.
 * Copyright (c) 2026 Libretto contributors.
 * Upgrade path: port Libretto's full resource/network stability helper if evals show flaky diffs.
 */

import type { Page } from 'playwright-core';

export async function waitForPageStable(page: Page, timeoutMs = 5_000): Promise<void> {
  const bounded = Math.max(0, Math.min(timeoutMs, 5_000));
  if (bounded === 0) return;
  await page.waitForLoadState('domcontentloaded', { timeout: bounded }).catch(() => undefined);
  await page.waitForTimeout(Math.min(250, bounded)).catch(() => undefined);
}
