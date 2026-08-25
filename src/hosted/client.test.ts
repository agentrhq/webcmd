import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostedClient, HostedClientError, resolveWorkspace } from './client.js';

const invalidTraceUrlCases = [
  {
    name: 'raw absolute provider URL with token',
    field: 'liveViewUrl',
    value: 'https://provider.example/session/secret?token=provider-secret-token',
    executionId: 'exec_trace',
  },
  {
    name: 'protocol-relative provider URL',
    field: 'replayUrl',
    value: '//provider.example/replay/secret',
    executionId: 'exec_trace',
  },
  {
    name: 'public path with query token',
    field: 'artifactsUrl',
    value: '/v1/executions/exec_trace/artifacts?token=secret-query-token',
    executionId: 'exec_trace',
  },
  {
    name: 'public path with hash token',
    field: 'replayUrl',
    value: '/v1/executions/exec_trace/replay#secret-hash-token',
    executionId: 'exec_trace',
  },
  {
    name: 'mismatched execution path',
    field: 'artifactsUrl',
    value: '/v1/executions/exec_other/artifacts',
    executionId: 'exec_trace',
  },
  {
    name: 'wrong resource suffix',
    field: 'artifactsUrl',
    value: '/v1/executions/exec_trace/live',
    executionId: 'exec_trace',
  },
  {
    name: 'unencoded execution ID path',
    field: 'artifactsUrl',
    value: '/v1/executions/exec/trace/artifacts',
    executionId: 'exec/trace',
  },
  {
    name: 'traversal path',
    field: 'artifactsUrl',
    value: '/v1/executions/../exec_trace/artifacts',
    executionId: 'exec_trace',
  },
  {
    name: 'traversal execution ID route',
    field: 'artifactsUrl',
    value: '/v1/executions/../artifacts',
    executionId: '..',
  },
  {
    name: 'near-match trailing slash',
    field: 'liveViewUrl',
    value: '/v1/executions/exec_trace/live/',
    executionId: 'exec_trace',
  },
] as const;

const validTraceUrlCases = [
  { field: 'artifactsUrl', suffix: 'artifacts', executionId: 'exec/trace' },
  { field: 'liveViewUrl', suffix: 'live', executionId: 'exec_trace' },
  { field: 'replayUrl', suffix: 'replay', executionId: 'exec_trace' },
] as const;

