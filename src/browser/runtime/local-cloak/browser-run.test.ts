import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { dispatchCloakAction } from './actions.js';
import { CloakSessionManager, type LaunchPersistentContext } from './session-manager.js';
import * as snapshot from '../../snapshot/index.js';

let browser: Browser;
let context: BrowserContext;
let initialPage: Page;
let initialPageId: string;
let manager: CloakSessionManager;
let launchPersistentContext: ReturnType<typeof vi.fn<LaunchPersistentContext>>;
let baseDir: string;

const command = (id: string, action: 'run' | 'snapshot' | 'tabs' | 'bind' | 'close-window', extra: Record<string, unknown> = {}) => ({
  id,
  action,
  profileId: 'default',
  session: 'work',
  surface: 'browser' as const,
  ...extra,
});

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-run-test-'));
  context = await browser.newContext();
  initialPage = await context.newPage();
  launchPersistentContext = vi.fn<LaunchPersistentContext>().mockResolvedValue(context);
  manager = new CloakSessionManager({
    baseDir,
    launchPersistentContext,
  });
  const initialLease = await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });
  initialPage = initialLease.page;
  initialPageId = initialLease.pageId;
});

afterEach(async () => {
  await context.close();
  fs.rmSync(baseDir, { recursive: true, force: true });
});

afterAll(async () => {
  await browser.close();
});

