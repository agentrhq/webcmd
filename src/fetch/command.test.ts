import { describe, expect, it, vi } from 'vitest';
import {
  formatWebFetchHelp,
  formatWebFetchMarkdown,
  runClientOwnedWebFetch,
  WEB_FETCH_ARGS,
  webFetchCommand,
} from './command.js';

describe('web fetch command', () => {
  it('renders fetch metadata before content', () => {
    expect(formatWebFetchMarkdown({
      status: 200,
      requestedUrl: 'https://a',
      finalUrl: 'https://b',
      contentType: 'text/plain',
      tier: 'plain',
      title: 'T',
      extractionSource: 'raw',
      truncated: false,
      content: 'body',
    })).toContain('Source: https://a');
  });

  it('runs the client-owned command without Cloud routing', async () => {
    const webFetch = vi.fn().mockResolvedValue({
      status: 200,
      requestedUrl: 'https://a',
      finalUrl: 'https://a',
      contentType: 'text/plain',
      tier: 'plain',
      title: '',
      extractionSource: 'raw',
      truncated: false,
      content: 'ok',
    });
    await runClientOwnedWebFetch(['web', 'fetch', '--url', 'https://a'], {
      webFetch,
      stdout: { write: vi.fn() } as never,
    });
    expect(webFetch).toHaveBeenCalledOnce();
  });

  it('keeps discovery args aligned with the registered command', () => {
    expect(webFetchCommand.site).toBe('web');
    expect(webFetchCommand.name).toBe('fetch');
    expect(webFetchCommand.browser).toBe(false);
    expect(webFetchCommand.args).toEqual(WEB_FETCH_ARGS);
  });

  it('prints real help for -h and --help without requiring --url', async () => {
    for (const flag of ['-h', '--help'] as const) {
      const write = vi.fn();
      const webFetch = vi.fn();
      await runClientOwnedWebFetch(['web', 'fetch', flag], {
        webFetch,
        stdout: { write } as never,
      });
      expect(webFetch).not.toHaveBeenCalled();
      expect(write).toHaveBeenCalledOnce();
      const help = String(write.mock.calls[0]![0]);
      expect(help).toContain('Usage:');
      expect(help).toContain('web fetch');
      expect(help).toContain('--url');
      expect(help).toContain('--timeout');
      expect(help).toBe(formatWebFetchHelp());
    }
  });

  it('honours -f for output instead of always printing markdown', async () => {
    const result = {
      status: 200,
      requestedUrl: 'https://a',
      finalUrl: 'https://a',
      contentType: 'text/plain',
      tier: 'plain',
      title: '',
      extractionSource: 'raw',
      truncated: false,
      content: 'ok',
    };
    const write = vi.fn();
    await runClientOwnedWebFetch(['web', 'fetch', '--url', 'https://a', '-f', 'json'], {
      webFetch: vi.fn().mockResolvedValue(result),
      stdout: { write } as never,
    });
    expect(JSON.parse(String(write.mock.calls[0]![0]))).toMatchObject({ content: 'ok' });
  });

  it('serves structured help for --help -f yaml', async () => {
    const write = vi.fn();
    await runClientOwnedWebFetch(['web', 'fetch', '--help', '-f', 'yaml'], {
      webFetch: vi.fn(),
      stdout: { write } as never,
    });
    expect(String(write.mock.calls[0]![0])).toContain('name: fetch');
  });

  it('rejects an unsupported --format instead of silently printing a table', async () => {
    await expect(runClientOwnedWebFetch(['web', 'fetch', '--url', 'https://a', '-f', 'xml'], {
      webFetch: vi.fn(),
      stdout: { write: vi.fn() } as never,
    })).rejects.toThrow('--format must be one of');
  });

  it('rejects a flag-shaped value for --timeout instead of coercing it', async () => {
    await expect(runClientOwnedWebFetch(['web', 'fetch', '--url', 'https://a', '--timeout', '-5'], {
      webFetch: vi.fn(),
      stdout: { write: vi.fn() } as never,
    })).rejects.toThrow('--timeout requires a value');
  });

  it('rejects missing --url with ArgumentError when help is not requested', async () => {
    await expect(runClientOwnedWebFetch(['web', 'fetch'], {
      webFetch: vi.fn(),
      stdout: { write: vi.fn() } as never,
    })).rejects.toThrow('--url must be an http or https URL');
  });
});
