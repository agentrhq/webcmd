import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHostedConfig } from './config.js';
import { runHostedCli } from './runner.js';

const manifest = {
  userId: 'user_demo',
  generatedAt: '2026-07-08T00:00:00.000Z',
  commands: [
    {
      site: 'github',
      name: 'whoami',
      command: 'github/whoami',
      description: 'Show GitHub identity',
      access: 'read',
      strategy: 'COOKIE',
      browser: true,
      args: [],
      columns: ['username'],
      domain: 'github.com',
    },
    {
      site: 'docker',
      name: 'ps',
      command: 'docker/ps',
      description: 'Local Docker containers',
      access: 'read',
      strategy: 'LOCAL',
      browser: false,
      args: [],
      columns: ['id'],
    },
  ],
};

function sink(): { stream: Writable; text: () => string } {
  let data = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        data += String(chunk);
        callback();
      },
    }),
    text: () => data,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runHostedCli', () => {
  it('renders hosted list without LOCAL commands', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message = '') => {
      logs.push(String(message));
    });

    const result = await runHostedCli(['list', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, manifest }), { status: 200 }),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(logs.join('\n')).toContain('github/whoami');
    expect(logs.join('\n')).not.toContain('docker/ps');
  });

  it('dispatches hosted commands to /v1/execute', async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await runHostedCli(['github', 'whoami', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
        });
        if (String(url).endsWith('/v1/manifest')) {
          return new Response(JSON.stringify({ ok: true, manifest }), { status: 200 });
        }
        return new Response(JSON.stringify({
          ok: true,
          result: [{ username: 'octocat' }],
          columns: ['username'],
        }), { status: 200 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests.at(-1)).toEqual({
      url: 'https://api.example.com/v1/execute',
      body: {
        command: 'github/whoami',
        args: {},
        format: 'json',
        trace: 'off',
      },
    });
  });

  it('rejects daemon commands in hosted mode', async () => {
    const stderr = sink();
    const result = await runHostedCli(['daemon', 'status'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
    });

    expect(result.exitCode).toBe(78);
    expect(stderr.text()).toMatch(/hosted mode has no local daemon/i);
  });

  it('routes hosted browser positional commands through the cloud lifecycle', async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const stdout = sink();
    const result = await runHostedCli(['--profile', 'default', 'browser', 'work', 'open', 'https://example.com', '--window', 'background'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
        });
        if (String(url).endsWith('/runs')) {
          return new Response(JSON.stringify({
            ok: true,
            run: {
              executionId: 'exec_browser',
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
          execution: { id: 'exec_browser', status: 'succeeded' },
        }), { status: 200 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toContain('https://example.com');
    expect(requests).toEqual([
      {
        url: 'https://api.example.com/v1/browser/work/runs',
        body: {
          command: 'browser/open',
          args: { url: 'https://example.com' },
          profile: 'default',
          windowMode: 'background',
          trace: 'off',
        },
      },
      {
        url: 'https://api.example.com/v1/browser/work/runs/exec_browser/actions',
        body: {
          action: 'navigate',
          args: { url: 'https://example.com' },
          profile: 'default',
        },
      },
      {
        url: 'https://api.example.com/v1/browser/work/runs/exec_browser/finish',
        body: {
          status: 'succeeded',
          profile: 'default',
        },
      },
    ]);
  });

  it('rejects the retired hosted browser --session flag', async () => {
    const stderr = sink();
    const result = await runHostedCli(['browser', '--session', 'work', 'state'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
    });

    expect(result.exitCode).toBe(78);
    expect(stderr.text()).toMatch(/session.*no longer a public option/i);
  });

  it('rejects browser bind before making a hosted request', async () => {
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await runHostedCli(['browser', 'work', 'bind'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 78 });
    expect(stderr.text()).toMatch(/browser bind is not supported in hosted mode/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
