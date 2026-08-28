import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright-core';
import { LocalBrowserRunArtifactSink } from './artifacts.js';
import { MemorySnapshotBaselineStore } from '../snapshot/index.js';
import { PlaywrightTransport, unsupportedApiMessage } from './playwright-transport.js';
import { QuickJSHost } from './quickjs-host.js';
import { DOWNLOAD_WAIT_TIMEOUT_HINT, POPUP_WAIT_TIMEOUT_HINT, runBrowserProgram } from './runner.js';

const playwrightServer = createRequire(import.meta.url)(
  'playwright-core/lib/coreBundle',
) as { server: { RootDispatcher: { prototype: { stopPendingOperations(error: Error): Promise<void> } } } };

let browser: Browser;
let context: BrowserContext;
let page: Page;
const describeWithChromium = fs.existsSync(chromium.executablePath()) ? describe : describe.skip;

function sessionScope(pages: () => readonly Page[] = () => context.pages()) {
  return {
    browser,
    context,
    page,
    pages,
    createPage: () => context.newPage(),
    onPage(listener: (page: Page) => void) {
      context.on('page', listener);
      return () => context.off('page', listener);
    },
  };
}

function run(source: string, options = {}, input = {}) {
  return runBrowserProgram({
    ...sessionScope(),
    pageId: 'page-1',
    ...input,
  }, source, options);
}

async function runError(source: string): Promise<Error & { code?: string; hint?: string }> {
  try {
    await run(source);
  } catch (cause) {
    return cause as Error & { code?: string; hint?: string };
  }
  throw new Error('expected the program to fail');
}

describeWithChromium('runBrowserProgram', () => {
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
  context = await browser.newContext({ acceptDownloads: true });
  await context.route('https://example.test/data', route => route.fulfill({
    status: 201,
    body: 'created',
  }));
  page = await context.newPage();
  await page.setContent(`
    <button id="save" onclick="this.textContent='Saved'">Save</button>
    <input aria-label="Name">
    <iframe srcdoc="<button>Frame Save</button>"></iframe>
    <a href="about:blank" target="_blank">Popup</a>
    <a href="data:text/plain,hello" download="hello.txt">Download</a>
    <button id="fetch" onclick="fetch('https://example.test/data')">Fetch</button>
    <div id="mouse" style="width:20px;height:20px" onclick="this.textContent='clicked'">mouse</div>
  `);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await context.close();
});