describe('HostedClient', () => {
  it('preserves a raw storage endpoint error envelope', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'SITE_MEMORY_NOT_FOUND', message: 'Missing notes.', exitCode: 66 },
      }), { status: 404 }),
    });

    await expect(client.readSiteMemory('github', 'notes.md')).rejects.toMatchObject({
      code: 'SITE_MEMORY_NOT_FOUND',
      exitCode: 66,
    });
  });

  it('uses raw storage endpoints for site memory and adapter source', async () => {
    const requests: Array<{ url: string; method: string; body?: string; contentType?: string | null }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url), method: init?.method ?? 'GET',
          ...(init?.body ? { body: String(init.body) } : {}),
          contentType: new Headers(init?.headers).get('content-type'),
        });
        if ((init?.method ?? 'GET') === 'GET') return new Response('export const search = true;');
        if (new URL(String(url)).pathname.startsWith('/v1/sites/')) return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ ok: true, package: { id: 'pkg_github', storagePath: 'clis/github' }, commands: ['github/search'] }));
      },
    });

    await client.writeSiteMemory('github', 'notes.md', JSON.stringify({ text: 'Uses GraphQL' }), 'application/json');
    await client.readSiteMemory('github', 'notes.md');
    await client.deleteSiteMemory('github', 'notes.md');
    await client.writeAdapterSource('pkg_github', 'clis/github/search.js', 'export const search = true;');
    await client.readAdapterSource('pkg_github', 'clis/github/search.js');

    expect(requests.map(({ url, method, contentType }) => ({ url, method, contentType }))).toEqual([
      { url: 'https://api.example.com/v1/sites/github/memory/notes.md', method: 'PUT', contentType: 'application/json' },
      { url: 'https://api.example.com/v1/sites/github/memory/notes.md', method: 'GET', contentType: null },
      { url: 'https://api.example.com/v1/sites/github/memory/notes.md', method: 'DELETE', contentType: null },
      { url: 'https://api.example.com/v1/adapters/pkg_github/source/clis/github/search.js', method: 'PUT', contentType: 'text/javascript; charset=utf-8' },
      { url: 'https://api.example.com/v1/adapters/pkg_github/source/clis/github/search.js', method: 'GET', contentType: null },
    ]);
  });

  it.each([
    { stale: true },
    { deleted: true },
  ])('accepts Cloud site-memory deletion response %j', async (result) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, ...result })),
    });

    await expect(client.deleteSiteMemory('github', 'endpoints.json', JSON.stringify({ name: 'search' }))).resolves.toBeUndefined();
  });

  it('accepts the hosted Session API wire contract', async () => {
    const requests: Array<{ url: string; method: string; body?: string; liveViewCapability: string | null }> = [];
    const session = {
      id: 'session_wire',
      kind: 'explicit',
      profileId: 'profile_default',
      runtimeState: 'active',
      handoff: { site: 'github', expiresAt: '2026-08-12T00:15:00.000Z' },
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:01:00.000Z',
      lastUsedAt: '2026-08-12T00:02:00.000Z',
    };
    const createdSession = { ...session, liveViewUrl: 'https://api.example.com/account/live/session_wire' };
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method ?? 'GET',
          ...(init?.body ? { body: String(init.body) } : {}),
          liveViewCapability: new Headers(init?.headers).get('x-webcmd-client-capabilities'),
        });
        if (String(url).endsWith('/v1/sessions')) return new Response(JSON.stringify({ ok: true, session: createdSession }));
        if (String(url).endsWith('/v1/sessions?profile=default&limit=20')) return new Response(JSON.stringify({ ok: true, sessions: [session] }));
        return new Response(JSON.stringify({ ok: true, closed: true, alreadyIdle: false, session: 'session_wire' }));
      },
    });

    await expect(client.createBrowserSession()).resolves.toEqual({ ok: true, session: createdSession });
    await expect(client.listBrowserSessions('default', 20)).resolves.toEqual({ ok: true, sessions: [session] });
    await expect(client.closeBrowserSession('session_wire')).resolves.toEqual({
      ok: true,
      closed: true,
      alreadyIdle: false,
      session: 'session_wire',
    });
    expect(requests.map(({ url, method, liveViewCapability }) => ({ url, method, liveViewCapability }))).toEqual([
      { url: 'https://api.example.com/v1/sessions', method: 'POST', liveViewCapability: 'hosted-live-view-v1' },
      { url: 'https://api.example.com/v1/sessions?profile=default&limit=20', method: 'GET', liveViewCapability: 'hosted-live-view-v1' },
      { url: 'https://api.example.com/v1/sessions/session_wire/close', method: 'POST', liveViewCapability: 'hosted-live-view-v1' },
    ]);
  });

  it('requires a creation live view, keeps session rows exact, and accepts only the prepared live view field', async () => {
    const session = {
      id: 'session_wire', kind: 'explicit', profileId: 'profile_default', runtimeState: 'active', handoff: null,
      createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:01:00.000Z', lastUsedAt: '2026-08-12T00:02:00.000Z',
    };
    let prepareBody: unknown;
    let prepareCapability: string | null = null;
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com', apiKey: 'key',
      fetchImpl: async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/v1/sessions' && init?.method === 'POST') return new Response(JSON.stringify({ ok: true, session }));
        if (pathname === '/v1/sessions' && (init?.method ?? 'GET') === 'GET') {
          return new Response(JSON.stringify({
            ok: true,
            sessions: [{ ...session, liveViewUrl: 'https://api.example.com/account/live/session_wire' }],
          }));
        }
        if (pathname === '/v1/executions') {
          prepareBody = JSON.parse(String(init?.body));
          prepareCapability = new Headers(init?.headers).get('x-webcmd-client-capabilities');
          const command = (prepareBody as { command: string }).command;
          return new Response(JSON.stringify({
            ok: true,
            execution: { id: 'exec_1', command, status: 'queued' },
            fileArguments: [],
            liveViewUrl: 'https://api.example.com/account/live/exec_1',
            ...(command === 'github/unknown' ? { unexpected: true } : {}),
          }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED', message: pathname, exitCode: 1 } }));
      },
    });

    await expect(client.createBrowserSession()).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
    await expect(client.listBrowserSessions()).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
    await expect(client.prepareExecution({
      command: 'github/whoami', profile: 'work', session: 'session_work', executionScope: 'profile',
    })).resolves.toMatchObject({
      liveViewUrl: 'https://api.example.com/account/live/exec_1',
    });
    expect(prepareBody).toEqual({
      command: 'github/whoami', profile: 'work', session: 'session_work', executionScope: 'profile',
    });
    expect(prepareCapability).toBe('hosted-live-view-v1');
    await expect(client.prepareExecution({ command: 'github/unknown' })).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it('searches the authenticated marketplace and validates every public plugin field', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? 'GET' });
        return new Response(JSON.stringify({
          ok: true,
          result: {
            plugins: [{
              name: 'mercury',
              description: 'Search Mercury',
              version: '0.7.1',
              sourceId: 'agentrhq/webcmd',
              installSource: 'github:agentrhq/webcmd/mercury',
              webcmd: '>=0.4.3',
              availability: 'mixed',
              excludedCommands: ['mercury/reimbursement-plan'],
            }, {
              name: 'hosted-plugin',
              sourceId: 'agentrhq/webcmd',
              installSource: 'github:agentrhq/webcmd/hosted-plugin',
              availability: 'hosted',
              excludedCommands: [],
            }, {
              name: 'local-plugin',
              sourceId: 'agentrhq/webcmd',
              installSource: 'github:agentrhq/webcmd/local-plugin',
              availability: 'local-only',
              excludedCommands: ['local-plugin/run'],
            }],
            errors: [],
          },
        }));
      },
    });

    await expect(client.searchMarketplacePlugins('Acme & Co')).resolves.toEqual({
      plugins: [{
        name: 'mercury',
        description: 'Search Mercury',
        version: '0.7.1',
        sourceId: 'agentrhq/webcmd',
        installSource: 'github:agentrhq/webcmd/mercury',
        webcmd: '>=0.4.3',
        availability: 'mixed',
        excludedCommands: ['mercury/reimbursement-plan'],
      }, {
        name: 'hosted-plugin',
        sourceId: 'agentrhq/webcmd',
        installSource: 'github:agentrhq/webcmd/hosted-plugin',
        availability: 'hosted',
        excludedCommands: [],
      }, {
        name: 'local-plugin',
        sourceId: 'agentrhq/webcmd',
        installSource: 'github:agentrhq/webcmd/local-plugin',
        availability: 'local-only',
        excludedCommands: ['local-plugin/run'],
      }],
      errors: [],
    });
    await expect(client.searchMarketplacePlugins()).resolves.toMatchObject({ errors: [] });
    expect(requests).toEqual([
      { url: 'https://api.example.com/v1/marketplace/plugins?query=Acme+%26+Co', method: 'GET' },
      { url: 'https://api.example.com/v1/marketplace/plugins', method: 'GET' },
    ]);
  });

  it.each([
    { availability: 'unsupported', excludedCommands: [] },
    { availability: 'hosted', excludedCommands: ['valid-command', 1] },
  ])('rejects malformed marketplace availability fields', async (plugin) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: {
          plugins: [{
            name: 'invalid',
            sourceId: 'agentrhq/webcmd',
            installSource: 'github:agentrhq/webcmd/invalid',
            ...plugin,
          }],
          errors: [],
        },
      })),
    });

    await expect(client.searchMarketplacePlugins()).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it('preserves a local-only marketplace install failure from Cloud', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'MARKETPLACE_PLUGIN_LOCAL_ONLY',
          message: 'This plugin is only available in local mode.',
          help: 'Run `webcmd setup` and choose local mode to install this plugin.',
        },
      }), { status: 409 }),
    });

    await expect(client.installMarketplacePlugin('github:agentrhq/webcmd/local-only')).rejects.toMatchObject({
      code: 'MARKETPLACE_PLUGIN_LOCAL_ONLY',
      hint: 'Run `webcmd setup` and choose local mode to install this plugin.',
    });
  });

  it('installs a marketplace plugin through the authenticated API', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method ?? 'GET',
          ...(init?.body ? { body: String(init.body) } : {}),
        });
        return new Response(JSON.stringify({
          ok: true,
          result: {
            installationId: 'install_acme',
            name: 'acme',
            version: '1.0.0',
            installSource: 'github:agentrhq/webcmd/acme',
          },
        }));
      },
    });

    await expect(client.installMarketplacePlugin('github:agentrhq/webcmd/acme')).resolves.toMatchObject({ name: 'acme' });
    expect(requests).toEqual([{
      url: 'https://api.example.com/v1/marketplace/installations',
      method: 'POST',
      body: JSON.stringify({ installSource: 'github:agentrhq/webcmd/acme' }),
    }]);
  });

  it('lists marketplace installations through the authenticated API', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: {
          installations: [{
            name: 'alpha', version: '0.1.0', installSource: 'github:agentrhq/webcmd/alpha',
            sourceCommit: null, installedAt: '2026-08-07T00:00:00.000Z', updateAvailable: false,
          }],
        },
      })),
    });

    await expect(client.listMarketplaceInstallations()).resolves.toEqual([{
      name: 'alpha', version: '0.1.0', installSource: 'github:agentrhq/webcmd/alpha',
      sourceCommit: null, installedAt: '2026-08-07T00:00:00.000Z', updateAvailable: false,
    }]);
  });

  it('uninstalls a marketplace plugin through the authenticated API', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? 'GET' });
        return new Response(JSON.stringify({ ok: true, result: { uninstalled: true } }));
      },
    });

    await expect(client.uninstallMarketplacePlugin('alpha')).resolves.toEqual({ uninstalled: true });
    expect(requests).toEqual([{ url: 'https://api.example.com/v1/marketplace/installations/alpha', method: 'DELETE' }]);
  });

  it('accepts the ordinary 3-key update response', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: { updated: true, name: 'alpha', version: '0.2.0' },
      })),
    });

    await expect(client.updateMarketplacePlugin('alpha')).resolves.toEqual({
      updated: true, name: 'alpha', version: '0.2.0',
    });
  });

  it('accepts the 4-key delisted update response', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: { updated: false, name: 'alpha', version: '0.1.0', delisted: true },
      })),
    });

    await expect(client.updateMarketplacePlugin('alpha')).resolves.toEqual({
      updated: false, name: 'alpha', version: '0.1.0', delisted: true,
    });
  });

  it('rejects an update response with delisted: false as protocol-invalid', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: { updated: false, name: 'alpha', version: '0.1.0', delisted: false },
      })),
    });

    await expect(client.updateMarketplacePlugin('alpha')).rejects.toThrow(HostedClientError);
  });

  it('sends bearer auth and parses hosted manifest', async () => {
    const requests: Array<{ url: string; authorization: string | null; sessionProtocol: string | null }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com/',
      apiKey: 'wcmd_live_test',
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: new Headers(init?.headers).get('authorization'),
          sessionProtocol: new Headers(init?.headers).get('x-webcmd-session-protocol-version'),
        });
        return new Response(JSON.stringify({
          ok: true,
          manifest: {
            userId: 'user_demo',
            metadata: {
              contractSchemaVersion: 1,
              sessionProtocolVersion: 1,
              webcmdPackageVersion: '0.3.0',
              generatedAt: 'now',
            },
            commands: [],
          },
        }), { status: 200 });
      },
    });

    await expect(client.getManifest()).resolves.toEqual({
      userId: 'user_demo',
      metadata: {
        contractSchemaVersion: 1,
        sessionProtocolVersion: 1,
        webcmdPackageVersion: '0.3.0',
        generatedAt: 'now',
      },
      commands: [],
    });
    expect(requests).toEqual([{
      url: 'https://api.example.com/v1/manifest',
      authorization: 'Bearer wcmd_live_test',
      sessionProtocol: '1',
    }]);
  });

  it('accepts boolean freshPage command metadata', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        manifest: {
          userId: 'user_demo',
          metadata: {
            contractSchemaVersion: 1,
            sessionProtocolVersion: 1,
            webcmdPackageVersion: '0.3.0',
            generatedAt: 'now',
          },
          commands: [{
            site: 'district',
            name: 'checkout',
            command: 'district/checkout',
            description: 'Checkout',
            access: 'write',
            strategy: 'UI',
            browser: true,
            args: [],
            columns: [],
            freshPage: true,
          }],
        },
      }), { status: 200 }),
    });

    await expect(client.getManifest()).resolves.toMatchObject({
      commands: [expect.objectContaining({ freshPage: true })],
    });
  });

  it('reports a missing Session protocol capability as a contract mismatch', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com', apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        manifest: {
          userId: 'user_demo',
          metadata: { contractSchemaVersion: 1, webcmdPackageVersion: '0.6.1', generatedAt: 'now' },
          commands: [],
        },
      }), { status: 200 }),
    });

    await expect(client.getManifest()).rejects.toMatchObject({ code: 'HOSTED_CONTRACT_MISMATCH' });
  });

  it('accepts string-array search metadata in hosted manifest commands', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        manifest: {
          userId: 'user_demo',
          metadata: {
            contractSchemaVersion: 1,
            sessionProtocolVersion: 1,
            webcmdPackageVersion: '0.3.0',
            generatedAt: 'now',
          },
          commands: [{
            site: 'metadata',
            name: 'search',
            command: 'metadata/search',
            description: 'Search metadata',
            access: 'read',
            strategy: 'PUBLIC',
            browser: false,
            args: [],
            columns: ['title'],
            tags: ['search'],
            keywords: ['lookup', 'discovery'],
          }],
        },
      }), { status: 200 }),
    });

    await expect(client.getManifest()).resolves.toMatchObject({
      commands: [expect.objectContaining({
        tags: ['search'],
        keywords: ['lookup', 'discovery'],
      })],
    });
  });

  it('rejects non-string search metadata in hosted manifest commands', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        manifest: {
          userId: 'user_demo',
          metadata: {
            contractSchemaVersion: 1,
            sessionProtocolVersion: 1,
            webcmdPackageVersion: '0.3.0',
            generatedAt: 'now',
          },
          commands: [{
            site: 'metadata', name: 'search', command: 'metadata/search', description: 'Search metadata',
            access: 'read', strategy: 'PUBLIC', browser: false, args: [], columns: [], tags: ['search', 42],
          }],
        },
      }), { status: 200 }),
    });

    await expect(client.getManifest()).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it('rejects non-boolean freshPage command metadata', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        manifest: {
          userId: 'user_demo',
          metadata: {
            contractSchemaVersion: 1,
            sessionProtocolVersion: 1,
            webcmdPackageVersion: '0.3.0',
            generatedAt: 'now',
          },
          commands: [{
            site: 'district',
            name: 'checkout',
            command: 'district/checkout',
            description: 'Checkout',
            access: 'write',
            strategy: 'UI',
            browser: true,
            args: [],
            columns: [],
            freshPage: 'yes',
          }],
        },
      }), { status: 200 }),
    });

    await expect(client.getManifest()).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it('manages public hosted profiles over the authenticated HTTP API', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const profile = {
      id: 'profile_work',
      name: 'Work',
      workspace: 'user_64256',
      default: false,
      status: 'available',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
      lastUsedAt: '2026-07-08T00:00:00.000Z',
    };
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'wcmd_live_test',
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method ?? 'GET',
          ...(init?.body ? { body: String(init.body) } : {}),
        });
        const path = new URL(String(url)).pathname;
        if (path.startsWith('/v1/profiles/') && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ ok: true, deleted: true }));
        }
        return new Response(JSON.stringify({ ok: true, profiles: [profile] }));
      },
    });

    await expect(client.listProfiles()).resolves.toEqual({ ok: true, profiles: [profile] });
    await expect(client.deleteProfile('profile/work')).resolves.toEqual({ ok: true, deleted: true });

    expect(requests).toEqual([
      { url: 'https://api.example.com/v1/profiles', method: 'GET' },
      { url: 'https://api.example.com/v1/profiles/profile%2Fwork', method: 'DELETE' },
    ]);
  });

  it.each([
    { name: 'private provider field', change: { providerProfileId: 'private' } },
    { name: 'missing updatedAt', change: { updatedAt: undefined } },
    { name: 'non-nullable name shape', change: { name: 7 } },
    { name: 'non-nullable workspace shape', change: { workspace: false } },
  ])('rejects a hosted profile with $name', async ({ change }) => {
    const profile: Record<string, unknown> = {
      id: 'profile_work',
      name: null,
      workspace: null,
      default: false,
      status: 'pending',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
      lastUsedAt: '2026-07-08T00:00:00.000Z',
      ...change,
    };
    if (change.updatedAt === undefined) delete profile.updatedAt;
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, profiles: [profile] })),
    });

    await expect(client.listProfiles()).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
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

  it('carries the root session selector in execute requests', async () => {
    let requestBody: unknown;
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          ok: true,
          result: [],
          execution: { id: 'exec_1', command: 'github/whoami', status: 'succeeded' },
        }));
      },
    });

    await client.execute({ command: 'github/whoami', args: {}, session: 'session_a' });

    expect(requestBody).toMatchObject({ command: 'github/whoami', session: 'session_a' });
  });

  it('prepares, uploads, runs, and downloads execution artifacts with raw byte bodies', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown; filename?: string | null }> = [];
    const bytes = new Uint8Array(Buffer.from('hello cloud'));
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async (url, init) => {
        const requestUrl = String(url);
        requests.push({
          url: requestUrl,
          method: init?.method ?? 'GET',
          body: init?.body,
          filename: new Headers(init?.headers).get('x-webcmd-filename'),
        });
        if (requestUrl.endsWith('/v1/executions')) {
          return new Response(JSON.stringify({
            ok: true,
            execution: { id: 'exec_files', command: 'twitter/post', status: 'queued' },
            fileArguments: [{
              name: 'images',
              direction: 'input-output',
              pathKind: 'file',
              multiple: true,
              required: false,
            }],
          }), { status: 201 });
        }
        if (requestUrl.endsWith('/v1/executions/exec_files/artifacts/images') && init?.method === 'POST') {
          return new Response(JSON.stringify({
            ok: true,
            artifact: {
              artifactId: 'artifact_in',
              argument: 'images',
              direction: 'input',
              pathKind: 'file',
              filename: 'one.png',
              contentType: 'image/png',
              byteSize: 3,
              expiresAt: '2026-07-15T00:00:00.000Z',
            },
            reference: { $webcmdArtifact: { id: 'artifact_in', direction: 'input' } },
          }), { status: 201 });
        }
        if (requestUrl.endsWith('/v1/executions/exec_files/run')) {
          return new Response(JSON.stringify({
            ok: true,
            result: null,
            execution: { id: 'exec_files', command: 'twitter/post', status: 'succeeded' },
            artifacts: [{
              artifactId: 'artifact_out',
              argument: 'output',
              direction: 'output',
              pathKind: 'file',
              filename: 'result.txt',
              contentType: 'text/plain',
              byteSize: bytes.byteLength,
              expiresAt: '2026-07-15T00:00:00.000Z',
            }],
          }), { status: 200 });
        }
        if (requestUrl.endsWith('/v1/executions/exec_files/artifacts/artifact_out')) {
          return new Response(bytes, { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: { code: 'UNKNOWN', message: requestUrl, exitCode: 1 } }), { status: 500 });
      },
    });

    await expect(client.prepareExecution({ command: 'twitter/post' })).resolves.toMatchObject({
      execution: { id: 'exec_files', status: 'queued' },
      fileArguments: [{ name: 'images', direction: 'input-output' }],
    });
    await expect(client.uploadExecutionArtifact({
      executionId: 'exec_files',
      argument: 'images',
      filename: 'one.png',
      contentType: 'image/png',
      body: new Uint8Array(Buffer.from('png')),
    })).resolves.toMatchObject({ reference: { $webcmdArtifact: { id: 'artifact_in' } } });
    await expect(client.runPreparedExecution({
      executionId: 'exec_files',
      command: 'twitter/post',
      args: {},
      session: 'session_a',
    })).resolves.toMatchObject({ artifacts: [{ artifactId: 'artifact_out' }] });
    await expect(client.downloadExecutionArtifact({
      executionId: 'exec_files',
      artifactId: 'artifact_out',
    })).resolves.toEqual(bytes);

    expect(requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'POST /v1/executions',
      'POST /v1/executions/exec_files/artifacts/images',
      'POST /v1/executions/exec_files/run',
      'GET /v1/executions/exec_files/artifacts/artifact_out',
    ]);
    expect(requests[1]).toMatchObject({
      filename: 'one.png',
      body: new Uint8Array(Buffer.from('png')),
    });
    expect(JSON.parse(String(requests[2]?.body))).toMatchObject({ session: 'session_a' });
  });

  it('preserves execution and trace metadata from hosted failure envelopes', async () => {
    const execution = { id: 'exec_failure', command: 'github/whoami', status: 'failed' } as const;
    const trace = {
      receipt: 'trace_receipt',
      executionId: 'exec_failure',
      artifactsUrl: '/v1/executions/exec_failure/artifacts',
    };
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Sign in first',
          help: 'Run webcmd github login.',
          exitCode: 77,
        },
        execution,
        trace,
      }), { status: 401 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {}, trace: 'retain-on-failure' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      execution,
      trace,
    } satisfies Partial<HostedClientError>);
  });

  it('keeps the original hosted error code when failure details are a nested object', async () => {
    const details = {
      warnings: [{ code: 'PAGE_STALE', message: 'The assigned page changed.' }],
      timings: { program_ms: 12 },
    };
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'BROWSER_RUN_TIMEOUT',
          message: 'The browser program timed out.',
          help: 'Retry with a shorter program.',
          exitCode: 75,
          details,
        },
        execution: { id: 'exec_timeout', command: 'github/whoami', status: 'timed_out' },
      }), { status: 504 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {} })).rejects.toMatchObject({
      code: 'BROWSER_RUN_TIMEOUT',
      details,
    } satisfies Partial<HostedClientError>);
  });

  it('preserves object details on artifact-download failures', async () => {
    const details = { artifactId: 'artifact_out', reason: 'expired' };
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'ARTIFACT_NOT_FOUND',
          message: 'The artifact is gone.',
          exitCode: 66,
          details,
        },
      }), { status: 404 }),
    });

    await expect(client.downloadExecutionArtifact({
      executionId: 'exec_files',
      artifactId: 'artifact_out',
    })).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
      details,
    } satisfies Partial<HostedClientError>);
  });

  it('preserves object details on raw-text request failures', async () => {
    const details = { site: 'github', path: 'notes.md' };
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'SITE_MEMORY_NOT_FOUND',
          message: 'Missing notes.',
          exitCode: 66,
          details,
        },
      }), { status: 404 }),
    });

    await expect(client.readSiteMemory('github', 'notes.md')).rejects.toMatchObject({
      code: 'SITE_MEMORY_NOT_FOUND',
      details,
    } satisfies Partial<HostedClientError>);
  });

  it.each(['success', 'failure'].flatMap(phase => invalidTraceUrlCases.map(testCase => ({
    phase,
    ...testCase,
  }))))('rejects $phase trace $name without copying the raw URL into the error', async ({
    phase,
    field,
    value,
    executionId,
  }) => {
    const success = phase === 'success';
    const body = success
      ? {
          ok: true,
          result: [],
          execution: { id: executionId, command: 'github/whoami', status: 'succeeded' },
          trace: { receipt: 'trace_receipt', executionId, [field]: value },
        }
      : {
          ok: false,
          error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
          execution: { id: executionId, command: 'github/whoami', status: 'failed' },
          trace: { receipt: 'trace_receipt', executionId, [field]: value },
        };
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify(body), { status: success ? 200 : 401 }),
    });

    const error = await client.execute({
      command: 'github/whoami',
      args: {},
      trace: success ? 'on' : 'retain-on-failure',
    }).then(() => undefined, caught => caught as HostedClientError);

    expect(error).toMatchObject({ code: 'HOSTED_PROTOCOL', exitCode: 1 });
    expect(error?.execution).toBeUndefined();
    expect(error?.trace).toBeUndefined();
    expect(`${error?.message ?? ''}\n${error?.hint ?? ''}`).not.toContain(value);
  });

  it.each(['success', 'failure'].flatMap(phase => validTraceUrlCases.map(testCase => ({
    phase,
    ...testCase,
  }))))('accepts the exact execution-bound $field public path on $phase', async ({ phase, field, suffix, executionId }) => {
    const success = phase === 'success';
    const value = `/v1/executions/${encodeURIComponent(executionId)}/${suffix}`;
    const trace = { receipt: 'trace_receipt', executionId, [field]: value };
    const body = success
      ? {
          ok: true,
          result: [],
          execution: { id: executionId, command: 'github/whoami', status: 'succeeded' },
          trace,
        }
      : {
          ok: false,
          error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
          execution: { id: executionId, command: 'github/whoami', status: 'failed' },
          trace,
        };
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify(body), { status: success ? 200 : 401 }),
    });
    const request = client.execute({
      command: 'github/whoami',
      args: {},
      trace: success ? 'on' : 'retain-on-failure',
    });

    if (success) {
      await expect(request).resolves.toMatchObject({ trace: { [field]: value } });
    } else {
      await expect(request).rejects.toMatchObject({ code: 'AUTH_REQUIRED', trace: { [field]: value } });
    }
  });

  it.each([
    {
      name: 'success without execution metadata',
      status: 200,
      body: { ok: true, result: [] },
    },
    {
      name: 'failure without a typed message',
      status: 500,
      body: { ok: false, error: { code: 'UNKNOWN', exitCode: 1 } },
    },
    {
      name: 'failure with malformed trace metadata',
      status: 500,
      body: {
        ok: false,
        error: { code: 'UNKNOWN', message: 'failed', exitCode: 1 },
        trace: { receipt: 42, executionId: 'exec_bad' },
      },
    },
    {
      name: 'success with a failed execution status',
      status: 200,
      body: {
        ok: true,
        result: [],
        execution: { id: 'exec_bad', command: 'github/whoami', status: 'failed' },
      },
    },
    {
      name: 'failure with a succeeded execution status',
      status: 500,
      body: {
        ok: false,
        error: { code: 'UNKNOWN', message: 'failed', exitCode: 1 },
        execution: { id: 'exec_bad', command: 'github/whoami', status: 'succeeded' },
      },
    },
    {
      name: 'trace for a different execution',
      status: 200,
      body: {
        ok: true,
        result: [],
        execution: { id: 'exec_good', command: 'github/whoami', status: 'succeeded' },
        trace: { receipt: 'trace_bad', executionId: 'exec_other' },
      },
    },
    {
      name: 'trace receipt with terminal control characters',
      status: 200,
      body: {
        ok: true,
        result: [],
        execution: { id: 'exec_good', command: 'github/whoami', status: 'succeeded' },
        trace: { receipt: 'trace_good\ninjected-output', executionId: 'exec_good' },
      },
    },
    {
      name: 'success for a different requested command',
      status: 200,
      body: {
        ok: true,
        result: [],
        execution: { id: 'exec_good', command: 'github/other', status: 'succeeded' },
      },
    },
    {
      name: 'execution-bearing failure without exitCode',
      status: 500,
      body: {
        ok: false,
        error: { code: 'UNKNOWN', message: 'failed' },
        execution: { id: 'exec_bad', command: 'github/whoami', status: 'failed' },
      },
    },
    {
      name: 'execution-bearing failure for a different requested command',
      status: 500,
      body: {
        ok: false,
        error: { code: 'UNKNOWN', message: 'failed', exitCode: 1 },
        execution: { id: 'exec_bad', command: 'github/other', status: 'failed' },
      },
    },
    {
      name: 'legacy success fields outside the public envelope',
      status: 200,
      body: {
        ok: true,
        result: [],
        data: ['/srv/private/token.json'],
        execution: { id: 'exec_good', command: 'github/whoami', status: 'succeeded' },
      },
    },
    {
      name: 'non-string footer text',
      status: 200,
      body: {
        ok: true,
        result: [],
        footerExtra: { internalPath: '/srv/private/token.json' },
        execution: { id: 'exec_good', command: 'github/whoami', status: 'succeeded' },
      },
    },
    {
      name: 'private nested execution fields',
      status: 200,
      body: {
        ok: true,
        result: [],
        execution: {
          id: 'exec_good', command: 'github/whoami', status: 'succeeded', internalPath: '/srv/private/token.json',
        },
      },
    },
    {
      name: 'array error details',
      status: 500,
      body: {
        ok: false,
        error: { code: 'UNKNOWN', message: 'failed', exitCode: 1, details: ['secret'] },
      },
    },
    {
      name: 'string error details',
      status: 500,
      body: {
        ok: false,
        error: { code: 'UNKNOWN', message: 'failed', exitCode: 1, details: 'secret' },
      },
    },
    {
      name: 'number error details',
      status: 500,
      body: {
        ok: false,
        error: { code: 'UNKNOWN', message: 'failed', exitCode: 1, details: 12 },
      },
    },
    {
      name: 'null error details',
      status: 500,
      body: {
        ok: false,
        error: { code: 'UNKNOWN', message: 'failed', exitCode: 1, details: null },
      },
    },
  ])('rejects malformed $name as HOSTED_PROTOCOL', async ({ status, body }) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify(body), { status }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {} })).rejects.toMatchObject({
      code: 'HOSTED_PROTOCOL',
      exitCode: 1,
    });
  });

  it('maps a valid pre-execution 401 envelope without an exit code to permission denied', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'bad',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or revoked Webcmd API key.',
          help: 'Run setup.',
        },
      }), { status: 401 }),
    });

    await expect(client.getManifest()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid or revoked Webcmd API key.',
      exitCode: 77,
    });
  });

  it('rejects trace=on success without a trace receipt as HOSTED_PROTOCOL', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: [],
        execution: { id: 'exec_missing_trace', command: 'github/whoami', status: 'succeeded' },
      }), { status: 200 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {}, trace: 'on' })).rejects.toMatchObject({
      code: 'HOSTED_PROTOCOL',
    });
  });

  it.each([
    { mode: 'off', trace: { receipt: 'unexpected', executionId: 'exec_success' } },
    { mode: 'retain-on-failure', trace: { receipt: 'unexpected', executionId: 'exec_success' } },
  ])('rejects a success trace for trace=$mode', async ({ mode, trace }) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: [],
        execution: { id: 'exec_success', command: 'github/whoami', status: 'succeeded' },
        trace,
      }), { status: 200 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {}, trace: mode }))
      .rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it.each([
    { mode: 'off', includeTrace: true },
    { mode: 'on', includeTrace: false },
    { mode: 'retain-on-failure', includeTrace: false },
  ])('rejects invalid failure trace relationship for trace=$mode', async ({ mode, includeTrace }) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'UNKNOWN', message: 'failed', exitCode: 1 },
        execution: { id: 'exec_failure', command: 'github/whoami', status: 'failed' },
        ...(includeTrace ? { trace: { receipt: 'trace_failure', executionId: 'exec_failure' } } : {}),
      }), { status: 500 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {}, trace: mode }))
      .rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it('accepts the typed public execution success envelope', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: [{ username: 'octocat' }],
        columns: ['username'],
        execution: { id: 'exec_success', command: 'github/whoami', status: 'succeeded' },
        trace: {
          receipt: 'trace_receipt',
          executionId: 'exec_success',
          artifactsUrl: '/v1/executions/exec_success/artifacts',
        },
      }), { status: 200 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {}, trace: 'on' })).resolves.toMatchObject({
      ok: true,
      result: [{ username: 'octocat' }],
      execution: { id: 'exec_success', status: 'succeeded' },
      trace: { receipt: 'trace_receipt' },
    });
  });

  it.each([
    {
      name: 'metadata with wrong field type',
      manifest: {
        userId: 'user_demo',
        metadata: { contractSchemaVersion: '1', sessionProtocolVersion: 1, webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
        commands: [],
      },
    },
    {
      name: 'command without an args array',
      manifest: {
        userId: 'user_demo',
        metadata: { contractSchemaVersion: 1, sessionProtocolVersion: 1, webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
        commands: [{ site: 'github', name: 'whoami', command: 'github/whoami' }],
      },
    },
    {
      name: 'command with malformed argument metadata',
      manifest: {
        userId: 'user_demo',
        metadata: { contractSchemaVersion: 1, sessionProtocolVersion: 1, webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
        commands: [{
          site: 'github', name: 'whoami', command: 'github/whoami', description: 'x', access: 'read',
          strategy: 'PUBLIC', browser: false, args: [{ name: 42 }],
        }],
      },
    },
    {
      name: 'command with a private field',
      manifest: {
        userId: 'user_demo',
        metadata: { contractSchemaVersion: 1, sessionProtocolVersion: 1, webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
        commands: [{
          site: 'github', name: 'whoami', command: 'github/whoami', description: 'x', access: 'read',
          strategy: 'PUBLIC', browser: false, args: [], columns: [], internalPath: '/srv/private/token.json',
        }],
      },
    },
    {
      name: 'private wrapper field',
      manifest: {
        userId: 'user_demo',
        metadata: { contractSchemaVersion: 1, sessionProtocolVersion: 1, webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
        commands: [],
      },
      wrapperExtra: { internalPath: '/srv/private/token.json' },
    },
  ])('rejects malformed manifest $name', async ({ manifest: bodyManifest, wrapperExtra }) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        manifest: bodyManifest,
        ...(wrapperExtra ?? {}),
      }), { status: 200 }),
    });

    await expect(client.getManifest()).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it.each([
    {
      method: 'startBrowserRun' as const,
      body: { ok: true, internalPath: '/srv/private/token.json' },
    },
    {
      method: 'startBrowserRun' as const,
      body: { ok: true, run: { executionId: 'exec_1', session: 'work', profile: { displayName: 'default' } } },
    },
    {
      method: 'browserAction' as const,
      body: { ok: true, columns: [], trace: null },
    },
    {
      method: 'browserAction' as const,
      body: { ok: true, result: {}, columns: ['url'], trace: null, internalPath: '/srv/private/token.json' },
    },
    {
      method: 'browserAction' as const,
      body: {
        ok: true,
        result: {},
        columns: ['url'],
        trace: {
          id: 'trace_1', receipt: 'receipt_1', kind: 'network', internalPath: '/srv/private/token.json',
        },
      },
    },
    {
      method: 'finishBrowserRun' as const,
      body: { ok: true, execution: { id: 'exec_other', status: 'succeeded' } },
    },
    {
      method: 'runBrowserAction' as const,
      body: { ok: true, result: {}, columns: [], trace: null },
    },
    {
      method: 'runBrowserAction' as const,
      body: {
        ok: true,
        result: {},
        columns: [],
        trace: null,
        run: { executionId: 'exec_1', session: 'other', profile: { id: 'profile_default', displayName: 'default' } },
        execution: { id: 'exec_1', status: 'succeeded' },
      },
    },
  ])('rejects malformed browser success from $method', async ({ method, body }) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
    });
    const request = method === 'startBrowserRun'
      ? client.startBrowserRun('work', { command: 'browser/open', args: {} })
      : method === 'browserAction'
        ? client.browserAction('work', 'exec_1', { action: 'navigate', args: {} })
        : method === 'finishBrowserRun'
          ? client.finishBrowserRun('work', 'exec_1', { status: 'succeeded' })
          : client.runBrowserAction('work', { command: 'browser/open', action: 'navigate', args: {} });

    await expect(request).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it('runs a hosted browser action through the atomic action endpoint', async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'wcmd_live_test',
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
        });
        if (String(url).endsWith('/commands')) {
          return new Response(JSON.stringify({
            ok: true,
            result: { url: 'https://example.com' },
            columns: ['url'],
            trace: null,
            run: {
              executionId: 'exec_1',
              session: 'work',
              profile: { id: 'profile_default', displayName: 'default' },
            },
            execution: { id: 'exec_1', status: 'succeeded' },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED', message: String(url), exitCode: 1 } }), { status: 500 });
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
        url: 'https://api.example.com/v1/browser/work/commands',
        body: {
          command: 'browser/open',
          action: 'navigate',
          args: { url: 'https://example.com' },
          profile: 'default',
          windowMode: 'background',
        },
      },
    ]);
  });

  it('accepts compact hosted snapshot responses', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'wcmd_live_test',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: { text: 'button Save' },
        run: {
          executionId: 'exec_1',
          session: 'work',
          profile: { id: 'profile_default', displayName: 'default' },
        },
      }), { status: 200 }),
    });

    await expect(client.runBrowserAction('work', {
      command: 'browser/snapshot', action: 'snapshot', args: { snapshotMode: 'read' },
    })).resolves.toMatchObject({ result: { text: 'button Save' } });
  });

  it('accepts the live-view expiry returned with a hosted browser run', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'wcmd_live_test',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: { url: 'https://example.com' },
        columns: ['url'],
        trace: null,
        run: {
          executionId: 'exec_1',
          session: 'work',
          profile: { id: 'profile_default', displayName: 'default' },
          liveViewUrl: 'https://api.example.com/account/live/view_1',
          expiresAt: '2026-08-03T20:54:04.384Z',
        },
        execution: { id: 'exec_1', status: 'succeeded' },
      }), { status: 200 }),
    });

    await expect(client.runBrowserAction('work', {
      command: 'browser/open',
      action: 'navigate',
      args: { url: 'https://example.com' },
    })).resolves.toMatchObject({
      run: { expiresAt: '2026-08-03T20:54:04.384Z' },
    });
  });

  it('rejects a non-string hosted browser run expiry', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'wcmd_live_test',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: { url: 'https://example.com' },
        columns: ['url'],
        trace: null,
        run: {
          executionId: 'exec_1',
          session: 'work',
          profile: { id: 'profile_default', displayName: 'default' },
          expiresAt: 123,
        },
        execution: { id: 'exec_1', status: 'succeeded' },
      }), { status: 200 }),
    });

    await expect(client.runBrowserAction('work', {
      command: 'browser/open',
      action: 'navigate',
      args: { url: 'https://example.com' },
    })).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it('attaches the workspace header when a workspace is configured', async () => {
    const requests: Array<{ workspace: string | null }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      workspace: resolveWorkspace([], { WEBCMD_WORKSPACE: 'user_64256' }),
      fetchImpl: async (_url, init) => {
        requests.push({ workspace: new Headers(init?.headers).get('x-webcmd-workspace') });
        return new Response(JSON.stringify({
          ok: true,
          result: [],
          execution: { id: 'exec_1', command: 'github/whoami', status: 'succeeded' },
        }), { status: 200 });
      },
    });

    await client.execute({ command: 'github/whoami', args: {} });

    expect(requests).toEqual([{ workspace: 'user_64256' }]);
  });

  it('attaches the workspace header for the --workspace=<value> equals form', async () => {
    const requests: Array<{ workspace: string | null }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      workspace: resolveWorkspace(['--workspace=user_64256'], {}),
      fetchImpl: async (_url, init) => {
        requests.push({ workspace: new Headers(init?.headers).get('x-webcmd-workspace') });
        return new Response(JSON.stringify({
          ok: true,
          result: [],
          execution: { id: 'exec_1', command: 'github/whoami', status: 'succeeded' },
        }), { status: 200 });
      },
    });

    await client.execute({ command: 'github/whoami', args: {} });

    expect(requests).toEqual([{ workspace: 'user_64256' }]);
  });

  it('omits the workspace header when no workspace is configured', async () => {
    const requests: Array<{ workspace: string | null }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async (_url, init) => {
        requests.push({ workspace: new Headers(init?.headers).get('x-webcmd-workspace') });
        return new Response(JSON.stringify({
          ok: true,
          result: [],
          execution: { id: 'exec_1', command: 'github/whoami', status: 'succeeded' },
        }), { status: 200 });
      },
    });

    await client.execute({ command: 'github/whoami', args: {} });

    expect(requests).toEqual([{ workspace: null }]);
  });
});

