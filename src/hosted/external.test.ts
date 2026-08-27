import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { makeHostedConfig } from './config.js';
import { runHostedCli } from './runner.js';
import type { ExternalCliConfig } from '../external.js';
import { PKG_VERSION } from '../version.js';

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

const manifest = {
  userId: 'user_demo',
  metadata: {
    contractSchemaVersion: 1,
    sessionProtocolVersion: 1,
    webcmdPackageVersion: PKG_VERSION,
    generatedAt: '2026-08-27T00:00:00.000Z',
  },
  commands: [{
    site: 'github',
    name: 'whoami',
    command: 'github/whoami',
    description: 'Show GitHub identity',
    access: 'read',
    strategy: 'PUBLIC',
    browser: false,
    args: [],
    columns: ['username'],
  }],
};

function manifestResponse(): Response {
  return new Response(JSON.stringify({ ok: true, manifest }), { status: 200 });
}

const registry: ExternalCliConfig[] = [
  { name: 'gh', binary: 'gh', description: 'GitHub CLI' },
  { name: 'github', binary: 'gh-shadow', description: 'Shadows a hosted site name' },
];

type RunFn = (name: string, args: string[], configs: ExternalCliConfig[]) => number;

function harness(run: ReturnType<typeof vi.fn<RunFn>>) {
  const stdout = sink();
  const stderr = sink();
  const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());
  return {
    stdout,
    stderr,
    fetchImpl,
    opts: {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
      externals: { list: () => registry, run },
    },
  };
}

describe('hosted external CLI execution', () => {
  it('spawns a registered external and returns its exit code', async () => {
    const run = vi.fn<RunFn>(() => 3);
    const h = harness(run);

    const result = await runHostedCli(['gh', 'pr', 'list', '--limit', '5'], h.opts);

    expect(run).toHaveBeenCalledWith('gh', ['pr', 'list', '--limit', '5'], registry);
    expect(result).toEqual({ handled: true, exitCode: 3 });
    expect(h.stderr.text()).toBe('');
  });

  it('forwards --version to the external instead of printing the webcmd version', async () => {
    const run = vi.fn<RunFn>(() => 0);
    const h = harness(run);

    const result = await runHostedCli(['gh', '--version'], h.opts);

    expect(run).toHaveBeenCalledWith('gh', ['--version'], registry);
    expect(h.stdout.text()).toBe('');
    expect(result).toEqual({ handled: true, exitCode: 0 });
  });

  it('sends nothing but the manifest request to Cloud', async () => {
    const run = vi.fn<RunFn>(() => 0);
    const h = harness(run);

    await runHostedCli(['gh', 'pr', 'list'], h.opts);

    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(h.fetchImpl.mock.calls[0]![0])).toBe('https://api.example.com/v1/manifest');
  });

  it('keeps an external suffix workspace flag out of Cloud request metadata', async () => {
    const run = vi.fn<RunFn>(() => 0);
    const h = harness(run);

    await runHostedCli(['gh', 'issue', 'list', '--workspace', 'external-only-value'], h.opts);

    expect(run).toHaveBeenCalledWith(
      'gh',
      ['issue', 'list', '--workspace', 'external-only-value'],
      registry,
    );
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.com/v1/manifest');
    expect(new Headers(init?.headers).get('x-webcmd-workspace')).toBeNull();
    expect(String(init?.body ?? '')).not.toContain('external-only-value');
  });

  it.each([
    { name: 'split', tail: ['--session', 'child-session'] },
    { name: 'equals', tail: ['--session=child-session'] },
  ])('forwards a child-owned $name session flag to the external', async ({ tail }) => {
    const run = vi.fn<RunFn>(() => 0);
    const h = harness(run);

    const result = await runHostedCli(['gh', 'issue', 'list', ...tail], h.opts);

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(run).toHaveBeenCalledWith('gh', ['issue', 'list', ...tail], registry);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.stderr.text()).toBe('');
  });

  it('applies session validation when a hosted site shadows the registered external', async () => {
    const run = vi.fn<RunFn>(() => 0);
    const h = harness(run);

    const result = await runHostedCli(['github', 'whoami', '--session=child-session'], h.opts);

    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(run).not.toHaveBeenCalled();
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(h.fetchImpl.mock.calls[0]![0])).toBe('https://api.example.com/v1/manifest');
    expect(h.stderr.text()).toContain('SESSION_SELECTOR_POSITION');
  });

  it('lets a hosted site win over an external of the same name', async () => {
    const run = vi.fn<RunFn>(() => 0);
    const h = harness(run);

    await runHostedCli(['github', 'whoami'], {
      ...h.opts,
      fetchImpl: async (url: RequestInfo | URL) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : new Response(JSON.stringify({
            ok: true,
            result: [],
            execution: { id: 'exec_1', command: 'github/whoami', status: 'succeeded' },
          }), { status: 200 }),
    });

    expect(run).not.toHaveBeenCalled();
  });

  it('still reports an unknown site when the name is neither', async () => {
    const run = vi.fn<RunFn>(() => 0);
    const h = harness(run);

    const result = await runHostedCli(['nonesuch', 'thing'], h.opts);

    expect(run).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(2);
    expect(h.stderr.text()).toContain('Site "nonesuch" is not installed.');
  });
});