afterAll(async () => {
  await browser.close();
});

  it('returns snapshotDiff by default after successful runs', async () => {
    const output = await run(`
      await page.setContent('<main><button>Saved</button></main>');
      return 'ok';
    `);

    expect(output.result).toBe('ok');
    expect(output).toHaveProperty('snapshotDiff');
    expect(typeof output.snapshotDiff).toBe('string');
    expect(output.limits.snapshotTruncated).toBe(false);
  });

  it('omits snapshotDiff when disabled', async () => {
    const output = await run('return null;', { snapshotDiff: false });

    expect(output).not.toHaveProperty('snapshotDiff');
  });

  it('warns when a successful run captures no result, logs, page diff, or artifacts', async () => {
    const output = await run('await Promise.resolve();', { snapshotDiff: false });

    expect(output.result).toBeNull();
    expect(output.warnings).toContainEqual(expect.objectContaining({
      code: 'BROWSER_RUN_NO_CAPTURE',
      message: expect.stringContaining('return structured data'),
    }));
  });

  it('clears a cached snapshot baseline when snapshotDiff is disabled', async () => {
    const snapshotBaselineStore = new MemorySnapshotBaselineStore();
    await run(`
      await page.setContent('<main><button>First state</button></main>');
      return null;
    `, { snapshotBaselineStore });
    expect(snapshotBaselineStore.get('page-1')).toBeDefined();

    await run(`
      await page.setContent('<main><button>Research result</button></main>');
      return 'Research result';
    `, { snapshotDiff: false, snapshotBaselineStore });

    expect(snapshotBaselineStore.get('page-1')).toBeUndefined();
  });

  it('captures a fresh before and after snapshot in the same run', async () => {
    const output = await run(`
      await page.getByRole('button', { name: 'Save' }).click();
      return null;
    `, { snapshotDiff: true });

    expect(output.snapshotDiff).toContain('Saved');
    expect(output.snapshotDiff).toContain('~ ');
  });

  it('omits an automatic snapshot diff that exceeds the output ceiling', async () => {
    const maxOutputChars = 100;
    const output = await run(`
      await page.setContent('<main><a href="https://example.test/next?ok=1&key=diff-secret&auth=diff-auth">Next</a><button>${'x'.repeat(200)}</button></main>');
      return null;
    `, { maxOutputChars });

    expect(output).not.toHaveProperty('snapshotDiff');
    expect(JSON.stringify(output)).not.toMatch(/diff-secret|diff-auth/);
    expect(output.limits.snapshotTruncated).toBe(true);
    expect(output.limits.snapshotDiffOmitted).toBe(true);
    expect(output.warnings).toContainEqual(expect.objectContaining({
      code: 'BROWSER_RUN_SNAPSHOT_DIFF_OMITTED',
      message: expect.stringMatching(/result.*sufficient.*continue.*targeted/i),
    }));
  });

  it('omits a structural diff when critical snapshot content would be lost', async () => {
    const controls = Array.from({ length: 20 }, (_, index) =>
      `<input aria-label="Critical ${index + 1}" aria-invalid="true">`).join('');
    const output = await run(`
      await page.setContent(${JSON.stringify(`<main>${controls}</main>`)});
      return null;
    `, { maxOutputChars: 220 });

    expect(output).not.toHaveProperty('snapshotDiff');
    expect(output.limits.snapshotTruncated).toBe(true);
    expect(output.limits.snapshotDiffOmitted).toBe(true);
    expect(output.warnings).toContainEqual(expect.objectContaining({
      code: 'BROWSER_RUN_SNAPSHOT_DIFF_OMITTED',
      message: expect.stringMatching(/targeted.*snapshot/i),
    }));
  });

  it('omits a snapshot diff when redaction expands it past the output limit', async () => {
    const beforeHtml = '<main><button>Before</button></main>';
    const source = `
      await page.setContent('<main><a href="https://u:p@example.test/path?token=a&key=b&secret=c&password=d&auth=e&api_key=f&session_id=g&csrf=h">Account</a></main>');
      return null;
    `;
    await page.setContent(beforeHtml);
    const generous = await run(source, { maxOutputChars: 1000 });
    expect(generous.snapshotDiff).toContain('[REDACTED]');

    await page.setContent(beforeHtml);
    const output = await run(source, { maxOutputChars: generous.snapshotDiff!.length - 1 });

    expect(output).not.toHaveProperty('snapshotDiff');
    expect(output.limits.snapshotTruncated).toBe(true);
    expect(output.limits.snapshotDiffOmitted).toBe(true);
    expect(output.warnings).toContainEqual(expect.objectContaining({
      code: 'BROWSER_RUN_SNAPSHOT_DIFF_OMITTED',
      message: expect.stringMatching(/output ceiling/i),
    }));
  });

  it('does not execute the program when the pre-snapshot fails', async () => {
    context.newCDPSession = (() => Promise.reject(new Error('pre snapshot failed'))) as BrowserContext['newCDPSession'];

    await expect(run(`
      await page.getByRole('button', { name: 'Save' }).click();
      return null;
    `, { snapshotDiff: true })).rejects.toThrow('pre snapshot failed');
    expect(await page.locator('#save').innerText()).toBe('Save');
  });

  it('counts the pre-snapshot against the command deadline', async () => {
    page.evaluate = (() => new Promise(() => undefined)) as Page['evaluate'];

    await expect(run(`
      await page.getByRole('button', { name: 'Save' }).click();
      return null;
    `, { snapshotDiff: true, timeoutMs: 25 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
    });
    expect(await page.locator('#save').innerText()).toBe('Save');
  });

  it('keeps program success and warns when the post-snapshot fails', async () => {
    const newCDPSession = context.newCDPSession.bind(context);
    let calls = 0;
    context.newCDPSession = ((...args: Parameters<BrowserContext['newCDPSession']>) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('post snapshot failed'));
      return newCDPSession(...args);
    }) as BrowserContext['newCDPSession'];

    const output = await run('return 7;', { snapshotDiff: true });

    expect(output.result).toBe(7);
    expect(output.warnings).toContainEqual(expect.objectContaining({
      code: 'BROWSER_RUN_SNAPSHOT_FAILED',
      message: expect.stringContaining('post snapshot failed'),
    }));
  });

  it('signals a stale context when the post-snapshot fails with a closed-context error (webcmd#314)', async () => {
    const newCDPSession = context.newCDPSession.bind(context);
    let calls = 0;
    context.newCDPSession = ((...args: Parameters<BrowserContext['newCDPSession']>) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('Target page, context or browser has been closed'));
      return newCDPSession(...args);
    }) as BrowserContext['newCDPSession'];
    const onStaleContext = vi.fn();

    const output = await run('return 7;', { snapshotDiff: true, onStaleContext });

    expect(output.result).toBe(7);
    expect(output.warnings).toContainEqual(expect.objectContaining({
      code: 'BROWSER_RUN_SNAPSHOT_FAILED',
    }));
    expect(onStaleContext).toHaveBeenCalledTimes(1);
  });

  it('does not signal a stale context for an unrelated post-snapshot failure', async () => {
    const newCDPSession = context.newCDPSession.bind(context);
    let calls = 0;
    context.newCDPSession = ((...args: Parameters<BrowserContext['newCDPSession']>) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('post snapshot failed'));
      return newCDPSession(...args);
    }) as BrowserContext['newCDPSession'];
    const onStaleContext = vi.fn();

    await run('return 7;', { snapshotDiff: true, onStaleContext });

    expect(onStaleContext).not.toHaveBeenCalled();
  });

  it('does not expose page.snapshotForAI inside browser-run code', async () => {
    const output = await run('return typeof page.snapshotForAI;');

    expect(output.result).toBe('undefined');
  });
  it('reports the caller line, column, and source for a compile error', async () => {
    // An unescaped quote ends the string early; the parser trips on what follows.
    // Line/column must be the caller's own, not the AsyncFunction wrapper's.
    const error = await runError("const a = 1;\nconst s = 'x'y';\nreturn a;");

    expect(error.code).toBe('BROWSER_RUN_SYNTAX_ERROR');
    expect(error.message).toContain('at line 2, column 14');
    expect(error.message).toContain("const s = 'x'y';");
    expect(error.message).not.toContain('QuickJS promise rejected');
    expect(error.hint).toContain('unescaped quote');
  });

  it('does not blame the caller syntax for a runtime SyntaxError', async () => {
    // JSON.parse throws a SyntaxError from a program that compiled fine.
    const error = await runError("return JSON.parse('1,2,3');");

    expect(error.code).toBeUndefined();
    expect(error.name).toBe('SyntaxError');
    expect(error.hint).toBeUndefined();
  });
  it('publishes the browser-run package subpath', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { exports?: Record<string, string> };

    expect(packageJson.exports?.['./browser/run'])
      .toBe('./dist/src/browser/run/index.js');
  });

  it('publishes the supported shared browser subpaths', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { exports?: Record<string, string> };

    expect(packageJson.exports?.['./browser/snapshot'])
      .toBe('./dist/src/browser/snapshot/index.js');
    expect(packageJson.exports?.['./browser/article-extract'])
      .toBe('./dist/src/browser/article-extract.js');
  });

  it('runs locators, frame locators, keyboard, and mouse calls', async () => {
    const output = await run(`
      await page.getByRole('button', { name: 'Save' }).click();
      const name = page.getByLabel('Name');
      await name.fill('Ada');
      await name.press('End');
      await page.keyboard.type(' Lovelace');

      const frameButton = page.frameLocator('iframe').getByRole('button');
      const frameText = await frameButton.innerText();
      const box = await page.locator('#mouse').boundingBox();
      await page.mouse.move(box.x + 1, box.y + 1);
      await page.mouse.click(box.x + 1, box.y + 1);

      return {
        saved: await page.locator('#save').innerText(),
        name: await name.inputValue(),
        frameText,
        mouse: await page.locator('#mouse').innerText(),
      };
    `);

    expect(output.result).toEqual({
      saved: 'Saved',
      name: 'Ada Lovelace',
      frameText: 'Frame Save',
      mouse: 'clicked',
    });
  });

  it('resolves waitForEvent("popup") into a readable Page before the outer run timeout', async () => {
    await context.route('https://popup.example.test/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Popup Title</title><p>Popup Body</p>',
    }));
    await page.setContent('<a href="https://popup.example.test/" target="_blank">Popup</a>');
    const registered: Page[] = [];
    const output = await runBrowserProgram({
      ...sessionScope(),
      pageId: 'page-1',
      onPage(listener) {
        const registeredListener = (popup: Page) => {
          if (!registered.includes(popup)) registered.push(popup);
          listener(popup);
        };
        context.on('page', registeredListener);
        return () => context.off('page', registeredListener);
      },
    }, `
      const popupPromise = page.waitForEvent('popup', { timeout: 5000 });
      await page.getByRole('link', { name: 'Popup' }).click();
      const popup = await popupPromise;
      return {
        popupUrl: popup.url(),
        title: await popup.title(),
        body: await popup.locator('body').innerText(),
        pages: context.pages().length,
      };
    `, { timeoutMs: 15_000 });

    expect(output.result).toEqual({
      popupUrl: 'https://popup.example.test/',
      title: 'Popup Title',
      body: 'Popup Body',
      pages: 2,
    });
    expect(registered).toEqual([context.pages()[1]]);
  });

  it('hides pages outside the supplied session page set', async () => {
    const other = await context.newPage();
    await other.setContent('<button>Other</button>');

    const output = await runBrowserProgram({
      ...sessionScope(() => [page]),
      pageId: 'page-1',
    }, `
      return {
        pages: context.pages().length,
        urls: context.pages().map(page => page.url()),
      };
    `);

    expect(output.result).toEqual({
      pages: 1,
      urls: [page.url()],
    });
  });

  it.each([
    ['once', `
      const seen = new Promise(resolve => context.once('page', page => resolve(page.url())));
      await context.newPage();
      return await seen;
    `],
    ['waitForEvent', `
      const seen = context.waitForEvent('page');
      await context.newPage();
      return (await seen).url();
    `],
  ])('scopes context.%s page events to Session-owned creation', async (_api, source) => {
    const sibling = await context.newPage();
    const owned = await context.newPage();
    await owned.goto('data:text/plain,owned');
    let pageListener: ((page: Page) => void) | undefined;
    const createPage = vi.fn(async () => {
      queueMicrotask(() => pageListener?.(owned));
      return owned;
    });

    const output = await runBrowserProgram({
      ...sessionScope(() => [page, owned]),
      pageId: 'page-1',
      createPage,
      onPage(listener) {
        pageListener = listener;
        return () => {
          if (pageListener === listener) pageListener = undefined;
        };
      },
    }, source);

    expect(output.result).toBe(owned.url());
    expect(output.result).not.toBe(sibling.url());
    expect(createPage).toHaveBeenCalledOnce();
  });

  it('does not let removeAllListeners remove the Session ownership listener', async () => {
    const seen: Page[] = [];
    const owned = await context.newPage();
    let pageListener: ((page: Page) => void) | undefined;
    const output = await runBrowserProgram({
      ...sessionScope(() => [page, owned]),
      pageId: 'page-1',
      createPage: async () => {
        queueMicrotask(() => pageListener?.(owned));
        return owned;
      },
      onPage(listener) {
        pageListener = (candidate: Page) => {
          seen.push(candidate);
          listener(candidate);
        };
        return () => {
          pageListener = undefined;
        };
      },
    }, `
      context.removeAllListeners('page');
      await context.newPage();
      return context.pages().length;
    `);

    expect(output.result).toBe(2);
    expect(seen).toEqual([owned]);
  });

  it('filters context request events from sibling Session pages', async () => {
    const sibling = await context.newPage();
    await sibling.goto('data:text/html,sibling');
    const output = runBrowserProgram({
      ...sessionScope(() => [page]),
      pageId: 'page-1',
    }, `
      const request = context.waitForEvent('request');
      await page.evaluate(() => document.body.dataset.contextListener = 'ready');
      return (await request).frame().page().url();
    `, { timeoutMs: 2_000 });

    await page.waitForFunction(() => document.body.dataset.contextListener === 'ready');
    await sibling.evaluate(() => fetch('https://example.test/data').catch(() => undefined));
    await page.evaluate(() => fetch('https://example.test/data').catch(() => undefined));

    await expect(output).resolves.toMatchObject({ result: page.url() });
  });

  it('filters context dialog events from sibling Session pages', async () => {
    const sibling = await context.newPage();
    await sibling.goto('data:text/html,sibling');
    const output = runBrowserProgram({
      ...sessionScope(() => [page]),
      pageId: 'page-1',
    }, `
      const pendingDialog = context.waitForEvent('dialog');
      await page.evaluate(() => document.body.dataset.dialogListener = 'ready');
      const dialog = await pendingDialog;
      const url = dialog.page().url();
      await dialog.dismiss();
      return url;
    `, { timeoutMs: 2_000 });

    await page.waitForFunction(() => document.body.dataset.dialogListener === 'ready');
    await sibling.evaluate(() => alert('sibling'));
    await page.evaluate(() => alert('owned'));

    await expect(output).resolves.toMatchObject({ result: page.url() });
  });

  it('delegates context.newPage to the Session-owned page creator', async () => {
    const createPage = vi.fn(() => context.newPage());
    const output = await runBrowserProgram({
      browser,
      context,
      page,
      pageId: 'page-1',
      pages: () => [page],
      createPage,
      onPage: () => () => undefined,
    }, `
      await context.newPage();
      return context.pages().length;
    `);

    expect(output.result).toBe(1);
    expect(createPage).toHaveBeenCalledOnce();
  });

  it('initializes against a pre-launched persistent context without registering it twice', async () => {
    const userDataDir = fs.mkdtempSync('/tmp/webcmd-persistent-browser-run-');
    const persistent = await chromium.launchPersistentContext(userDataDir, { headless: true });
    try {
      const persistentPage = persistent.pages()[0] ?? await persistent.newPage();
      const persistentBrowser = persistent.browser();
      if (!persistentBrowser) throw new Error('persistent browser missing');

      await expect(runBrowserProgram({
        browser: persistentBrowser,
        context: persistent,
        page: persistentPage,
        pageId: 'persistent-page',
        pages: () => persistent.pages(),
        createPage: () => persistent.newPage(),
        onPage(listener) {
          persistent.on('page', listener);
          return () => persistent.off('page', listener);
        },
      }, 'return 1;')).resolves.toMatchObject({ result: 1 });
    } finally {
      await persistent.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('hides sibling Session pages in a persistent context', async () => {
    const userDataDir = fs.mkdtempSync('/tmp/webcmd-persistent-browser-run-');
    const persistent = await chromium.launchPersistentContext(userDataDir, { headless: true });
    try {
      const owned = persistent.pages()[0] ?? await persistent.newPage();
      const sibling = await persistent.newPage();
      await owned.goto('data:text/plain,owned');
      await sibling.goto('data:text/plain,sibling');
      const persistentBrowser = persistent.browser();
      if (!persistentBrowser) throw new Error('persistent browser missing');

      const output = await runBrowserProgram({
        browser: persistentBrowser,
        context: persistent,
        page: owned,
        pageId: 'persistent-page',
        pages: () => [owned],
        createPage: () => persistent.newPage(),
        onPage(listener) {
          persistent.on('page', listener);
          return () => persistent.off('page', listener);
        },
      }, 'return context.pages().map(page => page.url());');

      expect(output.result).toEqual([owned.url()]);
    } finally {
      await persistent.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('waits for requests and responses', async () => {
    const output = await run(`
      const requestPromise = page.waitForRequest('**/data');
      const responsePromise = page.waitForResponse('**/data');
      await page.getByRole('button', { name: 'Fetch' }).click();
      const request = await requestPromise;
      const response = await responsePromise;
      return { requestUrl: request.url(), responseStatus: response.status() };
    `);

    expect(output.result).toEqual({
      requestUrl: 'https://example.test/data',
      responseStatus: 201,
    });
  });

  it('decodes response bodies and post data as text', async () => {
    await context.route('https://example.test/json', route => route.fulfill({
      contentType: 'application/json',
      body: '{"id":1,"title":"Essence"}',
    }));
    const output = await run(`
      const requestPromise = page.waitForRequest('**/json');
      const responsePromise = page.waitForResponse('**/json');
      await page.evaluate(
        () => fetch('https://example.test/json', { method: 'POST', body: 'h\u00e9llo' })
      );
      const request = await requestPromise;
      const response = await responsePromise;
      return {
        postData: request.postData(),
        text: await response.text(),
        json: await response.json(),
      };
    `);

    expect(output.result).toEqual({
      postData: 'h\u00e9llo',
      text: '{"id":1,"title":"Essence"}',
      json: { id: 1, title: 'Essence' },
    });
  });

  it('fetches through page.request and decodes the response as text', async () => {
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          method: request.method,
          title: 'Ess\u00e9nce',
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as import('node:net').AddressInfo;
    try {
      const output = await run(`
        const response = await page.request.get('http://127.0.0.1:${port}/api');
        const posted = await page.request.post('http://127.0.0.1:${port}/api', {
          data: { ok: true },
        });
        return {
          status: response.status(),
          text: await response.text(),
          json: await response.json(),
          posted: await posted.json(),
        };
      `);

      expect(output.result).toEqual({
        status: 200,
        text: '{"method":"GET","title":"Ess\u00e9nce","body":""}',
        json: { method: 'GET', title: 'Ess\u00e9nce', body: '' },
        posted: { method: 'POST', title: 'Ess\u00e9nce', body: '{"ok":true}' },
      });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('resolves waitForEvent("download") and saves the file before the outer run timeout', async () => {
    const output = await run(`
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
      await page.getByRole('link', { name: 'Download' }).click();
      const download = await downloadPromise;
      await download.saveAs(download.suggestedFilename());
      return { filename: download.suggestedFilename() };
    `, { timeoutMs: 15_000 });

    expect(output.result).toEqual({ filename: 'hello.txt' });
    expect(output.artifacts).toEqual([
      expect.objectContaining({ filename: 'hello.txt' }),
    ]);
  });

  it('captures a generated blob object-URL download as an artifact', async () => {
    await page.setContent(`
      <button id="convert">Normalize and download</button>
      <pre id="preview"></pre>
      <script>
        convert.onclick = () => {
          const text = 'name,amount\\nalpha,10.00\\nbeta,20.50\\ngamma,30.00\\n';
          preview.textContent = text;
          const a = document.createElement('a');
          a.download = 'normalized.csv';
          a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
          a.click();
        };
      </script>
    `);

    const output = await run(`
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#convert').click();
      const download = await downloadPromise;
      await download.saveAs(download.suggestedFilename());
      return { filename: download.suggestedFilename() };
    `);

    expect(output.result).toEqual({ filename: 'normalized.csv' });
    expect(output.artifacts).toEqual([
      expect.objectContaining({ filename: 'normalized.csv', byteSize: 47 }),
    ]);
  });

  it.each(['popup', 'download'] as const)('honors waitForEvent("%s") timeout when no event fires', async (event) => {
    const started = Date.now();
    await expect(run(`
      await page.waitForEvent(${JSON.stringify(event)}, { timeout: 80 });
    `, { timeoutMs: 5_000 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
      message: expect.stringContaining(`Timeout 80ms exceeded while waiting for event "${event}"`),
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('routes a throwing deferred delivery into onDeliveryError', async () => {
    const seen: Error[] = [];
    const transport = new PlaywrightTransport(sessionScope(), () => {
      throw new Error('delivery failed');
    }, (error) => { seen.push(error); });
    try {
      transport.handleServerMessage({ id: 1, method: 'unused' });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(seen.map(error => error.message)).toContain('delivery failed');
    } finally {
      await transport.dispose();
    }
  });

  it('tells the caller not to recompute bytes when a download wait times out', async () => {
    await expect(run(`
      await page.waitForEvent('download');
    `, { timeoutMs: 25 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
      message: 'Browser-run timed out waiting for a download.',
      hint: DOWNLOAD_WAIT_TIMEOUT_HINT,
    });
  });

  it('exposes only the supplied context from a shared browser', async () => {
    const sibling = await browser.newContext();
    try {
      const siblingPage = await sibling.newPage();
      await siblingPage.setContent('<title>Sibling secret</title>');

      const output = await run(`
        return {
          contexts: browser.contexts().length,
          pages: browser.contexts().flatMap(item => item.pages()).length,
        };
      `);

      expect(output.result).toEqual({ contexts: 1, pages: 1 });
    } finally {
      await sibling.close();
    }
  });

  it.each([
    ['browser.close()', 'await browser.close();', 'Browser.close'],
    ['browser.newContext()', 'await browser.newContext();', 'Browser.newContext'],
    ['context.close()', 'await context.close();', 'BrowserContext.close'],
    ['page.close()', 'await page.close();', 'Page.close'],
    ['browserType.launch()', 'await browser.browserType().launch();', undefined],
    ['browserType.connect()', 'await browser.browserType().connect("ws://localhost");', undefined],
    ['browserType.connectOverCDP()', 'await browser.browserType().connectOverCDP("http://localhost");', undefined],
  ])('rejects ownership-changing API %s', async (_name, source, api) => {
    await expect(run(source)).rejects.toMatchObject({
      code: 'BROWSER_RUN_API_UNSUPPORTED',
      ...(api ? { message: unsupportedApiMessage(api) } : {}),
    });
    expect(browser.isConnected()).toBe(true);
  });

  it.each([
    ['browser.newBrowserCDPSession()', 'await browser.newBrowserCDPSession();', 'Browser.newBrowserCDPSession'],
    ['context.newCDPSession()', 'await context.newCDPSession(page);', 'BrowserContext.newCDPSession'],
  ])('rejects CDP escape route %s', async (_name, source, api) => {
    await expect(run(source)).rejects.toMatchObject({
      code: 'BROWSER_RUN_API_UNSUPPORTED',
      message: unsupportedApiMessage(api),
    });
    expect(browser.isConnected()).toBe(true);
    expect(page.isClosed()).toBe(false);
  });

  it('does not expose imports, require, process, or filesystem globals', async () => {
    await expect(run('return await import("node:fs");')).rejects.toBeTruthy();
    await expect(run('return require("node:fs");')).rejects.toBeTruthy();
    await expect(run('return process.cwd();')).rejects.toBeTruthy();
    await expect(run('return fs.readFileSync("/etc/passwd");')).rejects.toBeTruthy();
  });

  it('exposes btoa/atob/TextEncoder/TextDecoder but not Buffer', async () => {
    const output = await run(`
      return {
        btoa: typeof btoa,
        atob: typeof atob,
        TextEncoder: typeof TextEncoder,
        TextDecoder: typeof TextDecoder,
        Buffer: typeof Buffer,
      };
    `);

    expect(output.result).toEqual({
      btoa: 'function',
      atob: 'function',
      TextEncoder: 'function',
      TextDecoder: 'function',
      Buffer: 'undefined',
    });
  });

  it('encodes btoa/atob as latin1 binary strings, not UTF-8', async () => {
    const output = await run(`
      const binary = String.fromCharCode(0, 128, 255);
      return {
        vector: btoa('hello'),
        roundTrip: atob(btoa('webcmd')),
        binaryRoundTrip: Array.from(atob(btoa(binary))).map(c => c.charCodeAt(0)),
        binaryVector: btoa(binary),
      };
    `);

    expect(output.result).toEqual({
      vector: 'aGVsbG8=',
      roundTrip: 'webcmd',
      binaryRoundTrip: [0, 128, 255],
      binaryVector: Buffer.from([0, 128, 255]).toString('base64'),
    });
  });

  it('rejects btoa input above the latin1 range', async () => {
    const output = await run(`
      try {
        btoa('caf\\u00e9\\u20ac');
        return 'no-throw';
      } catch (error) {
        return error.name;
      }
    `);

    expect(output.result).toBe('InvalidCharacterError');
  });

  it('round-trips multi-byte UTF-8 through TextEncoder/TextDecoder', async () => {
    const output = await run(`
      const bytes = new TextEncoder().encode('café € 🎉');
      return {
        bytes: Array.from(bytes),
        decoded: new TextDecoder().decode(bytes),
        fromBuffer: new TextDecoder().decode(bytes.buffer),
        encoding: new TextEncoder().encoding,
      };
    `);

    expect(output.result).toEqual({
      bytes: Array.from(Buffer.from('café € 🎉', 'utf8')),
      decoded: 'café € 🎉',
      fromBuffer: 'café € 🎉',
      encoding: 'utf-8',
    });
  });

  it('round-trips typed arrays through the Playwright serializers', async () => {
    const output = await run(`
      const length = await page.evaluate(bytes => bytes.length, new Uint8Array([1, 2, 3]));
      const returned = await page.evaluate(() => new Uint8Array([255, 0, 128]));
      return { length, returned: Array.from(returned) };
    `);

    expect(output.result).toEqual({ length: 3, returned: [255, 0, 128] });
  });

  it.each(['writeArtifact', '__webcmdWriteArtifact'])(
    'returns a redeemable receipt from %s',
    async (fn) => {
      const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-artifact-'));
      try {
        const output = await run(`
          const receipt = await ${fn}(
            'nested/report.csv',
            new TextEncoder().encode('id,name\\n1,caf\\u00e9\\n'),
          );
          return receipt;
        `, {}, { artifactSink: new LocalBrowserRunArtifactSink({ baseDir }) });

        const receipt = output.result as { artifactId: string; locator: string };
        expect(receipt).toMatchObject({
          filename: 'nested/report.csv',
          contentType: 'application/octet-stream',
          byteSize: 16,
          locator: expect.stringContaining('browser-run://'),
        });
        expect(output.artifacts).toEqual([receipt]);
        expect(
          fs.readFileSync(path.join(baseDir, receipt.artifactId, 'nested/report.csv'), 'utf8'),
        ).toBe('id,name\n1,caf\u00e9\n');
      } finally {
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    },
  );

  it('rejects absolute artifact paths instead of touching host paths', async () => {
    const target = '/tmp/webcmd-browser-run-owned.txt';
    fs.rmSync(target, { force: true });

    await expect(run(`
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Download' }).click();
      await (await downloadPromise).saveAs(${JSON.stringify(target)});
    `)).rejects.toMatchObject({ code: 'BROWSER_RUN_INVALID_INPUT' });
    expect(fs.existsSync(target)).toBe(false);
  });

  it.each([
    ['page.addScriptTag()', 'await page.addScriptTag({ path: "/etc/passwd" });'],
    ['locator.setInputFiles()', 'await page.locator("input").setInputFiles("/etc/passwd");'],
  ])('returns a typed denial for host-path API %s', async (_name, source) => {
    await expect(run(source)).rejects.toMatchObject({
      code: 'BROWSER_RUN_API_UNSUPPORTED',
    });
  });

  it('returns a typed hint for Node-only require/fs attempts in the sandbox', async () => {
    const error = await runError("const fs = require('fs'); return fs.readFileSync('/tmp/x', 'utf8');");

    expect(error).toMatchObject({
      code: 'BROWSER_RUN_API_UNSUPPORTED',
      hint: expect.stringContaining('Node require/fs are not available'),
    });
  });

  it('cancels an in-flight protocol wait without closing browser state', async () => {
    await expect(run(`
      await page.waitForEvent('popup');
    `, { timeoutMs: 25 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
    });
    expect(browser.isConnected()).toBe(true);
    expect(page.isClosed()).toBe(false);
  });

  it('tells the caller to open a tracked tab when a popup wait times out', async () => {
    await expect(run(`
      await page.waitForEvent('popup');
    `, { timeoutMs: 25 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
      message: 'Browser-run timed out waiting for a popup or new tab.',
      hint: POPUP_WAIT_TIMEOUT_HINT,
    });
  });

  it('does not tell the caller to increase --timeout after an explicit popup wait timeout', async () => {
    await expect(run(`
      await page.waitForEvent('popup', { timeout: 50 });
    `, { timeoutMs: 5_000 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
      hint: POPUP_WAIT_TIMEOUT_HINT,
    });
  });

  it('names the data: URL block in the popup hint', () => {
    // Chrome refuses top-level data: navigation, so window.open('data:...')
    // creates no target and no popup event ever fires — while still returning a
    // Window object, which is why page code looks like it worked. An agent that
    // is not told this retries the same click.
    expect(POPUP_WAIT_TIMEOUT_HINT).toContain('data:');
    expect(POPUP_WAIT_TIMEOUT_HINT).toContain('context.newPage()');
    expect(POPUP_WAIT_TIMEOUT_HINT).not.toMatch(/page\.goto on the current page/);
  });

  it('cancels an in-flight run through its abort signal', async () => {
    const controller = new AbortController();
    const pending = run(`await page.waitForEvent('popup');`, {
      timeoutMs: 2_000,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_RUN_CANCELLED' });
  });

  it('cancels an in-flight popup operation without closing the popup', async () => {
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Popup' }).click();
    const popup = await popupPromise;

    await expect(run(`
      const popup = context.pages()[1];
      await popup.waitForEvent('download');
    `, { timeoutMs: 25 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
    });
    expect(page.isClosed()).toBe(false);
    expect(popup.isClosed()).toBe(false);
  });

  it('disposes an unawaited protocol wait without closing browser state', async () => {
    const output = await run(`
      page.waitForEvent('popup');
      return 'done';
    `);

    expect(output.result).toBe('done');
    expect(browser.isConnected()).toBe(true);
    expect(page.isClosed()).toBe(false);
  });

  it('creates a fresh QuickJS runtime for every run', async () => {
    await run('globalThis.fromPreviousRun = true; return null;');
    const output = await run('return typeof fromPreviousRun;');

    expect(output.result).toBe('undefined');
  });

  it('serializes a program with no explicit return as null', async () => {
    const output = await run(`
      await page.getByRole('button', { name: 'Save' }).click();
    `);

    expect(output.result).toBeNull();
  });

  it('keeps time, memory, output, redaction, and serialization limits', async () => {
    await expect(run('while (true) {}', { timeoutMs: 25 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
    });
    await expect(run('return "x".repeat(100);', { maxOutputChars: 20 }))
      .rejects.toMatchObject({ code: 'BROWSER_RUN_OUTPUT_LIMIT' });
    await expect(run('return 1n;')).rejects.toMatchObject({
      code: 'BROWSER_RUN_SERIALIZATION_ERROR',
    });
    await expect(run('return new ArrayBuffer(64 * 1024 * 1024);', {
      memoryLimitBytes: 16 * 1024 * 1024,
    })).rejects.toMatchObject({ code: 'BROWSER_RUN_MEMORY_LIMIT' });

    const output = await run(`
      console.log('ready');
      return { token: 'secret123', value: 'safe' };
    `);
    expect(output.logs).toEqual([{ level: 'log', args: ['ready'] }]);
    expect(output.result).toEqual({ token: '[REDACTED]', value: 'safe' });
  });

  it('bounds log accumulation before returning it', async () => {
    const output = await run(`
      for (let index = 0; index < 100; index += 1) console.log('x'.repeat(100));
      return null;
    `, { maxOutputChars: 200 });

    expect(JSON.stringify(output.logs).length).toBeLessThanOrEqual(200);
    expect(output.limits.outputTruncated).toBe(true);
    expect(output.limits.snapshotTruncated).toBe(false);
  });

  it('returns a stable result envelope with logical screenshot receipts', async () => {
    const output = await run(`
      console.log('captured');
      await page.screenshot({ path: 'shot.png' });
      return { saved: true };
    `);

    expect(output).toMatchObject({
      ok: true,
      result: { saved: true },
      logs: [{ level: 'log', args: ['captured'] }],
      artifacts: [{ filename: 'shot.png', contentType: 'image/png' }],
      warnings: [],
      limits: { outputTruncated: false, snapshotTruncated: false },
    });
    expect(JSON.stringify(output.artifacts)).not.toContain('iVBOR');
  });

  it('uses an explicit screenshot type for its artifact receipt', async () => {
    const output = await run(`
      await page.screenshot({ path: 'shot.png', type: 'jpeg' });
      return null;
    `);

    expect(output.artifacts).toEqual([
      expect.objectContaining({ filename: 'shot.png', contentType: 'image/jpeg' }),
    ]);
  });

  it.each(['/tmp/shot.png', '../shot.png', 'nested/../../shot.png'])(
    'rejects non-logical screenshot path %s',
    async (artifactPath) => {
      await expect(run(`
        await page.screenshot({ path: ${JSON.stringify(artifactPath)} });
      `)).rejects.toMatchObject({ code: 'BROWSER_RUN_INVALID_INPUT' });
    },
  );

  it('preserves structured metadata on failures before execution starts', async () => {
    await expect(run('return null;', { timeoutMs: 0 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_INVALID_INPUT',
      details: {
        logs: [],
        page: { id: 'page-1', url: 'about:blank', title: '' },
        artifacts: [],
        warnings: [],
        limits: { outputTruncated: false, snapshotTruncated: false },
      },
    });
  });

  it('disposes timed-out QuickJS work and warns that browser actions remain', async () => {
    await expect(run(`
      await page.getByRole('button', { name: 'Save' }).click();
      await page.waitForEvent('popup');
    `, { timeoutMs: 25 })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
      details: {
        warnings: [{
          code: 'BROWSER_RUN_SIDE_EFFECTS_MAY_HAVE_OCCURRED',
          message: 'Already-issued browser actions were not rolled back.',
        }],
      },
    });
    expect(browser.isConnected()).toBe(true);
    expect(page.isClosed()).toBe(false);
  });

  it('returns a wall timeout and disposes QuickJS without waiting for protocol cleanup', async () => {
    const root = playwrightServer.server.RootDispatcher.prototype;
    const stopPendingOperations = root.stopPendingOperations;
    const dispose = QuickJSHost.prototype.dispose;
    let disposed = false;
    root.stopPendingOperations = () => new Promise<void>(() => undefined);
    QuickJSHost.prototype.dispose = function disposeTimedOutHost() {
      disposed = true;
      return dispose.call(this);
    };

    try {
      await expect(run('await page.waitForEvent("popup");', { timeoutMs: 25 }))
        .rejects.toMatchObject({ code: 'BROWSER_RUN_TIMEOUT' });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(disposed).toBe(true);
    } finally {
      root.stopPendingOperations = stopPendingOperations;
      QuickJSHost.prototype.dispose = dispose;
    }
  });

  it('redacts page metadata and execution errors', async () => {
    await context.route('**/*', route => route.fulfill({ body: '<title>Private</title>' }));
    await page.goto('https://alice:secret@example.test/path?token=secret');

    const output = await run('return null;');
    expect(output.page.url).toBe(
      'https://[REDACTED]@example.test/path?token=[REDACTED]',
    );
    await expect(run(`
      throw new Error('failed https://alice:secret@example.test/path?token=secret');
    `)).rejects.toMatchObject({
      message: expect.not.stringContaining('secret'),
    });
  });
});

describe('unsupportedApiMessage', () => {
  it.each([
    ['Browser.close', 'webcmd session close <session-id>'],
    ['Browser.newBrowserCDPSession', 'raw CDP is not exposed inside browser run'],
    ['Browser.newContext', 'webcmd session create'],
    ['Browser.newContextForReuse', 'webcmd session create'],
    ['BrowserContext.close', 'webcmd session close <session-id>'],
    ['BrowserContext.newCDPSession', 'raw CDP is not exposed inside browser run'],
    ['Page.close', 'leave the tab open'],
    ['Playwright.newRequest', 'use `page.request`'],
  ])('points %s at a supported alternative', (api, remediation) => {
    const message = unsupportedApiMessage(api);
    expect(message).toContain(`${api} is unavailable in browser run;`);
    expect(message).toContain(remediation);
  });

  it('keeps the generic text for an unmapped API', () => {
    expect(unsupportedApiMessage('Browser.killForTests')).toBe(
      'Browser.killForTests is unavailable in browser run.',
    );
  });
});
