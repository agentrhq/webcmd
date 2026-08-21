import { describe, expect, it } from 'vitest';
import { runHostedProgrammatic } from './programmatic.js';

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
    expect(JSON.parse(result.stdout)).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'web/fetch', clientOwned: true }),
    ]));
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
    await runHostedProgrammatic({
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