describe('local Cloak browser run', () => {
  it('returns a bounded redacted snapshot for the current page', async () => {
    await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });
    const result = await dispatchCloakAction(manager, command('snapshot-1', 'snapshot'));

    expect(result).toMatchObject({
      ok: true,
      data: {
        ok: true,
        tree: expect.any(String),
        page: { id: expect.any(String), url: 'about:blank', title: '' },
        warnings: [],
        limits: { snapshotTruncated: false },
      },
    });
  });

  it('redacts page, frame, and href URL parameters before bounding snapshot output', async () => {
    await context.route('**/*', route => route.fulfill({
      body: '<a href="https://example.test/next?ok=1&key=href-secret&auth=href-auth">Next</a>',
    }));
    await initialPage.goto('https://example.test/page?ok=1&key=page-secret&auth=page-auth');
    await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });

    const result = await dispatchCloakAction(manager, command('snapshot-redacted', 'snapshot', {
      maxOutputChars: 500,
    }));
    const tree = (result.data as { tree: string }).tree;

    expect(tree.length).toBeLessThanOrEqual(500);
    expect(tree).not.toMatch(/page-secret|page-auth|href-secret|href-auth/);
    expect(tree).toContain('key=[REDACTED]');
    expect(tree).toContain('auth=[REDACTED]');
    expect(tree).toContain('>Next</link>');
  });

  it('propagates critical omission warnings from explicit structural snapshots', async () => {
    await initialPage.setContent(`<main>${Array.from({ length: 20 }, (_, index) =>
      `<input aria-label="Critical ${index + 1}" aria-invalid="true">`).join('')}</main>`);
    await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });

    const result = await dispatchCloakAction(manager, command('snapshot-critical', 'snapshot', {
      maxOutputChars: 220,
    }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        warnings: [expect.stringMatching(/inspect.*ref/i)],
        limits: { snapshotTruncated: true },
      },
    });
    expect((result.data as { tree: string }).tree.length).toBeLessThanOrEqual(220);
  });

  it('returns readable markdown for read snapshots', async () => {
    await initialPage.setContent(`
      <main>
        <article>
          <h1>Readable Benchmark Notes</h1>
          <p>This paragraph is deliberately long enough to be treated as content, with benchmark evidence and enough words for extraction.</p>
          <button>Ignore chrome</button>
        </article>
      </main>
    `);
    await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });

    const result = await dispatchCloakAction(manager, command('snapshot-readable', 'snapshot', {
      snapshotMode: 'read',
    }));
    const data = result.data as { tree: string; article: { source: string } | null };

    expect(result.ok).toBe(true);
    expect(data.tree).toContain('Readable Benchmark Notes');
    expect(data.tree).toContain('benchmark evidence');
    expect(data.tree).not.toContain('Ignore chrome');
    expect(data.article?.source).toMatch(/readability|fallback/);
  });

  it('keeps failed read snapshots in the article pipeline', async () => {
    const capture = vi.spyOn(snapshot, 'captureSnapshot');
    const pageWithSnapshot = initialPage as Page & { snapshot?: () => Promise<string> };
    const pageSnapshot = vi.fn<() => Promise<string>>().mockResolvedValue('AX fallback');
    pageWithSnapshot.snapshot = pageSnapshot;
    await initialPage.setContent('');
    await manager.getPage({ profileId: 'default', session: 'work', surface: 'browser' });

    const result = await dispatchCloakAction(manager, command('snapshot-read-miss', 'snapshot', {
      snapshotMode: 'read',
    }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        tree: 'No readable article content found. Use --snapshot-mode tree to inspect the page structure.',
        article: null,
      },
    });
    expect(capture).not.toHaveBeenCalled();
    expect(pageSnapshot).not.toHaveBeenCalled();
    capture.mockRestore();
  });

  it('does not create a browser session for snapshot inspection', async () => {
    const launch = vi.fn<LaunchPersistentContext>().mockResolvedValue(context);
    const unstarted = new CloakSessionManager({
      baseDir: '/tmp/webcmd-browser-snapshot-unstarted',
      launchPersistentContext: launch,
    });

    const result = await dispatchCloakAction(unstarted, command('snapshot-cold', 'snapshot'));

    expect(result).toMatchObject({ ok: false, errorCode: 'session_not_found' });
    expect(launch).not.toHaveBeenCalled();
  });

  it('omits snapshotDiff when noSnapshotDiff is requested', async () => {
    const result = await dispatchCloakAction(manager, command('run-no-diff', 'run', {
      source: "return 'ok';",
      noSnapshotDiff: true,
    }));

    expect(result).toMatchObject({ ok: true, data: { result: 'ok' } });
    expect(result.data).not.toHaveProperty('snapshotDiff');
  });

  it('reuses the lease and keeps page state without keeping sandbox variables', async () => {
    const first = await dispatchCloakAction(manager, command('run-1', 'run', {
      source: `
        globalThis.onlyThisRun = 'gone';
        await page.setContent('<p id="state">persisted</p>');
        return await page.locator('#state').innerText();
      `,
      snapshotDiff: true,
    }));
    const second = await dispatchCloakAction(manager, command('run-2', 'run', {
      source: `
        return {
          state: await page.locator('#state').innerText(),
          variable: typeof globalThis.onlyThisRun,
        };
      `,
    }));

    expect(first).toMatchObject({ ok: true, data: { result: 'persisted' } });
    expect(first.page).toBeDefined();
    expect(first.data).toMatchObject({
      timings: {
        quickjs_boot_ms: expect.any(Number),
        client_bundle_init_ms: expect.any(Number),
        program_ms: expect.any(Number),
        browser_wait_ms: expect.any(Number),
        snapshot_ms: expect.any(Number),
      },
    });
    expect(Object.values((first.data as { timings: Record<string, number> }).timings)
      .every(value => value >= 0)).toBe(true);
    expect(second).toMatchObject({
      ok: true,
      page: first.page,
      data: { result: { state: 'persisted', variable: 'undefined' } },
    });
    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
    expect(initialPage.isClosed()).toBe(false);
  });

  it('lists without creating a runtime', async () => {
    const unstartedLaunch = vi.fn();
    const unstarted = new CloakSessionManager({
      baseDir: '/tmp/webcmd-browser-run-test-unstarted',
      launchPersistentContext: unstartedLaunch,
    });

    await expect(dispatchCloakAction(unstarted, command('tabs', 'tabs', { op: 'list' })))
      .resolves.toMatchObject({ ok: true, data: [] });
    expect(unstartedLaunch).not.toHaveBeenCalled();
  });

  it('does not bind a page owned by another Session', async () => {
    const original = await dispatchCloakAction(manager, command('run-original', 'run', {
      source: "await page.setContent('<p>original</p>'); return 'original';",
    }));
    const bound = await dispatchCloakAction(manager, command('bind', 'bind', {
      page: initialPageId,
      session: 'manual',
    }));

    expect(original).toMatchObject({ ok: true, page: expect.any(String) });
    expect(bound).toMatchObject({ ok: false, errorCode: 'SESSION_WINDOW_CONFLICT' });
    expect(initialPageId).toEqual(expect.any(String));
  });
});
