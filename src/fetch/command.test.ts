import { describe, expect, it, vi } from 'vitest';
import { CliError, TimeoutError } from '../errors.js';
import { formatWebFetchMarkdown, runClientOwnedWebFetch, webFetchBrowserCommand, webFetchCommand } from './command.js';

const { mockExecuteCommand } = vi.hoisted(() => ({ mockExecuteCommand: vi.fn() }));
vi.mock('../execution.js', () => ({ executeCommand: mockExecuteCommand, prepareCommandArgs: (_cmd: unknown, k: unknown) => k }));

const plainResult = { status: 200, requestedUrl: 'https://a', finalUrl: 'https://a', contentType: 'text/plain', tier: 'plain' as const, title: '', extractionSource: 'raw' as const, truncated: false, content: 'ok' };

describe('web fetch command', () => {
  it('renders fetch metadata before content', () => {
    expect(formatWebFetchMarkdown({ ...plainResult, requestedUrl: 'https://a', finalUrl: 'https://b', title: 'T', content: 'body' })).toContain('Source: https://a');
  });

  it('runs the client-owned command without Cloud routing', async () => {
    const webFetch = vi.fn().mockResolvedValue(plainResult);
    await runClientOwnedWebFetch(['web', 'fetch', '--url', 'https://a'], { webFetch, stdout: { write: vi.fn() } as never });
    expect(webFetch).toHaveBeenCalledOnce();
  });

  it('registers both tiers under the web site', () => {
    expect(webFetchCommand.site).toBe('web');
    expect(webFetchCommand.browser).toBe(false);
    expect(webFetchBrowserCommand.name).toBe('fetch-browser');
    expect(webFetchBrowserCommand.browser).toBe(true);
  });
});

describe('web fetch browser escalation', () => {
  const run = (kwargs: Record<string, unknown>) => (webFetchCommand.func as (k: unknown, d?: boolean) => Promise<unknown>)(kwargs);

  it('escalates to the browser tier when the site blocks plain HTTP', async () => {
    mockExecuteCommand.mockReset().mockResolvedValue({ title: 'Real Title', content: '# rendered' });
    const blocked = new CliError('FETCH_BLOCKED', 'The site blocked non-browser fetches.');
    vi.spyOn(await import('./client.js'), 'webFetch').mockRejectedValueOnce(blocked);

    const result = await run({ url: 'https://blocked.example', timeout: 30, 'max-chars': 50000, browser: true });

    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ tier: 'browser', title: 'Real Title', content: '# rendered', extractionSource: 'browser' });
  });

  it('escalates when the page needs browser rendering', async () => {
    mockExecuteCommand.mockReset().mockResolvedValue({ title: 'App', content: 'shell content' });
    const needsBrowser = new CliError('FETCH_REQUIRES_BROWSER', 'This page requires browser rendering.');
    vi.spyOn(await import('./client.js'), 'webFetch').mockRejectedValueOnce(needsBrowser);

    const result = await run({ url: 'https://spa.example', browser: true });

    expect(result).toMatchObject({ tier: 'browser', content: 'shell content' });
  });

  // --browser false is the opt-out for callers that must never launch a browser.
  it('rethrows instead of escalating when --browser false is given', async () => {
    mockExecuteCommand.mockReset();
    const blocked = new CliError('FETCH_BLOCKED', 'The site blocked non-browser fetches.');
    vi.spyOn(await import('./client.js'), 'webFetch').mockRejectedValueOnce(blocked);

    await expect(run({ url: 'https://blocked.example', browser: false })).rejects.toThrow('The site blocked non-browser fetches.');
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  // The stock hint tells the caller the browser tier runs automatically. When
  // they turned it off, that hint is actively wrong — say what to do instead.
  it('replaces the hint with the reason escalation was declined', async () => {
    mockExecuteCommand.mockReset();
    vi.spyOn(await import('./client.js'), 'webFetch').mockRejectedValueOnce(new CliError('FETCH_BLOCKED', 'The site blocked non-browser fetches.', 'stock hint'));

    const error = await run({ url: 'https://blocked.example', browser: false }).catch((e: CliError) => e);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('FETCH_BLOCKED');
    expect((error as CliError).hint).toContain('--browser false');
  });

  // A timeout or a refused connection is a real failure. Escalating would hide
  // a broken URL behind a slow browser run.
  it('does not escalate a timeout', async () => {
    mockExecuteCommand.mockReset();
    vi.spyOn(await import('./client.js'), 'webFetch').mockRejectedValueOnce(new TimeoutError('web fetch', 30));

    await expect(run({ url: 'https://slow.example', browser: true })).rejects.toThrow();
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  it('does not escalate an unrelated CliError', async () => {
    mockExecuteCommand.mockReset();
    vi.spyOn(await import('./client.js'), 'webFetch').mockRejectedValueOnce(new CliError('FETCH_BODY_TOO_LARGE', 'Fetched body exceeds 10 MiB'));

    await expect(run({ url: 'https://big.example', browser: true })).rejects.toThrow('Fetched body exceeds 10 MiB');
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  it('escalates on the client-owned fast path too', async () => {
    mockExecuteCommand.mockReset().mockResolvedValue({ title: 'Rendered', content: 'browser body' });
    const webFetch = vi.fn().mockRejectedValue(new CliError('FETCH_BLOCKED', 'blocked'));
    const write = vi.fn();

    await runClientOwnedWebFetch(['web', 'fetch', '--url', 'https://blocked.example'], { webFetch, stdout: { write } as never });

    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toContain('browser body');
  });

  it('honours --browser false on the client-owned fast path', async () => {
    mockExecuteCommand.mockReset();
    const webFetch = vi.fn().mockRejectedValue(new CliError('FETCH_BLOCKED', 'blocked'));

    await expect(runClientOwnedWebFetch(['web', 'fetch', '--url', 'https://blocked.example', '--browser', 'false'], { webFetch, stdout: { write: vi.fn() } as never })).rejects.toThrow('blocked');
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });
});
