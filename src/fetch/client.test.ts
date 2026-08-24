import { describe, expect, it, vi } from 'vitest';
import { CliError } from '../errors.js';
import { webFetch } from './client.js';

function response(body: string, status = 200, headers: Record<string, string> = { 'content-type': 'text/plain' }) { return new Response(body, { status, headers }); }
const safeProxy = (close = vi.fn().mockResolvedValue(undefined), policyError: () => Error | undefined = () => undefined) => ({ url: 'http://proxy', close, policyError });
describe('webFetch', () => {
  const html = '<html><head><title>T</title></head><body><article><p>Article body that readability keeps.</p></article><script>var a=1;</script></body></html>';
  it('returns the unprocessed body with metadata when raw is set', async () => {
    const plainFetch = vi.fn().mockResolvedValue(response(html, 200, { 'content-type': 'text/html; charset=utf-8' }));
    const result = await webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false, raw: true }, { plainFetch, createImpit: vi.fn(), createSafeProxy: async () => safeProxy() });
    expect(result).toMatchObject({ status: 200, finalUrl: 'https://example.com', contentType: 'text/html; charset=utf-8', extractionSource: 'raw', truncated: false, bytes: Buffer.byteLength(html) });
    expect(result.content).toBe(html);
  });
  it('extracts and omits raw metadata without the raw flag', async () => {
    const plainFetch = vi.fn().mockResolvedValue(response(html, 200, { 'content-type': 'text/html; charset=utf-8' }));
    const result = await webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false }, { plainFetch, createImpit: vi.fn(), createSafeProxy: async () => safeProxy() });
    expect(result.content).not.toContain('<script>');
    expect(result.content).toContain('Article body');
    expect(result.bytes).toBeUndefined();
  });
  it('reports raw truncation instead of cutting silently', async () => {
    const plainFetch = vi.fn().mockResolvedValue(response(html, 200, { 'content-type': 'text/html' }));
    const result = await webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 20, allowPrivate: false, raw: true }, { plainFetch, createImpit: vi.fn(), createSafeProxy: async () => safeProxy() });
    expect(result.truncated).toBe(true);
    expect(result.content).toBe(`${html.slice(0, 20)}\n\n[webcmd: truncated at 20 characters; rerun with --max-chars 0]`);
  });
  it('still blocks a challenge response when raw is set', async () => {
    await expect(webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false, raw: true }, {
      plainFetch: vi.fn().mockImplementation(async () => response('challenge', 403, { server: 'cloudflare', 'content-type': 'text/html' })),
      createImpit: vi.fn(() => ({ fetch: vi.fn().mockImplementation(async () => response('challenge', 403, { server: 'cloudflare', 'content-type': 'text/html' })) })),
      createSafeProxy: async () => safeProxy(),
    })).rejects.toMatchObject({ code: 'FETCH_BLOCKED' });
  });
  it('uses healthy plain responses without escalation', async () => {
    const plainFetch = vi.fn().mockResolvedValue(response('ok'));
    const createImpit = vi.fn();
    const result = await webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false }, { plainFetch, createImpit, createSafeProxy: async () => safeProxy() });
    expect(result).toMatchObject({ tier: 'plain', content: 'ok' });
    expect(createImpit).not.toHaveBeenCalled();
  });
  it('escalates challenge responses through Chrome then Firefox', async () => {
    const first = { fetch: vi.fn().mockResolvedValue(response('challenge', 403, { server: 'cloudflare', 'content-type': 'text/plain' })) };
    const second = { fetch: vi.fn().mockResolvedValue(response('ok')) };
    const createImpit = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const result = await webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false }, { plainFetch: vi.fn().mockResolvedValue(response('challenge', 403, { server: 'cloudflare', 'content-type': 'text/plain' })), createImpit, createSafeProxy: async () => safeProxy() });
    expect(result).toMatchObject({ tier: 'impit', profile: 'firefox', content: 'ok' });
    expect(createImpit).toHaveBeenNthCalledWith(1, expect.objectContaining({ browser: 'chrome' }));
    expect(createImpit).toHaveBeenNthCalledWith(2, expect.objectContaining({ browser: 'firefox' }));
  });
  it('closes the safe proxy even when the ladder throws', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    await expect(webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false }, {
      plainFetch: vi.fn().mockRejectedValue(new Error('boom')),
      createImpit: vi.fn(() => ({ fetch: vi.fn().mockRejectedValue(new Error('boom')) })),
      createSafeProxy: async () => safeProxy(close),
    })).rejects.toThrow('boom');
    expect(close).toHaveBeenCalledOnce();
  });
  it('reports an aborted fetch as a structured timeout', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    await expect(webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false }, {
      plainFetch: vi.fn().mockRejectedValue(abort),
      createImpit: vi.fn(() => ({ fetch: vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })) })),
      createSafeProxy: async () => safeProxy(),
    })).rejects.toMatchObject({ code: 'TIMEOUT', message: 'web fetch timed out after 5s' });
  });
  it('reports an impit-shaped deadline as a structured timeout', async () => {
    // impit reports its own deadline as a plain Error — no TimeoutError/AbortError
    // name to match on — so the budget having elapsed is what identifies it.
    const impitTimeout = new Error('error sending request for url (https://example.com/): operation timed out');
    await expect(webFetch({ url: 'https://example.com', timeoutSeconds: 0.05, maxChars: 0, allowPrivate: false }, {
      plainFetch: vi.fn().mockImplementation(async () => { await new Promise(done => setTimeout(done, 80)); throw impitTimeout; }),
      createImpit: vi.fn(() => ({ fetch: vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })) })),
      createSafeProxy: async () => safeProxy(),
    })).rejects.toMatchObject({ code: 'TIMEOUT', message: 'web fetch timed out after 0.05s' });
  });
  it('times out a body read and closes the proxy', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn();
    const hanging = {
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      url: 'https://example.com',
      body: new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel }),
    };
    await expect(webFetch({ url: 'https://example.com', timeoutSeconds: 0.05, maxChars: 0, allowPrivate: false }, {
      plainFetch: vi.fn().mockResolvedValue(hanging),
      createImpit: vi.fn(),
      createSafeProxy: async () => safeProxy(close),
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  it('does not relabel a failure that happened with budget left', async () => {
    await expect(webFetch({ url: 'https://example.com', timeoutSeconds: 30, maxChars: 0, allowPrivate: false }, {
      plainFetch: vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      createImpit: vi.fn(() => ({ fetch: vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })) })),
      createSafeProxy: async () => safeProxy(),
    })).rejects.toThrow('connect ECONNREFUSED');
  });
});

