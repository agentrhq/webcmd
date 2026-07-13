import { describe, expect, it } from 'vitest';
import { HostedClient, HostedClientError } from './client.js';

describe('HostedClient', () => {
  it('sends bearer auth and parses hosted manifest', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com/',
      apiKey: 'wcmd_live_test',
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: new Headers(init?.headers).get('authorization'),
        });
        return new Response(JSON.stringify({
          ok: true,
          manifest: { userId: 'user_demo', generatedAt: 'now', commands: [] },
        }), { status: 200 });
      },
    });

    await expect(client.getManifest()).resolves.toEqual({
      userId: 'user_demo',
      generatedAt: 'now',
      commands: [],
    });
    expect(requests).toEqual([{ url: 'https://api.example.com/v1/manifest', authorization: 'Bearer wcmd_live_test' }]);
  });

  it('maps hosted error envelopes to CliError-compatible errors', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'bad',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid key',
          help: 'Run setup',
          exitCode: 77,
        },
      }), { status: 401 }),
    });

    await expect(client.getManifest()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid key',
      hint: 'Run setup',
      exitCode: 77,
    } satisfies Partial<HostedClientError>);
  });

  it('runs hosted browser lifecycle calls and finishes the execution', async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'wcmd_live_test',
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
        });
        if (String(url).endsWith('/runs')) {
          return new Response(JSON.stringify({
            ok: true,
            run: {
              executionId: 'exec_1',
              session: 'work',
              profile: { id: 'profile_default', displayName: 'default' },
            },
          }), { status: 201 });
        }
        if (String(url).endsWith('/actions')) {
          return new Response(JSON.stringify({
            ok: true,
            result: { url: 'https://example.com' },
            columns: ['url'],
            trace: null,
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          ok: true,
          execution: { id: 'exec_1', status: 'succeeded' },
        }), { status: 200 });
      },
    });

    await expect(client.runBrowserAction('work', {
      command: 'browser/open',
      action: 'navigate',
      args: { url: 'https://example.com' },
      profile: 'default',
      windowMode: 'background',
    })).resolves.toMatchObject({
      result: { url: 'https://example.com' },
      execution: { id: 'exec_1', status: 'succeeded' },
    });
    expect(requests).toEqual([
      {
        url: 'https://api.example.com/v1/browser/work/runs',
        body: {
          command: 'browser/open',
          args: { url: 'https://example.com' },
          profile: 'default',
          windowMode: 'background',
        },
      },
      {
        url: 'https://api.example.com/v1/browser/work/runs/exec_1/actions',
        body: {
          action: 'navigate',
          args: { url: 'https://example.com' },
          profile: 'default',
        },
      },
      {
        url: 'https://api.example.com/v1/browser/work/runs/exec_1/finish',
        body: {
          status: 'succeeded',
          profile: 'default',
        },
      },
    ]);
  });
});
