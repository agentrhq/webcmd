import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const { mockWebFetch, mockRenderOutput } = vi.hoisted(() => ({
  mockWebFetch: vi.fn(),
  mockRenderOutput: vi.fn(),
}));

vi.mock('./client.js', () => ({ webFetch: mockWebFetch }));
vi.mock('../output.js', async () => ({
  ...(await vi.importActual<typeof import('../output.js')>('../output.js')),
  render: mockRenderOutput,
}));

import { registerCommandToProgram } from '../commanderAdapter.js';
import { formatWebFetchMarkdown, webFetchBrowserCommand, webFetchCommand } from './command.js';

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
    expect(webFetchBrowserCommand.name).toBe('fetch-browser');
  });

  it('uses Commander coercion for canonical fetch options', async () => {
    await program().parseAsync(['web', 'fetch', '--url=https://example.com', '--timeout=9', '--max-chars=1200', '--allow-private=false', '--format=json'], { from: 'user' });

    expect(mockWebFetch).toHaveBeenCalledWith({ url: 'https://example.com', timeoutSeconds: 9, maxChars: 1200, allowPrivate: false });
  });

  it('shows help without requiring a URL', async () => {
    await expect(program().parseAsync(['web', 'fetch', '--help'], { from: 'user' })).rejects.toMatchObject({ code: 'commander.helpDisplayed' });
    expect(mockWebFetch).not.toHaveBeenCalled();
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
    await program().parseAsync(['web', 'fetch', '--url', 'https://example.com', ...args], { from: 'user' });
    expect(mockWebFetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it.each([['--browser'], ['--wait', '1'], ['--unknown']])('rejects removed and unknown options (%s)', async (...args) => {
    await expect(program().parseAsync(['web', 'fetch', '--url', 'https://example.com', ...args], { from: 'user' })).rejects.toMatchObject({ code: 'commander.unknownOption' });
  });
});