describe('webFetch fixed non-browser ladder', () => {
  const options = { url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false };
  const challenge = () => response('Just a moment', 403, { server: 'cloudflare', 'content-type': 'text/plain' });

  it.each([
    ['plain challenge reaches Chrome', [challenge()], [response('chrome')], ['chrome'], { tier: 'impit', profile: 'chrome' }],
    ['two challenges reach Firefox', [challenge()], [challenge(), response('firefox')], ['chrome', 'firefox'], { tier: 'impit', profile: 'firefox' }],
  ])('%s', async (_name, plainResponses, impitResponses, createdProfiles, expected) => {
    const impits = impitResponses.map(value => ({ fetch: vi.fn().mockResolvedValue(value) }));
    const createImpit = vi.fn().mockImplementation(() => impits.shift());
    const result = await webFetch(options, { plainFetch: vi.fn().mockResolvedValue(plainResponses[0]), createImpit, createSafeProxy: async () => safeProxy() });
    expect(createImpit.mock.calls.map(([value]) => value.browser)).toEqual(createdProfiles);
    expect(result).toMatchObject(expected);
  });

  it('advances transport failures through Firefox', async () => {
    const createdProfiles: string[] = [];
    const createImpit = vi.fn(({ browser }) => {
      createdProfiles.push(browser);
      return { fetch: vi.fn().mockImplementation(() => browser === 'chrome' ? Promise.reject(new Error('TLS')) : Promise.resolve(response('firefox'))) };
    });
    const result = await webFetch(options, { plainFetch: vi.fn().mockRejectedValue(new Error('socket')), createImpit, createSafeProxy: async () => safeProxy() });
    expect(createdProfiles).toEqual(['chrome', 'firefox']);
    expect(result).toMatchObject({ tier: 'impit', profile: 'firefox' });
  });

  it('gives Chrome and Firefox decreasing positive timeouts from one deadline', async () => {
    const createImpit = vi.fn((_options: { browser: 'chrome' | 'firefox'; proxyUrl: string; timeout: number }) => ({ fetch: vi.fn().mockImplementation(async () => { await new Promise(done => setTimeout(done, 5)); return challenge(); }) }));
    await expect(webFetch({ ...options, timeoutSeconds: 1 }, { plainFetch: vi.fn().mockResolvedValue(challenge()), createImpit, createSafeProxy: async () => safeProxy() })).rejects.toMatchObject({ code: 'FETCH_BLOCKED' });
    const timeouts = createImpit.mock.calls.map(([value]) => value.timeout);
    expect(timeouts).toHaveLength(2);
    expect(timeouts[0]).toBeGreaterThan(timeouts[1]);
    expect(timeouts[1]).toBeGreaterThan(0);
  });

  it('stops terminal errors and uses the explicit Session workflow', async () => {
    const createImpit = vi.fn();
    await expect(webFetch(options, { plainFetch: vi.fn().mockResolvedValue(response('<div id="root"></div><script>boot()</script>')), createImpit, createSafeProxy: async () => safeProxy() })).rejects.toMatchObject({ code: 'FETCH_REQUIRES_BROWSER', hint: expect.stringContaining('session create') });
    expect(createImpit).not.toHaveBeenCalled();
    await expect(webFetch(options, { plainFetch: vi.fn().mockRejectedValue(new CliError('FETCH_BODY_TOO_LARGE', 'large')), createImpit, createSafeProxy: async () => safeProxy() })).rejects.toMatchObject({ code: 'FETCH_BODY_TOO_LARGE' });
    expect(createImpit).not.toHaveBeenCalled();
  });

  it('stops for a proxy policy error and closes once', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const createImpit = vi.fn();
    await expect(webFetch(options, { plainFetch: vi.fn().mockRejectedValue(new Error('proxy failure')), createImpit, createSafeProxy: async () => safeProxy(close, () => new Error('Unsafe fetch destination: 127.0.0.1')) })).rejects.toMatchObject({ code: 'FETCH_UNSAFE_ADDRESS' });
    expect(createImpit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('returns blocked after three completed challenges with the explicit Session workflow', async () => {
    const createImpit = vi.fn().mockReturnValueOnce({ fetch: vi.fn().mockResolvedValue(challenge()) }).mockReturnValueOnce({ fetch: vi.fn().mockResolvedValue(challenge()) });
    await expect(webFetch(options, { plainFetch: vi.fn().mockResolvedValue(challenge()), createImpit, createSafeProxy: async () => safeProxy() })).rejects.toMatchObject({ code: 'FETCH_BLOCKED', hint: expect.stringContaining('browser run --stdin') });
  });
});
