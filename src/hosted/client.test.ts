import { describe, expect, it } from 'vitest';
import { HostedClient, HostedClientError } from './client.js';

const invalidTraceUrlCases = [
  {
    name: 'raw absolute Kernel URL with token',
    field: 'liveViewUrl',
    value: 'https://kernel.example/session/secret?token=kernel-secret-token',
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

const invalidViewerUrlCases = [
  ['raw Kernel URL', 'https://kernel.example/session/secret'],
  ['wrong origin', 'https://other.example.com/account/live/token'],
  ['credentials', 'https://user:pass@api.example.com/account/live/token'],
  ['query string', 'https://api.example.com/account/live/token?secret=1'],
  ['empty query string', 'https://api.example.com/account/live/token?'],
  ['fragment', 'https://api.example.com/account/live/token#secret'],
  ['empty fragment', 'https://api.example.com/account/live/token#'],
  ['surrounding control characters', '\nhttps://api.example.com/account/live/token\n'],
  ['protocol-relative URL', '//api.example.com/account/live/token'],
  ['wrong path', 'https://api.example.com/v1/executions/exec/live'],
  ['empty token', 'https://api.example.com/account/live/'],
  ['nested token path', 'https://api.example.com/account/live/token/extra'],
  ['insecure production URL', 'http://api.example.com/account/live/token'],
] as const;

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
          manifest: {
            userId: 'user_demo',
            metadata: {
              contractSchemaVersion: 1,
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
        webcmdPackageVersion: '0.3.0',
        generatedAt: 'now',
      },
      commands: [],
    });
    expect(requests).toEqual([{ url: 'https://api.example.com/v1/manifest', authorization: 'Bearer wcmd_live_test' }]);
  });

  it('negotiates hosted viewer and failure handoff capabilities for execution requests', async () => {
    const requests: Array<{ path: string; capabilities: string | null }> = [];
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        requests.push({
          path,
          capabilities: new Headers(init?.headers).get('x-webcmd-client-capabilities'),
        });
        const command = path === '/v1/execute' ? 'github/whoami' : 'twitter/post';
        const id = path === '/v1/execute' ? 'exec_execute' : 'exec_prepared';
        return new Response(JSON.stringify({
          ok: true,
          result: [],
          execution: { id, command, status: 'succeeded' },
        }), { status: 200 });
      },
    });

    await client.execute({ command: 'github/whoami', args: {} });
    await client.runPreparedExecution({
      executionId: 'exec_prepared',
      command: 'twitter/post',
      args: {},
    });

    expect(requests).toEqual([
      {
        path: '/v1/execute',
        capabilities: 'hosted-execution-viewer-v1, hosted-failure-handoff-v1',
      },
      {
        path: '/v1/executions/exec_prepared/run',
        capabilities: 'hosted-execution-viewer-v1, hosted-failure-handoff-v1',
      },
    ]);
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

  it('parses hosted profile rows without provider identifiers', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'wcmd_live_test',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        profiles: [{
          name: 'default',
          default: true,
          status: 'available',
          createdAt: '2026-07-08T00:00:00.000Z',
          lastUsedAt: '2026-07-08T00:00:00.000Z',
        }],
      }), { status: 200 }),
    });

    await expect(client.listProfiles()).resolves.toEqual({
      ok: true,
      profiles: [{
        name: 'default',
        default: true,
        status: 'available',
        createdAt: '2026-07-08T00:00:00.000Z',
        lastUsedAt: '2026-07-08T00:00:00.000Z',
      }],
    });
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
              direction: 'input',
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
      fileArguments: [{ name: 'images' }],
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

  it('preserves a validated failed-execution handoff', async () => {
    const handoff = {
      status: 'action_required',
      action: 'Complete sign-in in the hosted browser.',
      viewUrl: 'https://api.example.com/account/live/handoff-token',
      expiresAt: '2026-07-23T12:00:00.000Z',
      verifyCommand: 'webcmd github whoami',
    } as const;
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
        execution: { id: 'exec_failure', command: 'github/whoami', status: 'failed' },
        handoff,
      }), { status: 401 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {} })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      exitCode: 77,
      handoff,
    } satisfies Partial<HostedClientError>);
  });

  it.each(invalidViewerUrlCases)('rejects failure handoff viewer capability with %s without echoing it', async (_name, viewUrl) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
        execution: { id: 'exec_failure', command: 'github/whoami', status: 'failed' },
        handoff: { status: 'action_required', action: 'Complete sign-in.', viewUrl },
      }), { status: 401 }),
    });

    const error = await client.execute({ command: 'github/whoami', args: {} })
      .then(() => undefined, caught => caught as HostedClientError);

    expect(error).toMatchObject({ code: 'HOSTED_PROTOCOL', exitCode: 1 });
    expect(error?.handoff).toBeUndefined();
    expect(`${error?.message ?? ''}\n${error?.hint ?? ''}`).not.toContain(viewUrl);
  });

  it.each([
    ['unknown key', { status: 'action_required', action: 'Complete sign-in.', viewUrl: 'https://api.example.com/account/live/token', extra: true }],
    ['wrong status', { status: 'in_progress', action: 'Complete sign-in.', viewUrl: 'https://api.example.com/account/live/token' }],
    ['missing action', { status: 'action_required', viewUrl: 'https://api.example.com/account/live/token' }],
    ['blank action', { status: 'action_required', action: '   ', viewUrl: 'https://api.example.com/account/live/token' }],
    ['control character in action', { status: 'action_required', action: 'Sign in.\ninjected', viewUrl: 'https://api.example.com/account/live/token' }],
    ['C1 control character in action', { status: 'action_required', action: 'Sign in.\u009binjected', viewUrl: 'https://api.example.com/account/live/token' }],
    ['blank expiry', { status: 'action_required', action: 'Complete sign-in.', viewUrl: 'https://api.example.com/account/live/token', expiresAt: '' }],
    ['control character in expiry', { status: 'action_required', action: 'Complete sign-in.', viewUrl: 'https://api.example.com/account/live/token', expiresAt: 'soon\ninjected' }],
    ['non-string expiry', { status: 'action_required', action: 'Complete sign-in.', viewUrl: 'https://api.example.com/account/live/token', expiresAt: 42 }],
    ['blank verifier', { status: 'action_required', action: 'Complete sign-in.', viewUrl: 'https://api.example.com/account/live/token', verifyCommand: '' }],
    ['control character in verifier', { status: 'action_required', action: 'Complete sign-in.', viewUrl: 'https://api.example.com/account/live/token', verifyCommand: 'webcmd github whoami\ninjected' }],
    ['non-string verifier', { status: 'action_required', action: 'Complete sign-in.', viewUrl: 'https://api.example.com/account/live/token', verifyCommand: 42 }],
  ])('rejects failure handoff with %s', async (_name, handoff) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
        execution: { id: 'exec_failure', command: 'github/whoami', status: 'failed' },
        handoff,
      }), { status: 401 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {} })).rejects.toMatchObject({
      code: 'HOSTED_PROTOCOL',
      exitCode: 1,
    });
  });

  it('rejects a handoff without a failed execution', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
        handoff: {
          status: 'action_required',
          action: 'Complete sign-in.',
          viewUrl: 'https://api.example.com/account/live/token',
        },
      }), { status: 401 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {} })).rejects.toMatchObject({
      code: 'HOSTED_PROTOCOL',
      exitCode: 1,
    });
  });

  it('rejects a handoff from a timed-out execution', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'TIMEOUT', message: 'Timed out', exitCode: 75 },
        execution: { id: 'exec_timeout', command: 'github/whoami', status: 'timed_out' },
        handoff: {
          status: 'action_required',
          action: 'Complete the challenge.',
          viewUrl: 'https://api.example.com/account/live/token',
        },
      }), { status: 504 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {} })).rejects.toMatchObject({
      code: 'HOSTED_PROTOCOL',
      exitCode: 1,
    });
  });

  it('rejects a prepared-execution handoff for a different execution id', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
        execution: { id: 'exec_other', command: 'github/whoami', status: 'failed' },
        handoff: {
          status: 'action_required',
          action: 'Complete sign-in.',
          viewUrl: 'https://api.example.com/account/live/token',
        },
      }), { status: 401 }),
    });

    await expect(client.runPreparedExecution({
      executionId: 'exec_expected',
      command: 'github/whoami',
      args: {},
    })).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL', exitCode: 1 });
  });

  it('rejects a handoff on an artifact download failure', async () => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
        execution: { id: 'exec_files', command: 'github/whoami', status: 'failed' },
        handoff: {
          status: 'action_required',
          action: 'Complete sign-in.',
          viewUrl: 'https://api.example.com/account/live/token',
        },
      }), { status: 401 }),
    });

    await expect(client.downloadExecutionArtifact({
      executionId: 'exec_files',
      artifactId: 'artifact_out',
    })).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL', exitCode: 1 });
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

  it('accepts an absolute Webcmd-owned adapter viewer capability', async () => {
    const viewUrl = 'https://api.example.com/account/live/opaque-token_123';
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: [],
        viewUrl,
        execution: { id: 'exec_view', command: 'github/whoami', status: 'succeeded' },
      }), { status: 200 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {} })).resolves.toMatchObject({ viewUrl });
  });

  it.each(invalidViewerUrlCases)('rejects adapter viewer capability with %s', async (_name, viewUrl) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: [],
        viewUrl,
        execution: { id: 'exec_view', command: 'github/whoami', status: 'succeeded' },
      }), { status: 200 }),
    });

    await expect(client.execute({ command: 'github/whoami', args: {} })).rejects.toMatchObject({
      code: 'HOSTED_PROTOCOL',
    });
  });

  it.each(invalidViewerUrlCases)('rejects raw-browser viewer capability with %s', async (_name, liveViewUrl) => {
    const client = new HostedClient({
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: {},
        columns: [],
        trace: null,
        run: {
          executionId: 'exec_view',
          session: 'work',
          profile: { id: 'profile_default', displayName: 'default' },
          liveViewUrl,
        },
        execution: { id: 'exec_view', status: 'succeeded' },
      }), { status: 200 }),
    });

    await expect(client.runBrowserAction('work', {
      command: 'browser/state',
      action: 'snapshot',
      args: {},
    })).rejects.toMatchObject({ code: 'HOSTED_PROTOCOL' });
  });

  it.each([
    ['HTTPS production', 'https://api.example.com', 'https://api.example.com/account/live/token'],
    ['HTTP localhost', 'http://localhost:8787', 'http://localhost:8787/account/live/token'],
    ['HTTP IPv4 loopback', 'http://127.0.0.1:8787', 'http://127.0.0.1:8787/account/live/token'],
  ])('accepts a raw-browser viewer capability on %s', async (_name, apiBaseUrl, liveViewUrl) => {
    const client = new HostedClient({
      apiBaseUrl,
      apiKey: 'key',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: {},
        columns: [],
        trace: null,
        run: {
          executionId: 'exec_view',
          session: 'work',
          profile: { id: 'profile_default', displayName: 'default' },
          liveViewUrl,
        },
        execution: { id: 'exec_view', status: 'succeeded' },
      }), { status: 200 }),
    });

    await expect(client.runBrowserAction('work', {
      command: 'browser/state',
      action: 'snapshot',
      args: {},
    })).resolves.toMatchObject({ run: { liveViewUrl } });
  });

  it.each([
    {
      name: 'metadata with wrong field type',
      manifest: {
        userId: 'user_demo',
        metadata: { contractSchemaVersion: '1', webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
        commands: [],
      },
    },
    {
      name: 'command without an args array',
      manifest: {
        userId: 'user_demo',
        metadata: { contractSchemaVersion: 1, webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
        commands: [{ site: 'github', name: 'whoami', command: 'github/whoami' }],
      },
    },
    {
      name: 'command with malformed argument metadata',
      manifest: {
        userId: 'user_demo',
        metadata: { contractSchemaVersion: 1, webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
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
        metadata: { contractSchemaVersion: 1, webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
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
        metadata: { contractSchemaVersion: 1, webcmdPackageVersion: '0.3.0', generatedAt: 'now' },
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
});
