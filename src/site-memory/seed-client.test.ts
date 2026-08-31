import { describe, expect, it, vi } from 'vitest';
import { createHttpSeedProvider } from './seed-client.js';

describe('global seed client', () => {
  it('GETs the punycode seed URL without credentials and returns the JSON contract', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.webcmd.dev/v1/site-memory/seeds/xn--bcher-kva.example');
      expect(init?.method ?? 'GET').toBe('GET');
      expect(init?.credentials).toBe('omit');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBeNull();
      return jsonResponse({
        revision: 'seed-1',
        site: '# Bücher\n',
        references: { 'old.md': '# Old\n' },
      });
    });

    const result = await createHttpSeedProvider({ fetch, env: {} }).lookup('xn--bcher-kva.example');

    expect(result).toEqual({
      status: 'available',
      revision: 'seed-1',
      site: '# Bücher\n',
      references: { 'old.md': '# Old\n' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses WEBCMD_GLOBAL_MEMORY_URL as the request base', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://memory.example/v1/site-memory/seeds/example.test');
      return jsonResponse({ revision: 'r1', site: '# Example\n' });
    });

    await createHttpSeedProvider({
      fetch,
      env: { WEBCMD_GLOBAL_MEMORY_URL: 'https://memory.example/' },
    }).lookup('example.test');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats HTTP 404 as absent', async () => {
    const result = await createHttpSeedProvider({
      fetch: async () => new Response('missing', { status: 404 }),
      env: {},
    }).lookup('missing.test');

    expect(result).toEqual({ status: 'absent' });
  });

  it('aborts after two seconds and does not retry', async () => {
    let calls = 0;
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('aborted'));
        });
      });
    });

    const started = Date.now();
    const result = await createHttpSeedProvider({ fetch, env: {} }).lookup('slow.test');

    expect(result).toEqual({ status: 'lookup-failed' });
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('treats offline and malformed responses as lookup-failed', async () => {
    const offline = await createHttpSeedProvider({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
      env: {},
    }).lookup('offline.test');
    const malformed = await createHttpSeedProvider({
      fetch: async () => jsonResponse({ nope: true }),
      env: {},
    }).lookup('bad.test');
    const unsafe = await createHttpSeedProvider({
      fetch: async () => jsonResponse({
        revision: 'r1',
        site: '# Site\n',
        references: { '../evil.md': '# no\n' },
      }),
      env: {},
    }).lookup('evil.test');

    const notMarkdown = await createHttpSeedProvider({
      fetch: async () => jsonResponse({
        revision: 'r1',
        site: '# Site\n',
        references: { 'foo.txt': '# no\n' },
      }),
      env: {},
    }).lookup('txt.test');

    expect(offline).toEqual({ status: 'lookup-failed' });
    expect(malformed).toEqual({ status: 'lookup-failed' });
    expect(unsafe).toEqual({ status: 'lookup-failed' });
    expect(notMarkdown).toEqual({ status: 'lookup-failed' });
  });

  it('skips lookup when WEBCMD_GLOBAL_MEMORY=off', async () => {
    const fetch = vi.fn();

    const result = await createHttpSeedProvider({
      fetch,
      env: { WEBCMD_GLOBAL_MEMORY: 'off' },
    }).lookup('example.test');

    expect(result).toEqual({ status: 'unattempted' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
