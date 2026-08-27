import { afterEach, describe, expect, it, vi } from 'vitest';
import { runHostedProgrammatic } from './programmatic.js';
import { PKG_VERSION } from '../version.js';

const externalDefaults = vi.hoisted(() => ({
  list: vi.fn(() => [{ name: 'gh', binary: 'gh' }]),
  run: vi.fn(() => 0),
}));

vi.mock('../external.js', () => ({
  loadExternalClis: externalDefaults.list,
  executeExternalCli: externalDefaults.run,
}));

const manifest = {
  userId: 'u1',
  metadata: {
    contractSchemaVersion: 1,
    sessionProtocolVersion: 1,
    webcmdPackageVersion: '0.7.4',
    generatedAt: new Date(0).toISOString(),
  },
  commands: [],
};

function fakeCloud(handler?: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const response = handler
      ? handler(url, init)
      : new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
    if (!url.endsWith('/v1/manifest')) return response;
    return new Response(JSON.stringify({ ok: true, manifest: await response.json() }), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('runHostedProgrammatic', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns captured stdout and a zero exit code', async () => {
    const result = await runHostedProgrammatic({
      argv: ['list', '-f', 'json'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 'oauth-access-token',
      fetchImpl: fakeCloud(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.stdoutByteSize).toBe(Buffer.byteLength(result.stdout));
    expect(JSON.parse(result.stdout)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'web/fetch' }),
    ]));
  });

  it('advertises server-safe web fetch only when explicitly enabled', async () => {
    const result = await runHostedProgrammatic({
      argv: ['list', '-f', 'json'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 'oauth-access-token',
      fetchImpl: fakeCloud(),
      enableServerWebFetch: true,
    });
    expect(JSON.parse(result.stdout)).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'web/fetch', clientOwned: true }),
    ]));
  });

  it('does not execute web fetch without the explicit public-network capability', async () => {
    const publicFetch = vi.spyOn(globalThis, 'fetch');
    const result = await runHostedProgrammatic({
      argv: ['web', 'fetch', '--url', 'https://93.184.216.34/'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 'oauth-access-token',
      fetchImpl: fakeCloud(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Site "web" is not installed.');
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('uses the authoritative hosted parser and markdown renderer for server-safe web fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('public body', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));
    const result = await runHostedProgrammatic({
      argv: ['web', 'fetch', '--url', 'https://93.184.216.34/article', '--raw'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 'oauth-access-token',
      fetchImpl: fakeCloud(),
      enableServerWebFetch: true,
    });
    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    expect(result).toMatchObject({ resolvedCommand: 'web/fetch', accessClass: 'read' });
    expect(result.stdout).toContain('# Fetched content');
    expect(result.stdout).toContain('Source: https://93.184.216.34/article');
    expect(result.stdout).toContain('public body');
  });

  it('rejects --allow-private before any public fetch', async () => {
    const publicFetch = vi.spyOn(globalThis, 'fetch');
    const result = await runHostedProgrammatic({
      argv: ['web', 'fetch', '--url', 'http://127.0.0.1/secret', '--allow-private'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 'oauth-access-token',
      fetchImpl: fakeCloud(),
      enableServerWebFetch: true,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--allow-private is not available in hosted mode');
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('returns a stable unsafe-address failure for a normalized metadata hostname without public fetch', async () => {
    const publicFetch = vi.spyOn(globalThis, 'fetch');
    const result = await runHostedProgrammatic({
      argv: ['web', 'fetch', '--url', 'http://MeTaDaTa.GoOgLe.InTeRnAl./computeMetadata/v1/'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 'oauth-access-token',
      fetchImpl: fakeCloud(),
      enableServerWebFetch: true,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('code: FETCH_UNSAFE_ADDRESS');
    expect(result.stderr).toContain('Unsafe fetch destination: metadata.google.internal');
    expect(result).toMatchObject({ resolvedCommand: 'web/fetch', accessClass: 'read' });
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('propagates caller cancellation through hosted web fetch as exit 130', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      started();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const pending = runHostedProgrammatic({
      argv: ['web', 'fetch', '--url', 'https://93.184.216.34/'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 'oauth-access-token',
      fetchImpl: fakeCloud(),
      enableServerWebFetch: true,
      signal: controller.signal,
    });
    await requestStarted;
    controller.abort(new Error('request disconnected'));
    const result = await pending;
    expect(result.exitCode).toBe(130);
    expect(result.stderr).toContain('INTERRUPTED');
  });

  it('presents the access token as a bearer credential', async () => {
    let authorization: string | undefined;
    await runHostedProgrammatic({
      argv: ['list'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 'oauth-access-token',
      fetchImpl: fakeCloud((_url, init) => {
        authorization = (init?.headers as Record<string, string>)?.authorization;
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });
    expect(authorization).toBe('Bearer oauth-access-token');
  });

  it('calls only the injected api base url', async () => {
    const urls: string[] = [];
    await runHostedProgrammatic({
      argv: ['list'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 't',
      fetchImpl: fakeCloud((url) => {
        urls.push(url);
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    });
    expect(urls.every((url) => url.startsWith('http://127.0.0.1:8787/v1/'))).toBe(true);
    expect(urls.some((url) => url.includes('/mcp'))).toBe(false);
  });

  it('does not load or execute local externals from the programmatic runner', async () => {
    externalDefaults.list.mockClear();
    externalDefaults.run.mockClear();

    const result = await runHostedProgrammatic({
      argv: ['gh', '--version'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 't',
      fetchImpl: fakeCloud(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${PKG_VERSION}\n`);
    expect(result.stderr).toBe('');
    expect(externalDefaults.list).not.toHaveBeenCalled();
    expect(externalDefaults.run).not.toHaveBeenCalled();
  });

  it('truncates oversized stdout without failing the invocation', async () => {
    const big = 'x'.repeat(300 * 1024);
    const result = await runHostedProgrammatic({
      argv: ['list', '-f', 'json'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 't',
      stdoutLimitBytes: 1024,
      fetchImpl: fakeCloud(() =>
        new Response(JSON.stringify({
          ...manifest,
          commands: [{
            site: 'github', name: 'search', command: 'github search',
            description: big, access: 'read', strategy: 'PUBLIC', browser: false,
            args: [], columns: [],
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1024);
    expect(result.stdoutByteSize).toBeGreaterThan(1024);
  });

  it('treats shell metacharacters as literal argv', async () => {
    const bodies: string[] = [];
    const result = await runHostedProgrammatic({
      argv: ['github', 'search', '--query', 'a; rm -rf / && echo $(whoami)'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 't',
      fetchImpl: fakeCloud((url, init) => {
        if (typeof init?.body === 'string') bodies.push(init.body);
        return new Response(
          JSON.stringify(
            url.endsWith('/v1/manifest')
              ? {
                  ...manifest,
                  commands: [
                    {
                      site: 'github', name: 'search', command: 'github search',
                      description: 'Search', access: 'read', strategy: 'PUBLIC', browser: false,
                      args: [{ name: 'query', type: 'string', required: true }], columns: [],
                    },
                  ],
                }
              : { ok: true, result: [], execution: { id: 'exec_1', command: 'github search', status: 'succeeded' } },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    });
    const executeBody = bodies.find((b) => b.includes('"command"'));
    expect(executeBody).toBeDefined();
    expect(JSON.parse(executeBody!).args.query).toBe('a; rm -rf / && echo $(whoami)');
    expect(result).toMatchObject({ resolvedCommand: 'github search', accessClass: 'read' });
    expect(result.resolvedCommand).not.toContain('rm -rf');
  });

  it('omits resolution metadata for an unresolved command path', async () => {
    const result = await runHostedProgrammatic({
      argv: ['missing', 'command'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 't',
      fetchImpl: fakeCloud(),
    });
    expect(result).not.toHaveProperty('resolvedCommand');
    expect(result).not.toHaveProperty('accessClass');
  });

  it.each([
    ['command', 'github/search\nforged'],
    ['access', 'read\nadmin'],
  ])('rejects control-bearing manifest %s without exposing trusted resolution metadata', async (field, value) => {
    const command = {
      site: 'github', name: 'search', command: 'github/search',
      description: 'Search', access: 'read', strategy: 'PUBLIC', browser: false,
      args: [{ name: 'query', type: 'string', required: true }], columns: [],
      [field]: value,
    };
    const result = await runHostedProgrammatic({
      argv: ['github', 'search', '--query', 'safe'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 't',
      fetchImpl: fakeCloud((url) => new Response(JSON.stringify(
        url.endsWith('/v1/manifest') ? { ...manifest, commands: [command] } : { ok: true },
      ), { status: 200, headers: { 'content-type': 'application/json' } })),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result).not.toHaveProperty('resolvedCommand');
    expect(result).not.toHaveProperty('accessClass');
  });

  it('reads no ambient stdin, env, or home directory', async () => {
    const result = await runHostedProgrammatic({
      argv: ['browser', 'run', '--stdin'],
      apiBaseUrl: 'http://127.0.0.1:8787',
      accessToken: 't',
      fetchImpl: fakeCloud(),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/stdin/i);
  });
});
