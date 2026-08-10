import { describe, expect, it, vi } from 'vitest';
import { webFetch } from './client.js';

function response(body: string, status = 200, headers: Record<string, string> = { 'content-type': 'text/plain' }) { return new Response(body, { status, headers }); }
describe('webFetch', () => {
  it('uses healthy plain responses without escalation', async () => {
    const plainFetch = vi.fn().mockResolvedValue(response('ok'));
    const createImpit = vi.fn();
    const result = await webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false }, { plainFetch, createImpit, createSafeProxy: async () => ({ url: 'http://proxy', close: async () => {} }) });
    expect(result).toMatchObject({ tier: 'plain', content: 'ok' });
    expect(createImpit).not.toHaveBeenCalled();
  });
  it('escalates challenge responses through Chrome then Firefox', async () => {
    const first = { fetch: vi.fn().mockResolvedValue(response('challenge', 403, { server: 'cloudflare', 'content-type': 'text/plain' })) };
    const second = { fetch: vi.fn().mockResolvedValue(response('ok')) };
    const createImpit = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const result = await webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false }, { plainFetch: vi.fn().mockResolvedValue(response('challenge', 403, { server: 'cloudflare', 'content-type': 'text/plain' })), createImpit, createSafeProxy: async () => ({ url: 'http://proxy', close: async () => {} }) });
    expect(result).toMatchObject({ tier: 'impit', profile: 'firefox', content: 'ok' });
    expect(createImpit).toHaveBeenNthCalledWith(1, expect.objectContaining({ browser: 'chrome' }));
    expect(createImpit).toHaveBeenNthCalledWith(2, expect.objectContaining({ browser: 'firefox' }));
  });
  it('closes the safe proxy even when the ladder throws', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    await expect(webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false }, {
      plainFetch: vi.fn().mockRejectedValue(new Error('boom')),
      createImpit: vi.fn(),
      createSafeProxy: async () => ({ url: 'http://proxy', close }),
    })).rejects.toThrow('boom');
    expect(close).toHaveBeenCalledOnce();
  });
  it('reports an aborted fetch as a structured timeout', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    await expect(webFetch({ url: 'https://example.com', timeoutSeconds: 5, maxChars: 0, allowPrivate: false }, {
      plainFetch: vi.fn().mockRejectedValue(abort),
      createImpit: vi.fn(),
      createSafeProxy: async () => ({ url: 'http://proxy', close: async () => {} }),
    })).rejects.toMatchObject({ code: 'TIMEOUT', message: 'web fetch timed out after 5s' });
  });
});