describe('resolveWorkspace', () => {
  it('returns the --workspace flag value when present', () => {
    expect(resolveWorkspace(['--workspace', 'flagws'], {})).toBe('flagws');
  });

  it('returns the --workspace=<value> flag value when present', () => {
    expect(resolveWorkspace(['--workspace=user_64256'], {})).toBe('user_64256');
  });

  it('--workspace overrides the env var', () => {
    expect(resolveWorkspace(['--workspace', 'flagws'], { WEBCMD_WORKSPACE: 'envws' })).toBe('flagws');
  });

  it('falls back to WEBCMD_WORKSPACE when no flag is present', () => {
    expect(resolveWorkspace([], { WEBCMD_WORKSPACE: 'envws' })).toBe('envws');
  });

  it('trims WEBCMD_WORKSPACE', () => {
    expect(resolveWorkspace([], { WEBCMD_WORKSPACE: '  envws  ' })).toBe('envws');
  });

  it('returns undefined when neither --workspace nor WEBCMD_WORKSPACE is set', () => {
    expect(resolveWorkspace([], {})).toBeUndefined();
  });
});

describe('HostedClient verbose diagnostics', () => {
  const SECRET_KEY = 'sk-hosted-secret-value';

  function captureStderr(): { lines: () => string[]; restore: () => void } {
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    return { lines: () => written, restore: () => spy.mockRestore() };
  }

  beforeEach(() => {
    delete process.env.WEBCMD_VERBOSE;
  });

  afterEach(() => {
    delete process.env.WEBCMD_VERBOSE;
    vi.restoreAllMocks();
  });

  it('stays silent when verbose mode is off', async () => {
    const stderr = captureStderr();
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: SECRET_KEY,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, profiles: [] })),
    });

    await client.listProfiles();
    stderr.restore();

    expect(stderr.lines()).toEqual([]);
  });

  it('reports method, path and status when verbose mode is on', async () => {
    process.env.WEBCMD_VERBOSE = '1';
    const stderr = captureStderr();
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: SECRET_KEY,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, profiles: [] })),
    });

    await client.listProfiles();
    stderr.restore();

    const output = stderr.lines().join('');
    expect(output).toContain('hosted → GET /v1/profiles');
    expect(output).toMatch(/hosted ← GET \/v1\/profiles 200 \(\d+ms\)/);
  });

  // `-v` is a debugging aid; it must never turn into a credential dump.
  it('never writes the bearer token or workspace header', async () => {
    process.env.WEBCMD_VERBOSE = '1';
    const stderr = captureStderr();
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: SECRET_KEY,
      workspace: 'ws_secret_workspace',
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, profiles: [] })),
    });

    await client.listProfiles();
    stderr.restore();

    const output = stderr.lines().join('');
    expect(output).not.toContain(SECRET_KEY);
    expect(output).not.toContain('ws_secret_workspace');
    expect(output).not.toContain('Bearer');
  });

  it('reports transport failures and still rethrows them', async () => {
    process.env.WEBCMD_VERBOSE = '1';
    const stderr = captureStderr();
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: SECRET_KEY,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });

    await expect(client.listProfiles()).rejects.toThrow('ECONNREFUSED');
    stderr.restore();

    expect(stderr.lines().join('')).toMatch(/hosted ✖ GET \/v1\/profiles failed after \d+ms: ECONNREFUSED/);
  });
});

describe('HostedClient abort signal', () => {
  it('passes the constructor signal to every request', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const controller = new AbortController();
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.test',
      apiKey: 'token',
      signal: controller.signal,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen.push(init?.signal);
        return new Response(JSON.stringify({ ok: true, profiles: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    });

    await client.listProfiles();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]!.aborted).toBe(false);
    controller.abort();
    expect(seen[0]!.aborted).toBe(true);
  });

  it('rejects when the signal is already aborted', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.test',
      apiKey: 'token',
      signal: AbortSignal.abort(new Error('cancelled by client disconnect')),
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        init?.signal?.throwIfAborted();
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    await expect(client.listProfiles()).rejects.toThrow('cancelled by client disconnect');
  });
});
