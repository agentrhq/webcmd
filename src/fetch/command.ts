import { Command } from 'commander';
import { cli, Strategy, type CommandArgs } from '../registry.js';
import { registerCommandToProgram } from '../commanderAdapter.js';
import { configureRootCommandSurface } from '../root-command-surface.js';
import { ArgumentError } from '../errors.js';
import type { WebFetchOptions, WebFetchResult } from './client.js';

export const webFetchCommand = cli({
  site: 'web', name: 'fetch', access: 'read', strategy: Strategy.PUBLIC, browser: false,
  clientOwned: true,
  description: 'Fetch a URL with local HTTP clients. Use after a blocked, 403, or Cloudflare response; never opens a browser.', defaultFormat: 'md',
  example: 'webcmd web fetch --url https://example.com --raw -f json',
  renderMarkdown: data => (isWebFetchResult(data) ? formatWebFetchMarkdown(data) : undefined),
  args: [
    { name: 'url', type: 'string', required: true, help: 'HTTP or HTTPS URL to fetch' },
    { name: 'timeout', type: 'int', default: 30, help: 'Total fetch budget in seconds' },
    { name: 'max-chars', type: 'int', default: 50_000, help: 'Maximum extracted characters; 0 disables truncation' },
    { name: 'allow-private', type: 'boolean', default: false, help: 'Allow private and loopback destinations' },
    { name: 'raw', type: 'boolean', default: false, help: 'Return the raw HTML response body instead of extracted article text; use this for CSS selector discovery, meta tags, and inline script payloads' },
  ],
  validateArgs: validateWebFetchArgs,
  func: async (kwargs) => {
    const { webFetch } = await import('./client.js');
    return webFetch(clientOptionsFromKwargs(kwargs));
  },
});

/** Run only the client-owned fetch command without loading the main CLI. */
export async function runWebFetchCommand(argv: string[]): Promise<void> {
  const program = configureRootCommandSurface(new Command('webcmd'))
    .option('--workspace <id>', 'Hosted workspace id/slug for the request');
  registerCommandToProgram(program.command('web'), webFetchCommand);
  await program.parseAsync(argv, { from: 'user' });
}

function clientOptionsFromKwargs(kwargs: CommandArgs): WebFetchOptions {
  return {
    url: String(kwargs.url),
    timeoutSeconds: Number(kwargs.timeout ?? 30),
    maxChars: Number(kwargs['max-chars'] ?? 50000),
    allowPrivate: kwargs['allow-private'] === true,
    raw: kwargs.raw === true,
  };
}

function validateWebFetchArgs(kwargs: CommandArgs): void {
  let url: URL;
  try { url = new URL(String(kwargs.url)); } catch { throw new ArgumentError('--url must be an http or https URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ArgumentError('--url must be an http or https URL');
  for (const name of ['timeout', 'max-chars']) {
    if (!Number.isInteger(kwargs[name]) || kwargs[name] < 0) throw new ArgumentError(`--${name} must be a non-negative integer`);
  }
}

function isWebFetchResult(data: unknown): data is WebFetchResult {
  return typeof data === 'object' && data !== null && 'requestedUrl' in data && 'content' in data;
}

export function formatWebFetchMarkdown(result: WebFetchResult): string {
  return [`# ${result.title || 'Fetched content'}`, '', `Source: ${result.requestedUrl}`, `Final URL: ${result.finalUrl}`, `Content type: ${result.contentType || 'unknown'}`, `Extraction: ${result.extractionSource}`, ...(result.bytes === undefined ? [] : [`Bytes: ${result.bytes}`, `Truncated: ${result.truncated}`]), '', result.content].join('\n');
}
