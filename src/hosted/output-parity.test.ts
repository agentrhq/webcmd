import { Writable } from 'node:stream';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Strategy, type CliCommand } from '../registry.js';
import { registerCommandToProgram } from '../commanderAdapter.js';
import { commandListPresentation, filterCommandsByTag, toPresentableCommand } from '../command-presentation.js';
import { PKG_VERSION } from '../version.js';
import { makeHostedConfig } from './config.js';
import { runHostedCli } from './runner.js';

const { mockExecuteCommand } = vi.hoisted(() => ({
  mockExecuteCommand: vi.fn(),
}));

vi.mock('../execution.js', async () => {
  const actual = await vi.importActual<typeof import('../execution.js')>('../execution.js');
  return { ...actual, executeCommand: mockExecuteCommand };
});

const command: CliCommand = {
  site: 'github',
  name: 'whoami',
  description: 'Show GitHub identity',
  access: 'read',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['username'],
};

const manifest = {
  userId: 'user_demo',
  metadata: {
    contractSchemaVersion: 1,
            sessionProtocolVersion: 1,
            webcmdPackageVersion: PKG_VERSION,
    generatedAt: '2026-07-14T00:00:00.000Z',
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

function sink(isTTY: boolean): { stream: Writable; text: () => string } {
  let data = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      data += String(chunk);
      callback();
    },
  });
  Object.defineProperty(stream, 'isTTY', { value: isTTY });
  return { stream, text: () => data };
}

function clock(): () => number {
  const values = [1_000, 1_250];
  return () => values.shift() ?? 1_250;
}

async function localBytes(
  result: unknown,
  argv: string[],
  isTTY: boolean,
  footerExtra?: string,
): Promise<string> {
  mockExecuteCommand.mockResolvedValueOnce(result);
  const stdout = sink(isTTY);
  const program = new Command();
  const site = program.command('github');
  registerCommandToProgram(site, {
    ...command,
    ...(footerExtra ? { footerExtra: () => footerExtra } : {}),
  }, { stdout: stdout.stream, now: clock() });
  await program.parseAsync(['node', 'webcmd', 'github', 'whoami', ...argv]);
  return stdout.text();
}

async function hostedBytes(
  result: unknown,
  argv: string[],
  isTTY: boolean,
  footerExtra?: string,
): Promise<string> {
  const stdout = sink(isTTY);
  await runHostedCli(['github', 'whoami', ...argv], {
    config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
    stdout: stdout.stream,
    now: clock(),
    fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
      ? new Response(JSON.stringify({ ok: true, manifest }), { status: 200 })
      : new Response(JSON.stringify({
          ok: true,
          result,
          columns: ['username'],
          ...(footerExtra ? { footerExtra } : {}),
          execution: { id: 'exec_parity', command: 'github/whoami', status: 'succeeded' },
        }), { status: 200 }),
  });
  return stdout.text();
}

beforeEach(() => {
  mockExecuteCommand.mockReset();
});

describe('local/hosted command output differential', () => {
  it('keeps filtered local and hosted list rows identical', () => {
    const local = { ...command, tags: ['search'], keywords: ['identity'] };
    const hosted = { ...manifest.commands[0]!, tags: ['search'], keywords: ['identity'] };

    expect(commandListPresentation(filterCommandsByTag([toPresentableCommand(local)], 'SEARCH'), 'json').rows)
      .toEqual(commandListPresentation(filterCommandsByTag([toPresentableCommand(hosted)], 'SEARCH'), 'json').rows);
  });

  it('suppresses a null result in both modes', async () => {
    const result = null;
    const hosted = await hostedBytes(result, ['-f', 'json'], false);
    const local = await localBytes(result, ['-f', 'json'], false);
    expect(hosted).toBe(local);
    expect(local).toBe('');
  });

  it.each([undefined, 'canonical footer'])('matches canonical local TTY table decorations byte-for-byte with footer %s', async (footerExtra) => {
    const result = [{ username: 'octocat' }];
    const hosted = await hostedBytes(result, ['-f', 'table'], true, footerExtra);
    const local = await localBytes(result, ['-f', 'table'], true, footerExtra);

    expect(hosted).toBe(local);
    expect(local).toContain('  github/whoami');
    expect(local).toContain(`1 items | 0.3s | github/whoami${footerExtra ? ` | ${footerExtra}` : ''}`);
  });
});
