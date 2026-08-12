import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import type { IPage } from '../types.js';
import type { ExtractedPage } from './browser.js';

const { mockDownloadArticle } = vi.hoisted(() => ({
  mockDownloadArticle: vi.fn(),
}));

vi.mock('../download/article-download.js', () => ({
  downloadArticle: mockDownloadArticle,
}));

const {
  buildRenderAwareExtractorJs,
  formatDiagnostics,
  isInterestingNetworkEntry,
  normalizeFrameMode,
  normalizeWaitUntil,
  runFetchBrowser,
} = await import('./browser.js');

describe('web fetch browser tier stdout behavior', () => {
  const extractedArticle = {
    title: 'Example Article',
    author: 'Author',
    publishTime: '2026-04-22',
    contentHtml: '<p>hello</p>',
    imageUrls: ['https://example.com/a.jpg'],
    diagnostics: {
      url: 'https://example.com/article',
      frames: [],
      emptyContainers: [],
      includedFrameCount: 0,
    },
  };
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(extractedArticle),
    startNetworkCapture: vi.fn().mockResolvedValue(true),
    readNetworkCapture: vi.fn().mockResolvedValue([]),
  };
  const run = (kwargs: Record<string, unknown>) => runFetchBrowser(page as unknown as IPage, kwargs);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    mockDownloadArticle.mockReset();
    mockDownloadArticle.mockResolvedValue([{
      title: 'Example Article',
      author: 'Author',
      publish_time: '2026-04-22',
      status: 'success',
      size: '1 KB',
      saved: '-',
    }]);
    page.goto.mockClear();
    page.wait.mockClear();
    page.evaluate.mockClear();
    page.evaluate.mockResolvedValue(extractedArticle);
    page.startNetworkCapture.mockClear();
    page.startNetworkCapture.mockResolvedValue(true);
    page.readNetworkCapture.mockClear();
    page.readNetworkCapture.mockResolvedValue([]);
  });

  it('returns null in --stdout mode so the CLI does not append result rows to stdout', async () => {
    const result = await run({
      url: 'https://example.com/article',
      output: '/tmp/out',
      'download-images': false,
      stdout: true,
    });

    expect(result).toBeNull();
    expect(mockDownloadArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Example Article',
        sourceUrl: 'https://example.com/article',
      }),
      expect.objectContaining({
        output: '/tmp/out',
        stdout: true,
      }),
    );
    expect(page.evaluate.mock.calls[0]?.[0]).toContain('const frameMode = "same-origin"');
  });

  it('still returns the saved-row payload when writing to disk', async () => {
    const rows = [{ title: 'Example Article', saved: '/tmp/out/Example Article/example.md' }];
    mockDownloadArticle.mockResolvedValue(rows);

    const result = await run({
      url: 'https://example.com/article',
      output: '/tmp/out',
      'download-images': false,
      stdout: false,
    });

    expect(result).toBe(rows);
  });

  it('waits for a selector in the main document or same-origin iframes before extracting', async () => {
    page.evaluate
      .mockResolvedValueOnce({ ok: true, scope: 'iframe', url: 'https://example.com/frame' })
      .mockResolvedValueOnce(extractedArticle);

    await run({
      url: 'https://example.com/article',
      output: '/tmp/out',
      'download-images': false,
      'wait-for': '#gridDatas li',
      wait: 7,
      stdout: false,
    });

    expect(page.wait).not.toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page.evaluate.mock.calls[0]?.[0]).toContain('"#gridDatas li"');
    expect(page.evaluate.mock.calls[0]?.[0]).toContain('sameOriginFrameDocs');
    expect(page.evaluate.mock.calls[1]?.[0]).toContain('const frameMode = "same-origin"');
  });

  it('throws a clear error when --wait-for times out', async () => {
    page.evaluate.mockResolvedValueOnce({ ok: false, timedOut: true, selector: '#missing' });

    await expect(run({
      url: 'https://example.com/article',
      output: '/tmp/out',
      'download-images': false,
      'wait-for': '#missing',
      wait: 1,
      stdout: false,
    })).rejects.toThrow('Timed out waiting for selector "#missing"');

    expect(mockDownloadArticle).not.toHaveBeenCalled();
  });

  it('starts network capture and writes diagnostics in diagnose mode', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    page.readNetworkCapture.mockResolvedValueOnce([{
      method: 'POST',
      url: 'https://example.com/api/data',
      responseStatus: 200,
      responseContentType: 'application/json',
      responsePreview: '{"ok":true}',
    }]);

    await run({
      url: 'https://example.com/article',
      output: '/tmp/out',
      'download-images': false,
      diagnose: true,
      wait: 0,
      stdout: false,
    });

    expect(page.startNetworkCapture).toHaveBeenCalledWith('');
    expect(page.readNetworkCapture).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('[web-fetch-browser diagnose]'));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('POST 200 application/json https://example.com/api/data'));
  });

  // A challenge interstitial hands off to the real page mid-evaluate. That is
  // the normal case on the escalation path, so it must not surface as an error.
  it('retries the extractor once when the page navigates out from under it', async () => {
    page.evaluate
      .mockRejectedValueOnce(new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation'))
      .mockResolvedValueOnce(extractedArticle);

    const result = await run({ url: 'https://challenged.example', output: '/tmp/out', 'download-images': false, stdout: false });

    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(mockDownloadArticle).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
  });

  it('rethrows a second navigation failure instead of looping', async () => {
    const destroyed = new Error('Execution context was destroyed');
    page.evaluate.mockRejectedValueOnce(destroyed).mockRejectedValueOnce(destroyed);

    await expect(run({ url: 'https://challenged.example', output: '/tmp/out', 'download-images': false, stdout: false }))
      .rejects.toThrow('Execution context was destroyed');
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unrelated evaluate failure', async () => {
    page.evaluate.mockRejectedValueOnce(new Error('SyntaxError: bad selector'));

    await expect(run({ url: 'https://example.com/article', output: '/tmp/out', 'download-images': false, stdout: false }))
      .rejects.toThrow('SyntaxError');
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('passes --frames none into the extractor', async () => {
    await run({
      url: 'https://example.com/article',
      output: '/tmp/out',
      'download-images': false,
      frames: 'none',
      stdout: false,
    });

    expect(page.evaluate.mock.calls[0]?.[0]).toContain('const frameMode = "none"');
  });

  it('passes --frames all-same-origin into the extractor', async () => {
    await run({
      url: 'https://example.com/article',
      output: '/tmp/out',
      'download-images': false,
      frames: 'all-same-origin',
      stdout: false,
    });

    expect(page.evaluate.mock.calls[0]?.[0]).toContain('const frameMode = "all-same-origin"');
  });

  it('fails fast when --wait-until networkidle is requested but capture is unavailable', async () => {
    page.startNetworkCapture.mockResolvedValue(false);

    await expect(run({
      url: 'https://example.com/article',
      output: '/tmp/out',
      'download-images': false,
      'wait-until': 'networkidle',
      wait: 2,
      stdout: false,
    })).rejects.toThrow('Network capture is unavailable');

    expect(page.wait).not.toHaveBeenCalled();
    expect(mockDownloadArticle).not.toHaveBeenCalled();
  });

  it('fails fast when network traffic never settles before the networkidle timeout', async () => {
    vi.useFakeTimers();
    page.readNetworkCapture.mockResolvedValue([{
      method: 'POST',
      url: 'https://example.com/api/data',
      responseStatus: 200,
      responseContentType: 'application/json',
      responsePreview: '{"ok":true}',
    }]);

    const pending = expect(run({
      url: 'https://example.com/article',
      output: '/tmp/out',
      'download-images': false,
      'wait-until': 'networkidle',
      wait: 1,
      stdout: false,
    })).rejects.toThrow('Timed out waiting for network idle after 1s');

    await vi.advanceTimersByTimeAsync(2000);

    await pending;
    expect(mockDownloadArticle).not.toHaveBeenCalled();
  });
});

describe('web fetch browser tier render-aware helpers', () => {
  it('merges accessible same-origin iframe bodies into the extracted HTML', () => {
    const dom = new JSDOM(`
          <main>
            <h1>Shell</h1>
            <iframe id="MF" src="/frame.html"></iframe>
          </main>
        `, { url: 'https://example.com/main.html', runScripts: 'outside-only' });
    const frame = dom.window.document.querySelector('iframe')!;
    frame.contentDocument!.open();
    frame.contentDocument!.write('<body><table id="gridHd"><tr><th>Name</th></tr></table><ul id="gridDatas"></ul><p>Station A 42</p></body>');
    frame.contentDocument!.close();

    const result = dom.window.eval(buildRenderAwareExtractorJs({ frames: 'same-origin' })) as ExtractedPage;

    expect(result.diagnostics.includedFrameCount).toBe(1);
    expect(result.contentHtml).toContain('data-webcmd-iframe-source="https://example.com/frame.html"');
    expect(result.contentHtml).toContain('localized text iframe: https://example.com/frame.html');
    expect(result.contentHtml).toContain('Station A 42');
    expect(result.diagnostics.emptyContainers).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'iframe', id: 'gridDatas', url: 'https://example.com/frame.html' }),
    ]));
    expect(result.diagnostics.emptyContainers.every((item: { scope: string }) => item.scope === 'iframe')).toBe(true);
  });

  it('merges readable same-origin iframes outside the selected content element', () => {
    const dom = new JSDOM(`
          <main>
            <h1>Main Article</h1>
            <p>${'Main content '.repeat(30)}</p>
          </main>
          <aside>
            <iframe id="outside" src="/outside.html"></iframe>
          </aside>
        `, { url: 'https://example.com/main.html', runScripts: 'outside-only' });
    const frame = dom.window.document.querySelector('iframe')!;
    frame.contentDocument!.open();
    frame.contentDocument!.write(`<body><h1>Outside Frame</h1><p>${'Frame data '.repeat(12)}</p></body>`);
    frame.contentDocument!.close();

    const result = dom.window.eval(buildRenderAwareExtractorJs({ frames: 'same-origin' })) as ExtractedPage;

    expect(result.diagnostics.includedFrameCount).toBe(1);
    expect(result.contentHtml).toContain('data-webcmd-iframe-source="https://example.com/outside.html"');
    expect(result.contentHtml).toContain('Outside Frame');
    expect(result.contentHtml).toContain('Frame data');
  });

  it('keeps short data-like iframes outside the selected content element', () => {
    const dom = new JSDOM(`
          <main>
            <h1>Main Article</h1>
            <p>${'Main content '.repeat(30)}</p>
          </main>
          <iframe id="data-frame" src="/data.html"></iframe>
        `, { url: 'https://example.com/main.html', runScripts: 'outside-only' });
    const frame = dom.window.document.querySelector('iframe')!;
    frame.contentDocument!.open();
    frame.contentDocument!.write('<body><table id="gridHd"><tr><th>water level</th></tr><tr><td>42</td></tr></table><ul id="gridDatas"></ul></body>');
    frame.contentDocument!.close();

    const result = dom.window.eval(buildRenderAwareExtractorJs({ frames: 'same-origin' })) as ExtractedPage;

    expect(result.diagnostics.includedFrameCount).toBe(1);
    expect(result.contentHtml).toContain('42');
    expect(result.diagnostics.emptyContainers).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'iframe', id: 'gridDatas', url: 'https://example.com/data.html' }),
    ]));
    expect(result.diagnostics.emptyContainers.every((item: { scope: string }) => item.scope === 'iframe')).toBe(true);
  });

  it('skips short non-structural iframes outside the selected content element', () => {
    const dom = new JSDOM(`
          <main>
            <h1>Main Article</h1>
            <p>${'Main content '.repeat(30)}</p>
          </main>
          <iframe id="tiny-frame" src="/tiny.html"></iframe>
        `, { url: 'https://example.com/main.html', runScripts: 'outside-only' });
    const frame = dom.window.document.querySelector('iframe')!;
    frame.contentDocument!.open();
    frame.contentDocument!.write('<body><p>tiny note</p></body>');
    frame.contentDocument!.close();

    const result = dom.window.eval(buildRenderAwareExtractorJs({ frames: 'same-origin' })) as ExtractedPage;

    expect(result.diagnostics.includedFrameCount).toBe(0);
    expect(result.contentHtml).not.toContain('tiny note');
  });

  it('includes short non-structural iframes in all-same-origin mode', () => {
    const dom = new JSDOM(`
          <main>
            <h1>Main Article</h1>
            <p>${'Main content '.repeat(30)}</p>
          </main>
          <iframe id="status-frame" src="/status.html"></iframe>
        `, { url: 'https://example.com/main.html', runScripts: 'outside-only' });
    const frame = dom.window.document.querySelector('iframe')!;
    frame.contentDocument!.open();
    frame.contentDocument!.write('<body><div>Online: 42°C</div></body>');
    frame.contentDocument!.close();

    const result = dom.window.eval(buildRenderAwareExtractorJs({ frames: 'all-same-origin' })) as ExtractedPage;

    expect(result.diagnostics.includedFrameCount).toBe(1);
    expect(result.contentHtml).toContain('Online: 42°C');
  });

  it('marks API-like network entries as interesting and ignores static assets', () => {
    expect(isInterestingNetworkEntry({
      method: 'POST',
      url: 'https://example.com/GJZ/Ajax/Publish.ashx',
      status: 200,
      contentType: 'text/html',
      size: 100,
      bodyTruncated: false,
    })).toBe(true);
    expect(isInterestingNetworkEntry({
      method: 'POST',
      url: 'https://example.com/GJZ/Ajax/Publish.ashx',
      status: 200,
      contentType: 'application/json',
      size: 100,
      bodyTruncated: false,
    })).toBe(true);
    expect(isInterestingNetworkEntry({
      method: 'GET',
      url: 'https://example.com/app.js',
      status: 200,
      contentType: 'application/javascript',
      size: 100,
      bodyTruncated: false,
    })).toBe(false);
  });

  it('formats frame and XHR diagnostics for shell pages', () => {
    const output = formatDiagnostics({
      diagnostics: {
        url: 'https://example.com/main.html',
        includedFrameCount: 1,
        frames: [{
          index: 0,
          src: 'https://example.com/frame.html',
          title: '',
          sameOrigin: true,
          accessible: true,
          textLength: 42,
        }],
        emptyContainers: [{
          scope: 'iframe',
          url: 'https://example.com/frame.html',
          tag: 'ul',
          id: 'gridDatas',
          className: '',
        }],
      },
    }, [{
      method: 'POST',
      url: 'https://example.com/GJZ/Ajax/Publish.ashx',
      status: 200,
      contentType: 'application/json',
      size: 64,
      bodyTruncated: false,
    }], true);

    expect(output).toContain('frames: 1, included_same_origin: 1');
    expect(output).toContain('[frame 0] same-origin accessible text=42 https://example.com/frame.html');
    expect(output).toContain('iframe: ul#gridDatas (https://example.com/frame.html)');
    expect(output).toContain('POST 200 application/json https://example.com/GJZ/Ajax/Publish.ashx');
  });

  it('normalizes unknown frame and wait-until values to their defaults', () => {
    expect(normalizeFrameMode('bogus')).toBe('same-origin');
    expect(normalizeFrameMode('none')).toBe('none');
    expect(normalizeWaitUntil('bogus')).toBe('domstable');
    expect(normalizeWaitUntil('networkidle')).toBe('networkidle');
  });
});
