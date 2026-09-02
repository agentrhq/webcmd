import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserContext } from 'playwright-core';
import { findInstalledGoogleChrome } from '../../src/browser/google-chrome.js';
import { launchChromePersistentContext } from '../../src/browser/runtime/local-cloak/chrome-launch.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(process.env.WEBCMD_LIVE_CHROME !== '1')('installed Chrome native webdriver live gate', () => {
  it('keeps navigator.webdriver false through the production nonzero-CDP launcher', async () => {
    const executablePath = await findInstalledGoogleChrome();
    if (!executablePath) throw new Error('Google Chrome is required when WEBCMD_LIVE_CHROME=1');
    const userDataDir = await mkdtemp(join(tmpdir(), 'webcmd-live-chrome-'));
    tempDirs.push(userDataDir);
    const previousBinary = process.env.CLOAKBROWSER_BINARY_PATH;
    process.env.CLOAKBROWSER_BINARY_PATH = executablePath;
    let context: BrowserContext | undefined;
    try {
      context = await launchChromePersistentContext({ userDataDir, headless: false, humanize: true });
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto('data:text/html,<title>webcmd-chrome-webdriver-check</title>');
      expect(await page.evaluate(() => navigator.webdriver)).toBe(false);
    } finally {
      await context?.close();
      if (previousBinary === undefined) delete process.env.CLOAKBROWSER_BINARY_PATH;
      else process.env.CLOAKBROWSER_BINARY_PATH = previousBinary;
    }
  }, 30_000);
});
