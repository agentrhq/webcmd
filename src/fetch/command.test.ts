import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const { mockWebFetch, mockRenderOutput } = vi.hoisted(() => ({
  mockWebFetch: vi.fn(),
  mockRenderOutput: vi.fn(),
}));

vi.mock('./client.js', () => ({ webFetch: mockWebFetch }));
vi.mock('../execution.js', () => {
  throw new Error('web fetch must not import the generic executor');
});
vi.mock('../output.js', async () => ({
  ...(await vi.importActual<typeof import('../output.js')>('../output.js')),
  render: mockRenderOutput,
}));

import { registerCommandToProgram } from '../commanderAdapter.js';
import { formatWebFetchMarkdown, runWebFetchCommand, webFetchCommand } from './command.js';

const plainResult = { status: 200, requestedUrl: 'https://example.com', finalUrl: 'https://example.com', contentType: 'text/plain', tier: 'plain' as const, title: 'Example', extractionSource: 'raw' as const, truncated: false, content: 'ok' };

function program(): Command {
  const root = new Command().exitOverride();
  registerCommandToProgram(root.command('web'), webFetchCommand);
  return root;
}

describe('web fetch command', () => {
  beforeEach(() => {
    mockWebFetch.mockReset().mockResolvedValue(plainResult);
    mockRenderOutput.mockReset();
    process.exitCode = undefined;
  });

  it('is the client-owned, non-browser core command', () => {
    expect(webFetchCommand).toMatchObject({ site: 'web', name: 'fetch', browser: false, clientOwned: true, defaultFormat: 'md' });
  });

  it('is findable from blocked, 403, and Cloudflare', () => {
    expect(webFetchCommand.description).toMatch(/blocked/i);
    expect(webFetchCommand.description).toMatch(/403/);
    expect(webFetchCommand.description).toMatch(/Cloudflare/i);
  });

  it('accepts hosted root options without importing execution', async () => {
    await runWebFetchCommand(['--profile', 'work', '--workspace', 'test', 'web', 'fetch', '--url', 'https://example.com']);

    expect(mockWebFetch).toHaveBeenCalledWith({ url: 'https://example.com', timeoutSeconds: 30, maxChars: 50_000, allowPrivate: false, raw: false });
  });

  it('uses Commander coercion for canonical fetch options', async () => {
    await program().parseAsync(['web', 'fetch', '--url=https://example.com', '--timeout=9', '--max-chars=1200', '--allow-private=false', '--format=json'], { from: 'user' });

    expect(mockWebFetch).toHaveBeenCalledWith({ url: 'https://example.com', timeoutSeconds: 9, maxChars: 1200, allowPrivate: false, raw: false });
  });

  it('passes --raw through to the client and reports raw metadata in markdown', async () => {
    await program().parseAsync(['web', 'fetch', '--url=https://example.com', '--raw'], { from: 'user' });
    expect(mockWebFetch).toHaveBeenCalledWith({ url: 'https://example.com', timeoutSeconds: 30, maxChars: 50_000, allowPrivate: false, raw: true });
    expect(webFetchCommand.args.find(arg => arg.name === 'raw')?.help).toMatch(/raw HTML/i);
    expect(webFetchCommand.example).toContain('--raw');

    const rawResult = { ...plainResult, contentType: 'text/html', content: '<html></html>', bytes: 13, truncated: true };
    expect(formatWebFetchMarkdown(rawResult)).toContain('Bytes: 13');
    expect(formatWebFetchMarkdown(rawResult)).toContain('Truncated: true');
    expect(formatWebFetchMarkdown(plainResult)).not.toContain('Bytes:');
  });

  it('shows help without requiring a URL', async () => {
    await expect(program().parseAsync(['web', 'fetch', '--help'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.helpDisplayed' });
    expect(mockWebFetch).not.toHaveBeenCalled();
  });

  it('uses structured JSON help without requiring a URL', async () => {
    const originalArgv = process.argv;
    const output: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    process.argv = ['node', 'webcmd', 'web', 'fetch', '--help', '-f', 'json'];
    try {
      await expect(program().parseAsync(['web', 'fetch', '--help', '-f', 'json'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.helpDisplayed' });
      expect(JSON.parse(output.join(''))).toMatchObject({ site: 'web', name: 'fetch' });
    } finally {
      process.argv = originalArgv;
      write.mockRestore();
    }
  });

  it('accepts both output-format spellings', async () => {
    for (const args of [['--format', 'json'], ['--format=json']]) {
      await program().parseAsync(['web', 'fetch', '--url', 'https://example.com', ...args], { from: 'user' });
    }
    expect(mockRenderOutput).toHaveBeenCalledTimes(2);
    expect(mockRenderOutput.mock.calls.map(call => call[1].fmt)).toEqual(['json', 'json']);
  });

  it('renders fetched documents as markdown but preserves structured JSON', async () => {
    await program().parseAsync(['web', 'fetch', '--url', 'https://example.com', '-f', 'md'], { from: 'user' });
    await program().parseAsync(['web', 'fetch', '--url', 'https://example.com', '-f', 'json'], { from: 'user' });
    const markdown = mockRenderOutput.mock.calls[0][1].markdown as (data: unknown) => string | undefined;
    expect(markdown(plainResult)).toBe(formatWebFetchMarkdown(plainResult));
    expect(mockRenderOutput.mock.calls[1][1]).toMatchObject({ fmt: 'json' });
  });

  it.each([
    ['--timeout', 'nope'], ['--timeout', '-1'], ['--max-chars', '-1'], ['--url', 'ftp://example.com'],
  ])('rejects invalid fetch arguments (%s %s)', async (...args) => {
    const output: string[] = [];
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    try {
      await program().parseAsync(['web', 'fetch', '--url', 'https://example.com', ...args], { from: 'user' });
      expect(mockWebFetch).not.toHaveBeenCalled();
      expect(output.join('')).toContain('code: ARGUMENT');
      expect(process.exitCode).toBe(2);
    } finally {
      write.mockRestore();
    }
  });

  it.each([['--browser'], ['--wait', '1'], ['--unknown']])('rejects removed and unknown options (%s)', async (...args) => {
    await expect(program().parseAsync(['web', 'fetch', '--url', 'https://example.com', ...args], { from: 'user' })).rejects.toMatchObject({ code: 'commander.unknownOption' });
  });
});
