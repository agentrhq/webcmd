import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable, type WritableOptions } from 'node:stream';
import type { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { browserCommandCatalog } from '../browser/command-catalog.js';
import { rewriteBrowserArgv } from '../cli-argv-preprocess.js';
import { createProgram } from '../cli.js';
import { formatRootHelp } from '../command-presentation.js';
import { HOSTED_ROOT_HELP } from '../completion-shared.js';
import { makeHostedConfig } from './config.js';
import { runHostedCli } from './runner.js';

const manifest = {
  userId: 'user_demo',
  metadata: {
    contractSchemaVersion: 1,
    webcmdPackageVersion: '0.3.0',
    generatedAt: '2026-07-08T00:00:00.000Z',
  },
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

function sink(isTTY = false): { stream: Writable; text: () => string } {
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

function manifestResponse(): Response {
  return new Response(JSON.stringify({ ok: true, manifest }), { status: 200 });
}

function executionResponse(input: {
  result: unknown;
  columns?: string[];
  trace?: Record<string, unknown>;
  command?: string;
  viewUrl?: string;
}): Response {
  return new Response(JSON.stringify({
    ok: true,
    result: input.result,
    ...(input.columns ? { columns: input.columns } : {}),
    execution: { id: 'exec_success', command: input.command ?? 'github/whoami', status: 'succeeded' },
    ...(input.trace ? { trace: input.trace } : {}),
    ...(input.viewUrl ? { viewUrl: input.viewUrl } : {}),
  }), { status: 200 });
}

function authManifestResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    manifest: {
      ...manifest,
      commands: [
        ...manifest.commands,
        {
          site: 'github',
          name: 'login',
          command: 'github/login',
          description: 'Authenticate GitHub',
          access: 'write',
          strategy: 'UI',
          browser: true,
          args: [],
          columns: ['status', 'logged_in', 'site', 'action', 'verify_command', 'action_url', 'view_url', 'expires_at'],
        },
        {
          site: 'auth',
          name: 'refresh',
          command: 'auth/refresh',
          description: 'Refresh hosted authentication',
          access: 'write',
          strategy: 'UI',
          browser: true,
          args: [],
          columns: ['status', 'logged_in', 'site', 'action', 'verify_command', 'action_url', 'view_url', 'expires_at'],
        },
      ],
    },
  }), { status: 200 });
}

function manifestWithRequiredAccount() {
  return {
    ...manifest,
    commands: manifest.commands.map(command => command.command === 'github/whoami'
      ? {
          ...command,
          args: [
            { name: 'account', positional: true, required: true, help: 'Account name' },
            { name: 'mode', choices: ['valid'], help: 'Mode' },
          ],
        }
      : command),
  };
}

function manifestWithStructuralArguments() {
  return {
    ...manifest,
    commands: manifest.commands.map(command => command.command === 'github/whoami'
      ? {
          ...command,
          args: [
            { name: 'account', positional: true, required: true, help: 'Account name' },
            { name: 'token', required: true, valueRequired: true, help: 'Access token' },
            { name: 'mode', choices: ['valid'], help: 'Mode' },
          ],
        }
      : command),
  };
}

function manifestWithFileCommand() {
  return {
    ...manifest,
    commands: [
      ...manifest.commands,
      {
        site: 'files',
        name: 'copy',
        command: 'files/copy',
        description: 'Copy a hosted file',
        access: 'write',
        strategy: 'PUBLIC',
        browser: false,
        args: [
          {
            name: 'source',
            required: true,
            valueRequired: true,
            help: 'Local input file',
            file: {
              direction: 'input',
              pathKind: 'file',
              multiple: false,
              contentTypes: ['text/plain'],
              maxBytes: 1024,
            },
          },
          {
            name: 'output',
            required: true,
            valueRequired: true,
            help: 'Local output directory',
            file: {
              direction: 'output',
              pathKind: 'directory',
              multiple: false,
            },
          },
        ],
        columns: ['status'],
      },
    ],
  };
}

function sampleBrowserPositionals(command: (typeof browserCommandCatalog)[number]): string[] {
  return command.positionals.flatMap((positional) => {
    if (positional.variadic) return [`${positional.name}-one`, `${positional.name}-two`];
    if (positional.required) return [`${positional.name}-value`];
    return [`${positional.name}-value`];
  });
}

class ControlledWritable extends Writable {
  private readonly chunks: Buffer[] = [];
  private readonly releases: Array<(error?: Error | null) => void> = [];

  constructor(options?: WritableOptions) {
    super(options);
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    this.releases.push(callback);
  }

  pendingCount(): number {
    return this.releases.length;
  }

  release(error?: Error): void {
    const callback = this.releases.shift();
    if (!callback) throw new Error('No controlled write is pending');
    callback(error);
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

class CloseBeforeCallbackWritable extends Writable {
  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    _callback: (error?: Error | null) => void,
  ): void {
    this.destroy();
  }
}

async function within<T>(promise: Promise<T>, milliseconds = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`promise did not settle within ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function captureLocalBrowserStructure(argv: string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const program = createProgram('', '');
  let stdout = '';
  let stderr = '';
  const configure = (command: Command): void => {
    command
      .exitOverride()
      .configureOutput({
        writeErr: value => { stderr += value; },
        writeOut: value => { stdout += value; },
      });
    if (command.commands.length === 0) command.action(() => undefined);
    for (const child of command.commands) configure(child);
  };
  configure(program);
  try {
    program.parse(rewriteBrowserArgv(argv), { from: 'user' });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const commander = error as { exitCode?: number };
    return { exitCode: commander.exitCode ?? 1, stdout, stderr };
  }
}

describe('runHostedCli', () => {
  it.each([
    ['missing-site'],
    ['missing-site', 'child'],
    ['missing-site', 'child', 'grandchild'],
    ['missing-site', '--format', 'json'],
    ['missing-site', '--trace=on'],
  ])('matches local unknown-site bytes when argv is %j', async (...argv) => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(stderr.text()).toBe("error: unknown command 'missing-site'\n");
    expect(stdout.text()).toBe(formatRootHelp(HOSTED_ROOT_HELP));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/\/v1\/manifest$/);
  });

  it('matches local Commander bytes for an unknown site command', async () => {
    const stdout = sink();
    const stderr = sink();

    const result = await runHostedCli(['github', 'missing-command'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => manifestResponse(),
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(stderr.text()).toBe("error: unknown command 'missing-command'\n");
    expect(stdout.text()).toBe('');
  });

  it('matches local Commander bytes for a missing required positional', async () => {
    const requiredManifest = manifestWithRequiredAccount();
    const stdout = sink();
    const stderr = sink();

    const result = await runHostedCli(['github', 'whoami'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, manifest: requiredManifest }), { status: 200 }),
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(stderr.text()).toBe("error: missing required argument 'account'\n");
    expect(stdout.text()).toBe('');
  });

  it('transfers declared files through prepare/upload/run/download before rendering output', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-runner-files-'));
    try {
      const imagePath = path.join(tempDir, 'one.png');
      const outputDir = path.join(tempDir, 'downloads');
      await writeFile(imagePath, 'png bytes');
      const stdout = sink();
      const stderr = sink();
      const calls: string[] = [];
      const body = new Uint8Array(Buffer.from('hello cloud'));
      const fileManifest = {
        ...manifest,
        commands: [{
          site: 'twitter',
          name: 'post',
          command: 'twitter/post',
          description: 'Post a tweet',
          access: 'write',
          strategy: 'UI',
          browser: true,
          args: [
            { name: 'text', positional: true, required: true },
            {
              name: 'images',
              file: {
                direction: 'input',
                pathKind: 'file',
                multiple: true,
                separator: ',',
                contentTypes: ['image/png'],
                maxBytes: 1024,
              },
            },
            {
              name: 'output',
              file: {
                direction: 'output',
                pathKind: 'directory',
                multiple: false,
              },
            },
          ],
          columns: ['ok'],
        }],
      };
      const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
        const requestUrl = String(url);
        calls.push(`${init?.method ?? 'GET'} ${new URL(requestUrl).pathname}`);
        if (requestUrl.endsWith('/v1/manifest')) {
          return new Response(JSON.stringify({ ok: true, manifest: fileManifest }), { status: 200 });
        }
        if (requestUrl.endsWith('/v1/executions') && init?.method === 'POST') {
          return new Response(JSON.stringify({
            ok: true,
            execution: { id: 'exec_files', command: 'twitter/post', status: 'queued' },
            fileArguments: [],
          }), { status: 201 });
        }
        if (requestUrl.endsWith('/v1/executions/exec_files/artifacts/images') && init?.method === 'POST') {
          expect(new Headers(init.headers).get('x-webcmd-filename')).toBe('one.png');
          expect(init.body).toEqual(new Uint8Array(Buffer.from('png bytes')));
          return new Response(JSON.stringify({
            ok: true,
            artifact: {
              artifactId: 'artifact_in',
              argument: 'images',
              direction: 'input',
              pathKind: 'file',
              filename: 'one.png',
              contentType: 'image/png',
              byteSize: 9,
              expiresAt: '2026-07-15T00:00:00.000Z',
            },
            reference: { $webcmdArtifact: { id: 'artifact_in', direction: 'input' } },
          }), { status: 201 });
        }
        if (requestUrl.endsWith('/v1/executions/exec_files/run') && init?.method === 'POST') {
          const payload = JSON.parse(String(init.body)) as { args: Record<string, unknown> };
          expect(JSON.stringify(payload.args)).not.toContain(tempDir);
          expect(payload.args).toMatchObject({
            text: 'hello',
            images: [{ $webcmdArtifact: { id: 'artifact_in', direction: 'input' } }],
            output: { $webcmdArtifact: { direction: 'output', filename: 'downloads' } },
          });
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
              byteSize: body.byteLength,
              sha256: createHash('sha256').update(body).digest('hex'),
              relativePath: 'result.txt',
              expiresAt: '2026-07-15T00:00:00.000Z',
            }],
          }), { status: 200 });
        }
        if (requestUrl.endsWith('/v1/executions/exec_files/artifacts/artifact_out')) {
          return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
        }
        return new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED', message: requestUrl, exitCode: 1 } }), { status: 500 });
      });

      const result = await runHostedCli(['twitter', 'post', 'hello', '--images', imagePath, '--output', outputDir], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        stderr: stderr.stream,
        fetchImpl,
      });

      expect(result).toEqual({ handled: true, exitCode: 0 });
      expect(stdout.text()).toBe('');
      expect(stderr.text()).toBe('');
      await expect(readFile(path.join(outputDir, 'result.txt'), 'utf8')).resolves.toBe('hello cloud');
      expect(calls).toEqual([
        'GET /v1/manifest',
        'POST /v1/executions',
        'POST /v1/executions/exec_files/artifacts/images',
        'POST /v1/executions/exec_files/run',
        'GET /v1/executions/exec_files/artifacts/artifact_out',
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['--help', '-f', 'xml'],
    ['-f', 'xml', '--help'],
    ['--help', '--trace', 'always'],
    ['--help', '--mode', 'invalid'],
  ])('lets help win over invalid semantic options: %j', async (...tail) => {
    const precedenceManifest = manifestWithRequiredAccount();
    const stdout = sink();
    const stderr = sink();

    const result = await runHostedCli(['github', 'whoami', ...tail], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, manifest: precedenceManifest }), { status: 200 }),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('Usage: webcmd github whoami <account> [options]');
  });

  it.each([
    ['-f', 'xml'],
    ['--trace', 'always'],
    ['--mode', 'invalid'],
  ])('lets a missing required positional win over invalid semantic options: %j', async (...tail) => {
    const precedenceManifest = manifestWithRequiredAccount();
    const stdout = sink();
    const stderr = sink();

    const result = await runHostedCli(['github', 'whoami', ...tail], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, manifest: precedenceManifest }), { status: 200 }),
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(stderr.text()).toBe("error: missing required argument 'account'\n");
    expect(stdout.text()).toBe('');
  });

  it.each([
    {
      name: 'unknown option before help',
      tail: ['--unknown', '--help'],
      exitCode: 0,
      stderr: '',
      help: true,
    },
    {
      name: 'help before an unknown option',
      tail: ['--help', '--unknown'],
      exitCode: 0,
      stderr: '',
      help: true,
    },
    {
      name: 'missing option value after help',
      tail: ['--help', '--token'],
      exitCode: 1,
      stderr: "error: option '--token <value>' argument missing\n",
      help: false,
    },
    {
      name: 'help before excess positionals',
      tail: ['--help', 'one', 'two'],
      exitCode: 0,
      stderr: '',
      help: true,
    },
    {
      name: 'help before invalid choice, format, and trace values',
      tail: ['--help', '--mode', 'bad', '-f', 'xml', '--trace', 'always'],
      exitCode: 0,
      stderr: '',
      help: true,
    },
    {
      name: 'required named option before invalid format',
      tail: ['account', '-f', 'xml'],
      exitCode: 1,
      stderr: "error: required option '--token <value>' not specified\n",
      help: false,
    },
    {
      name: 'required named option before invalid trace',
      tail: ['account', '--trace', 'always'],
      exitCode: 1,
      stderr: "error: required option '--token <value>' not specified\n",
      help: false,
    },
    {
      name: 'required named option before invalid choice',
      tail: ['account', '--mode', 'bad'],
      exitCode: 1,
      stderr: "error: required option '--token <value>' not specified\n",
      help: false,
    },
    {
      name: 'required positional before invalid format',
      tail: ['--token', 'secret', '-f', 'xml'],
      exitCode: 1,
      stderr: "error: missing required argument 'account'\n",
      help: false,
    },
    {
      name: 'ordinary unknown option',
      tail: ['account', '--token', 'secret', '--unknown'],
      exitCode: 1,
      stderr: "error: unknown option '--unknown'\n",
      help: false,
    },
    {
      name: 'ordinary missing option value',
      tail: ['account', '--token'],
      exitCode: 1,
      stderr: "error: option '--token <value>' argument missing\n",
      help: false,
    },
    {
      name: 'ordinary excess positional',
      tail: ['account', 'extra', '--token', 'secret'],
      exitCode: 1,
      stderr: "error: too many arguments for 'whoami'. Expected 1 argument but got 2.\n",
      help: false,
    },
  ])('matches public Commander structural bytes and discovery order: $name', async ({ tail, exitCode, stderr: expectedStderr, help }) => {
    const structuralManifest = manifestWithStructuralArguments();
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ ok: true, manifest: structuralManifest }),
      { status: 200 },
    ));

    const result = await runHostedCli(['github', 'whoami', ...tail], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode });
    expect(stderr.text()).toBe(expectedStderr);
    if (help) expect(stdout.text()).toContain('Usage: webcmd github whoami <account> [options]');
    else expect(stdout.text()).toBe('');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.example.com/v1/manifest');
  });

  it.each([
    { argv: ['--profile'], calls: 0 },
    { argv: ['--help', '--profile'], calls: 0 },
    { argv: ['--unknown', '--profile'], calls: 0 },
    { argv: ['missing-site', '--profile'], calls: 1 },
  ])('matches root Commander missing --profile bytes for %j', async ({ argv, calls }) => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(stderr.text()).toBe("error: option '--profile <name>' argument missing\n");
    expect(stdout.text()).toBe('');
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
  });

  it.each([
    ['--help', '--unknown'],
    ['--unknown', '--help'],
  ])('lets root help win over an ordinary unknown root option: %j', async (...argv) => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toBe(formatRootHelp(HOSTED_ROOT_HELP));
    expect(stderr.text()).toBe('');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'before command', argv: ['--profile', 'work', 'github', 'whoami', '-f', 'json'], profile: 'work' },
    { name: 'equals form', argv: ['--profile=work', 'github', 'whoami', '-f', 'json'], profile: 'work' },
    { name: 'dash-leading value', argv: ['--profile', '-dash', 'github', 'whoami', '-f', 'json'], profile: '-dash' },
  ])('forwards a root profile in $name', async ({ argv, profile }) => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
        });
        return String(url).endsWith('/v1/manifest')
          ? manifestResponse()
          : executionResponse({ result: [] });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body?.profile).toBe(profile);
  });

  it('does not consume a profile placed after a known leaf command', async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const result = await runHostedCli(['github', 'whoami', '--profile', 'work'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(stderr.text()).toBe("error: unknown option '--profile'\n");
    expect(stdout.text()).toBe('');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('matches Commander when a profile consumes -- and exposes the following dash-leading root token', async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await runHostedCli(['--profile', '--', '-dash'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(stderr.text()).toBe("error: unknown option '-dash'\n");
    expect(stdout.text()).toBe('');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not resolve until its slow stdout write callback and drain complete', async () => {
    const stdout = new ControlledWritable({ highWaterMark: 1 });
    let settled = false;

    const run = runHostedCli(['--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout,
    }).then(result => {
      settled = true;
      return result;
    });
    await new Promise(resolve => setImmediate(resolve));

    expect(settled).toBe(false);
    expect(stdout.pendingCount()).toBe(1);
    stdout.release();
    await expect(run).resolves.toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toBe(formatRootHelp(HOSTED_ROOT_HELP));
  });

  it('writes unknown-site stderr before root-help stdout', async () => {
    const order: string[] = [];
    const orderedSink = (label: string) => new Writable({
      write(_chunk, _encoding, callback) {
        order.push(label);
        callback();
      },
    });

    const result = await runHostedCli(['missing-site', 'child'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: orderedSink('stdout'),
      stderr: orderedSink('stderr'),
      fetchImpl: async () => manifestResponse(),
    });

    expect(result.exitCode).toBe(2);
    expect(order).toEqual(['stderr', 'stdout']);
  });

  it('does not resolve until a slow typed-error stderr write completes', async () => {
    const stderr = new ControlledWritable({ highWaterMark: 1 });
    let settled = false;
    const run = runHostedCli(['github', 'whoami', '--trace', 'always'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr,
      fetchImpl: async () => manifestResponse(),
    }).then(result => {
      settled = true;
      return result;
    });
    await new Promise(resolve => setImmediate(resolve));

    expect(settled).toBe(false);
    expect(stderr.pendingCount()).toBe(1);
    stderr.release();
    await expect(run).resolves.toEqual({ handled: true, exitCode: 2 });
    expect(stderr.text()).toContain('code: ARGUMENT');
  });

  it('rejects output stream errors without translating them or ending the caller stream', async () => {
    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('hosted stdout failed'));
      },
    });
    const end = vi.spyOn(stdout, 'end');

    await expect(runHostedCli(['--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout,
    })).rejects.toThrow('hosted stdout failed');
    expect(end).not.toHaveBeenCalled();
  });

  it('rejects within a bound when caller-owned stdout closes before its callback', async () => {
    const stdout = new CloseBeforeCallbackWritable();
    const end = vi.spyOn(stdout, 'end');

    await expect(within(runHostedCli(['--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout,
    }))).rejects.toThrow('closed before the write completed');
    expect(end).not.toHaveBeenCalled();
  });

  it('renders hosted list without LOCAL commands', async () => {
    const stdout = sink();

    const result = await runHostedCli(['list', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async () => manifestResponse(),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toContain('github/whoami');
    expect(stdout.text()).not.toContain('docker/ps');
  });

  it('dispatches hosted commands to /v1/execute', async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const stdout = sink();

    const result = await runHostedCli(['github', 'whoami', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
        });
        if (String(url).endsWith('/v1/manifest')) {
          return manifestResponse();
        }
        return executionResponse({ result: [{ username: 'octocat' }], columns: ['username'] });
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
    expect(stdout.text()).toBe('[\n  {\n    "username": "octocat"\n  }\n]\n');
  });

  it('uploads local file args, runs a prepared execution, and materializes hosted output artifacts', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    try {
      const sourcePath = path.join(tempDir, 'source.txt');
      const outputDir = path.join(tempDir, 'downloads');
      await writeFile(sourcePath, 'input bytes');
      const requests: Array<{ method: string; pathname: string; body?: unknown; filename?: string | null; contentType?: string | null }> = [];
      const stdout = sink();

      const result = await runHostedCli(['files', 'copy', '--source', sourcePath, '--output', outputDir, '-f', 'json'], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        fetchImpl: async (url, init) => {
          const parsedUrl = new URL(String(url));
          const rawBody = init?.body;
          requests.push({
            method: init?.method ?? 'GET',
            pathname: parsedUrl.pathname,
            ...(rawBody instanceof Uint8Array
              ? { body: Buffer.from(rawBody).toString('utf8') }
              : rawBody
                ? { body: JSON.parse(String(rawBody)) as unknown }
                : {}),
            filename: new Headers(init?.headers).get('x-webcmd-filename'),
            contentType: new Headers(init?.headers).get('x-webcmd-content-type'),
          });
          if (parsedUrl.pathname === '/v1/manifest') {
            return new Response(JSON.stringify({ ok: true, manifest: manifestWithFileCommand() }), { status: 200 });
          }
          if (parsedUrl.pathname === '/v1/executions') {
            return new Response(JSON.stringify({
              ok: true,
              execution: { id: 'exec_files', command: 'files/copy', status: 'queued' },
              fileArguments: [
                {
                  name: 'source',
                  direction: 'input',
                  pathKind: 'file',
                  multiple: false,
                  required: true,
                  contentTypes: ['text/plain'],
                  maxBytes: 1024,
                },
                {
                  name: 'output',
                  direction: 'output',
                  pathKind: 'directory',
                  multiple: false,
                  required: true,
                },
              ],
            }), { status: 201 });
          }
          if (parsedUrl.pathname === '/v1/executions/exec_files/artifacts/source') {
            return new Response(JSON.stringify({
              ok: true,
              artifact: {
                artifactId: 'ea_input',
                argument: 'source',
                direction: 'input',
                pathKind: 'file',
                filename: 'source.txt',
                contentType: 'text/plain',
                byteSize: 11,
                expiresAt: '2026-07-10T00:00:00.000Z',
              },
              reference: { $webcmdArtifact: { id: 'ea_input', direction: 'input' } },
            }), { status: 201 });
          }
          if (parsedUrl.pathname === '/v1/executions/exec_files/run') {
            return new Response(JSON.stringify({
              ok: true,
              result: [{ status: 'copied', file: '/private/cloud-root/nested/result.txt' }],
              columns: ['status', 'file'],
              execution: { id: 'exec_files', command: 'files/copy', status: 'succeeded' },
              artifacts: [{
                artifactId: 'ea_output',
                argument: 'output',
                direction: 'output',
                pathKind: 'file',
                filename: 'result.txt',
                contentType: 'text/plain',
                byteSize: 11,
                relativePath: 'nested/result.txt',
                expiresAt: '2026-07-10T00:00:00.000Z',
              }],
            }), { status: 200 });
          }
          if (parsedUrl.pathname === '/v1/executions/exec_files/artifacts/ea_output') {
            return new Response('hello cloud', { status: 200 });
          }
          return new Response(JSON.stringify({
            ok: false,
            error: { code: 'NOT_FOUND', message: parsedUrl.pathname, exitCode: 1 },
          }), { status: 404 });
        },
      });

      expect(result).toEqual({ handled: true, exitCode: 0 });
      expect(requests.map(request => `${request.method} ${request.pathname}`)).toEqual([
        'GET /v1/manifest',
        'POST /v1/executions',
        'POST /v1/executions/exec_files/artifacts/source',
        'POST /v1/executions/exec_files/run',
        'GET /v1/executions/exec_files/artifacts/ea_output',
      ]);
      expect(requests[2]).toMatchObject({
        body: 'input bytes',
        filename: 'source.txt',
        contentType: 'text/plain',
      });
      expect(requests[3]?.body).toMatchObject({
        command: 'files/copy',
        args: {
          source: { $webcmdArtifact: { id: 'ea_input', direction: 'input' } },
          output: { $webcmdArtifact: { direction: 'output', filename: 'downloads', contentType: 'application/octet-stream' } },
        },
        format: 'json',
        trace: 'off',
      });
      await expect(readFile(path.join(outputDir, 'nested', 'result.txt'), 'utf8')).resolves.toBe('hello cloud');
      expect(JSON.parse(stdout.text())).toEqual([{
        status: 'copied',
        file: path.join(outputDir, 'nested', 'result.txt'),
      }]);
      expect(stdout.text()).not.toContain('/private/cloud-root');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    { name: 'scalar field', result: { value: 'hello' }, argv: ['-f', 'plain'], expected: 'hello\n' },
    {
      name: 'multiple rows',
      result: [{ username: 'alice' }, { username: 'bob' }],
      argv: ['-f', 'csv'],
      expected: 'username\nalice\nbob\n',
    },
    {
      name: 'CSV escaping',
      result: [{ username: 'a,"b\nline 2' }],
      argv: ['-f', 'csv'],
      expected: 'username\n"a,""b\nline 2"\n',
    },
    {
      name: 'literal Markdown cells',
      result: [{ username: 'a|b\nline 2' }],
      argv: ['-f', 'md'],
      expected: '| username |\n| --- |\n| a|b\nline 2 |\n',
    },
  ])('renders hosted $name with canonical literal bytes', async ({ result, argv, expected }) => {
    const stdout = sink(true);
    await runHostedCli(['github', 'whoami', ...argv], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : executionResponse({ result }),
    });

    expect(stdout.text()).toBe(expected);
  });

  it('uses the response columns and falls back to command columns', async () => {
    const withResponseColumns = sink();
    const withoutResponseColumns = sink();
    const result = [{ username: 'octocat', secret: 'hidden' }];
    const run = async (stdout: ReturnType<typeof sink>, columns?: string[]) => runHostedCli([
      'github', 'whoami', '-f', 'csv',
    ], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : executionResponse({ result, ...(columns ? { columns } : {}) }),
    });

    await run(withResponseColumns, ['secret']);
    await run(withoutResponseColumns);

    expect(withResponseColumns.text()).toBe('secret\nhidden\n');
    expect(withoutResponseColumns.text()).toBe('username\noctocat\n');
  });

  it('propagates implicit versus explicit table format to non-TTY rendering', async () => {
    const implicit = sink(false);
    const explicit = sink(false);
    const run = async (stdout: ReturnType<typeof sink>, argv: string[]) => runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : executionResponse({ result: [{ username: 'octocat' }] }),
    });

    await run(implicit, ['github', 'whoami']);
    await run(explicit, ['github', 'whoami', '-f', 'table']);

    expect(implicit.text()).toBe('- username: octocat\n\n');
    expect(explicit.text()).toContain('octocat');
    expect(explicit.text()).not.toContain('username: octocat');
  });

  it('uses the command default format only when format was not explicit', async () => {
    const implicit = sink(false);
    const explicit = sink(false);
    const manifestWithDefault = {
      ...manifest,
      commands: manifest.commands.map(command => command.command === 'github/whoami'
        ? { ...command, defaultFormat: 'plain' }
        : command),
    };
    const run = async (stdout: ReturnType<typeof sink>, argv: string[]) => runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? new Response(JSON.stringify({ ok: true, manifest: manifestWithDefault }), { status: 200 })
        : executionResponse({ result: { response: 'hello' } }),
    });

    await run(implicit, ['github', 'whoami']);
    await run(explicit, ['github', 'whoami', '-f', 'json']);

    expect(implicit.text()).toBe('hello\n');
    expect(explicit.text()).toBe('{\n  "response": "hello"\n}\n');
  });

  it('renders only response.result with canonical local table labels and elapsed semantics', async () => {
    const stdout = sink(true);
    const times = [1_000, 1_250];
    await runHostedCli(['github', 'whoami', '-f', 'table'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      now: () => times.shift() ?? 1_250,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        return new Response(JSON.stringify({
          ok: true,
          result: [{ username: 'octocat' }],
          execution: { id: 'exec_success', command: 'github/whoami', status: 'succeeded' },
        }), { status: 200 });
      },
    });

    expect(stdout.text()).toContain('octocat');
    expect(stdout.text()).toContain('  github/whoami');
    expect(stdout.text()).toContain('1 items | 0.3s | github/whoami');
    expect(stdout.text()).not.toContain('webcmd cloud');
  });

  it('writes a successful trace=on receipt to injected stderr exactly once', async () => {
    const stdout = sink();
    const stderr = sink();
    await runHostedCli(['github', 'whoami', '--trace', 'on', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : executionResponse({
            result: [{ username: 'octocat' }],
            trace: {
              receipt: 'trace_receipt',
              executionId: 'exec_success',
              artifactsUrl: '/v1/executions/exec_success/artifacts',
            },
          }),
    });

    expect(stderr.text()).toBe('Webcmd trace artifact: trace_receipt\n');
    expect(stdout.text()).not.toContain('trace_receipt');
  });

  it('prints an adapter viewer capability to stderr exactly once after rendering the result', async () => {
    const stdout = sink();
    const stderr = sink();
    const viewUrl = 'https://api.example.com/account/live/adapter-token';
    await runHostedCli(['github', 'whoami', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : executionResponse({ result: [{ username: 'octocat' }], viewUrl }),
    });

    expect(stdout.text()).toContain('octocat');
    expect(stderr.text()).toBe(`Webcmd browser: ${viewUrl}\n`);
  });

  it.each([
    ['already_logged_in', 'json'],
    ['in_progress', 'yaml'],
    ['action_required', 'table'],
  ])('passes through hosted login state %s in %s output', async (status, format) => {
    const stdout = sink(format === 'table');
    const actionUrl = 'https://api.example.com/account/auth/action-token';
    const viewUrl = 'https://api.example.com/account/live/view-token';
    const row = {
      status,
      logged_in: status === 'already_logged_in',
      site: 'github',
      action: status === 'action_required' ? 'Complete sign-in.' : '',
      verify_command: 'webcmd github whoami',
      action_url: actionUrl,
      view_url: viewUrl,
      expires_at: '2026-07-22T12:00:00.000Z',
    };
    await runHostedCli(['github', 'login', '-f', format], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: sink().stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? authManifestResponse()
        : executionResponse({
            command: 'github/login',
            result: [row],
            columns: ['status', 'logged_in', 'site', 'action', 'verify_command', 'action_url', 'view_url', 'expires_at'],
          }),
    });

    expect(stdout.text()).toContain(status);
    expect(stdout.text()).toContain('webcmd github whoami');
    expect(stdout.text()).toContain(actionUrl);
    expect(stdout.text()).toContain(viewUrl);
    expect(stdout.text()).toContain('2026-07-22T12:00:00.000Z');
  });

  it('dispatches auth/refresh from the hosted manifest through the execute endpoint', async () => {
    const requests: Array<{ pathname: string; body?: unknown }> = [];
    const result = await runHostedCli(['--profile', 'work', 'auth', 'refresh', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        requests.push({ pathname, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        return pathname === '/v1/manifest'
          ? authManifestResponse()
          : executionResponse({ command: 'auth/refresh', result: [] });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests).toEqual([
      { pathname: '/v1/manifest' },
      {
        pathname: '/v1/execute',
        body: { command: 'auth/refresh', args: {}, format: 'json', trace: 'off', profile: 'work' },
      },
    ]);
  });

  it('does not present manifest-backed auth as a local-only command', () => {
    expect(HOSTED_ROOT_HELP.localOnlyCommands).not.toContainEqual(expect.objectContaining({ name: 'auth' }));
  });

  it.each(['off', 'retain-on-failure'])('does not write a success trace notice for trace=%s', async (trace) => {
    const stderr = sink();
    await runHostedCli(['github', 'whoami', '--trace', trace, '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : executionResponse({ result: [] }),
    });

    expect(stderr.text()).toBe('');
  });

  it('attaches hosted failure trace metadata to the local error envelope', async () => {
    const stderr = sink();
    const result = await runHostedCli(['github', 'whoami', '--trace', 'retain-on-failure'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
          execution: { id: 'exec_failure', command: 'github/whoami', status: 'failed' },
          trace: {
            receipt: 'trace_failure',
            executionId: 'exec_failure',
            artifactsUrl: '/v1/executions/exec_failure/artifacts',
          },
        }), { status: 401 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 77 });
    expect(stderr.text()).toContain('receipt: trace_failure');
    expect(stderr.text()).toContain('executionId: exec_failure');
    expect(stderr.text()).not.toContain('Webcmd trace artifact:');
  });

  it.each(['table', 'json', 'yaml', 'csv', 'md', 'plain'])('renders a failed-execution handoff on stderr only for %s output', async (format) => {
    const stdout = sink();
    const stderr = sink();
    const viewUrl = 'https://api.example.com/account/live/failure-token';
    const handoff = {
      status: 'action_required',
      action: 'Complete sign-in in the hosted browser.',
      viewUrl,
      expiresAt: '2026-07-23T12:00:00.000Z',
      verifyCommand: 'webcmd github whoami',
    };
    const result = await runHostedCli(['github', 'whoami', '-f', format], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
          execution: { id: 'exec_failure', command: 'github/whoami', status: 'failed' },
          handoff,
        }), { status: 401 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 77 });
    expect(stdout.text()).toBe('');
    expect(stderr.text().match(/^Webcmd browser:/gm)).toHaveLength(1);
    expect(stderr.text()).toBe([
      `Webcmd browser: ${viewUrl}`,
      'ok: false',
      'error:',
      '  code: AUTH_REQUIRED',
      '  message: Sign in first',
      '  exitCode: 77',
      'handoff:',
      '  status: action_required',
      '  action: Complete sign-in in the hosted browser.',
      `  viewUrl: ${viewUrl}`,
      "  expiresAt: '2026-07-23T12:00:00.000Z'",
      '  verifyCommand: webcmd github whoami',
      '',
    ].join('\n'));
  });

  it.each(['success', 'failure'])('rejects a raw provider trace URL before $phase output or attachment', async (phase) => {
    const rawUrl = 'https://kernel.example/session/private?token=kernel-secret-token';
    const stdout = sink();
    const stderr = sink();
    const success = phase === 'success';
    const result = await runHostedCli([
      'github',
      'whoami',
      '--trace',
      success ? 'on' : 'retain-on-failure',
      '-f',
      'json',
    ], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        return new Response(JSON.stringify(success ? {
          ok: true,
          result: [{ username: 'octocat' }],
          execution: { id: 'exec_trace', command: 'github/whoami', status: 'succeeded' },
          trace: { receipt: 'trace_receipt', executionId: 'exec_trace', liveViewUrl: rawUrl },
        } : {
          ok: false,
          error: { code: 'AUTH_REQUIRED', message: 'Sign in first', exitCode: 77 },
          execution: { id: 'exec_trace', command: 'github/whoami', status: 'failed' },
          trace: { receipt: 'trace_receipt', executionId: 'exec_trace', liveViewUrl: rawUrl },
        }), { status: success ? 200 : 401 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('HOSTED_PROTOCOL');
    expect(`${stdout.text()}\n${stderr.text()}`).not.toContain(rawUrl);
    expect(`${stdout.text()}\n${stderr.text()}`).not.toContain('kernel-secret-token');
  });

  it('accepts a manifest patch bump on the same hosted compatibility line', async () => {
    const requests: string[] = [];
    const stdout = sink();
    const patchBumped = {
      ...manifest,
      metadata: { ...manifest.metadata, webcmdPackageVersion: '0.3.99' },
    };
    const result = await runHostedCli(['github', 'whoami', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url) => {
        requests.push(String(url));
        return String(url).endsWith('/v1/manifest')
          ? new Response(JSON.stringify({ ok: true, manifest: patchBumped }), { status: 200 })
          : executionResponse({ result: [{ username: 'octocat' }], columns: ['username'] });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests).toEqual([
      'https://api.example.com/v1/manifest',
      'https://api.example.com/v1/execute',
    ]);
    expect(stdout.text()).toBe('[\n  {\n    "username": "octocat"\n  }\n]\n');
  });

  it('rejects a manifest whose compatibility line differs from installed hosted-contract.json before execution', async () => {
    const requests: string[] = [];
    const stderr = sink();
    const mismatched = {
      ...manifest,
      metadata: { ...manifest.metadata, webcmdPackageVersion: '0.4.0' },
    };
    const result = await runHostedCli(['github', 'whoami'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        requests.push(String(url));
        return new Response(JSON.stringify({ ok: true, manifest: mismatched }), { status: 200 });
      },
    });

    expect(result.exitCode).toBe(1);
    expect(stderr.text()).toMatch(/HOSTED_PROTOCOL|hosted contract/i);
    expect(requests).toEqual(['https://api.example.com/v1/manifest']);
  });

  it('writes a result larger than 1 MiB completely through injected stdout', async () => {
    const value = 'x'.repeat((1024 * 1024) + 31);
    const stdout = sink();
    await runHostedCli(['github', 'whoami', '-f', 'plain'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : executionResponse({ result: { value } }),
    });

    const expected = `${value}\n`;
    expect(stdout.text().length).toBe(expected.length);
    expect(createHash('sha256').update(stdout.text()).digest('hex'))
      .toBe(createHash('sha256').update(expected).digest('hex'));
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

  it.each([
    { name: 'help before unknown leaf option', argv: ['browser', 'work', 'state', '--help', '--unknown'] },
    { name: 'unknown leaf option before help', argv: ['browser', 'work', 'state', '--unknown', '--help'] },
    { name: 'help followed by missing leaf option value', argv: ['browser', 'work', 'state', '--help', '--source'] },
    { name: 'ordinary unknown leaf option', argv: ['browser', 'work', 'state', '--unknown'] },
    { name: 'ordinary missing leaf option value', argv: ['browser', 'work', 'state', '--source'] },
    { name: 'ordinary excess leaf positional', argv: ['browser', 'work', 'state', 'extra'] },
    { name: 'ordinary missing required leaf positional', argv: ['browser', 'work', 'eval'] },
    { name: 'missing namespace window value', argv: ['browser', 'work', '--window'] },
    { name: 'unhoisted missing trailing window value', argv: ['browser', 'work', 'state', '--window'] },
    { name: 'invalid Commander-coerced screenshot dimension', argv: ['browser', 'work', 'screenshot', '--width=-10'] },
    { name: 'root profile after the leaf', argv: ['browser', 'work', 'state', '--profile', 'other'] },
    { name: 'root profile between namespace and leaf', argv: ['browser', 'work', '--profile', 'other', 'state'] },
    { name: 'adapter site-session option at browser namespace', argv: ['browser', 'work', '--site-session', 'persistent', 'state'] },
    { name: 'adapter keep-tab option at browser leaf', argv: ['browser', 'work', 'state', '--keep-tab', 'true'] },
    { name: 'unknown browser command', argv: ['browser', 'work', 'missing'] },
  ])('matches local browser Commander structural bytes/status with no cloud call: $name', async ({ argv }) => {
    const local = captureLocalBrowserStructure(argv);
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect({ exitCode: result.exitCode, stdout: stdout.text(), stderr: stderr.text() }).toEqual(local);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('matches the exact local text help for every catalogued browser leaf without a cloud call', async () => {
    const program = createProgram('', '');
    const browser = program.commands.find(command => command.name() === 'browser');
    if (!browser) throw new Error('Local browser namespace is missing');

    for (const contract of browserCommandCatalog) {
      const parts = contract.command.split('/');
      let local = browser;
      for (const part of parts) {
        const child = local.commands.find(command => command.name() === part || command.aliases().includes(part));
        if (!child) throw new Error(`Local browser command is missing: ${contract.command}`);
        local = child;
      }
      const stdout = sink();
      const stderr = sink();
      const fetchImpl = vi.fn<typeof fetch>();

      const result = await runHostedCli(['browser', 'work', ...parts, '--help'], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        stderr: stderr.stream,
        fetchImpl,
      });

      expect({ command: contract.command, result, stdout: stdout.text(), stderr: stderr.text() }).toEqual({
        command: contract.command,
        result: { handled: true, exitCode: 0 },
        stdout: local.helpInformation(),
        stderr: '',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('dispatches every catalogued hosted browser command except bind to the cloud command endpoint', async () => {
    const uploadDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-browser-upload-'));
    const uploadFile = path.join(uploadDir, 'sample-upload.txt');
    await writeFile(uploadFile, 'hello browser upload');
    try {
      for (const contract of browserCommandCatalog.filter(command => command.command !== 'bind')) {
        const requests: Array<{ pathname: string; body?: Record<string, unknown> }> = [];
        const positionals = contract.command === 'upload'
          ? ['input[type=file]', uploadFile]
          : sampleBrowserPositionals(contract);
        const result = await runHostedCli(['browser', 'work', ...contract.command.split('/'), ...positionals], {
          config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
          stdout: sink().stream,
          stderr: sink().stream,
          fetchImpl: async (url, init) => {
            const parsedUrl = new URL(String(url));
            const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
            requests.push({ pathname: parsedUrl.pathname, ...(body ? { body } : {}) });
            if (parsedUrl.pathname === '/v1/manifest') return manifestResponse();
            if (parsedUrl.pathname === '/v1/browser/work/commands') {
              return new Response(JSON.stringify({
                ok: true,
                result: {},
                columns: [],
                trace: null,
                run: {
                  executionId: `exec_${contract.command.replaceAll('/', '_')}`,
                  session: 'work',
                  profile: { id: 'profile_default', displayName: 'default' },
                },
                execution: { id: `exec_${contract.command.replaceAll('/', '_')}`, status: 'succeeded' },
              }), { status: 200 });
            }
            return new Response(JSON.stringify({
              ok: false,
              error: { code: 'UNEXPECTED', message: parsedUrl.pathname, exitCode: 1 },
            }), { status: 500 });
          },
        });

        expect({ command: contract.command, result }).toEqual({
          command: contract.command,
          result: { handled: true, exitCode: 0 },
        });
        expect({
          command: contract.command,
          action: requests.find(request => request.pathname === '/v1/browser/work/commands')?.body,
        }).toMatchObject({
          command: contract.command,
          action: { command: `browser/${contract.command}`, action: contract.action },
        });
      }
    } finally {
      await rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('routes hosted browser positional commands through the atomic cloud action route', async () => {
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
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        if (String(url).endsWith('/commands')) {
          return new Response(JSON.stringify({
            ok: true,
            result: { url: 'https://example.com' },
            columns: ['url'],
            trace: null,
            run: {
              executionId: 'exec_browser',
              session: 'work',
              profile: { id: 'profile_default', displayName: 'default' },
            },
            execution: { id: 'exec_browser', status: 'succeeded' },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED', message: String(url), exitCode: 1 } }), { status: 500 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toContain('https://example.com');
    expect(requests).toEqual([
      {
        url: 'https://api.example.com/v1/manifest',
        body: undefined,
      },
      {
        url: 'https://api.example.com/v1/browser/work/commands',
        body: {
          command: 'browser/open',
          action: 'navigate',
          args: { url: 'https://example.com' },
          profile: 'default',
          windowMode: 'background',
          trace: 'off',
        },
      },
    ]);
  });

  it('prints a raw-browser viewer capability to stderr exactly once', async () => {
    const stdout = sink();
    const stderr = sink();
    const liveViewUrl = 'https://api.example.com/account/live/browser-token';
    const result = await runHostedCli(['browser', 'work', 'state'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : new Response(JSON.stringify({
            ok: true,
            result: { url: 'https://github.com', snapshot: 'GitHub' },
            columns: [],
            trace: null,
            run: {
              executionId: 'exec_browser_view',
              session: 'work',
              profile: { id: 'profile_default', displayName: 'default' },
              liveViewUrl,
            },
            execution: { id: 'exec_browser_view', status: 'succeeded' },
          }), { status: 200 }),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toContain('GitHub');
    expect(stderr.text()).toBe(`Webcmd browser: ${liveViewUrl}\n`);
  });

  it('uses the canonical Commander value for a dash-leading browser option in the Cloud request', async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const result = await runHostedCli(['browser', 'work', 'scroll', 'down', '--amount', '-5'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        requests.push({ url: String(url), ...(body ? { body } : {}) });
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        if (String(url).endsWith('/commands')) {
          return new Response(JSON.stringify({
            ok: true,
            result: { scrolled: 'down', amount: -5 },
            columns: ['scrolled', 'amount'],
            trace: null,
            run: {
              executionId: 'exec_browser_scroll',
              session: 'work',
              profile: { id: 'profile_default', displayName: 'default' },
            },
            execution: { id: 'exec_browser_scroll', status: 'succeeded' },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED', message: String(url), exitCode: 1 } }), { status: 500 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests[1]?.body).toEqual({
      command: 'browser/scroll',
      action: 'scroll',
      args: { direction: 'down', amount: '-5' },
      trace: 'off',
    });
  });

  it.each([
    {
      name: 'repeated and equals string option',
      argv: ['browser', 'work', 'scroll', 'down', '--amount', '10', '--amount=-5'],
      command: 'browser/scroll',
      action: 'scroll',
      args: { direction: 'down', amount: '-5' },
    },
    {
      name: 'equals dash-leading frame option',
      argv: ['browser', 'work', 'eval', 'return 1', '--frame=-2'],
      command: 'browser/eval',
      action: 'exec',
      args: { js: 'return 1', frame: '-2' },
    },
    {
      name: 'Commander-coerced dimensions and repeated boolean flag',
      argv: ['browser', 'work', 'screenshot', '--width=10', '--height', '20', '--full-page', '--full-page'],
      command: 'browser/screenshot',
      action: 'screenshot',
      args: { fullPage: true, annotate: false, width: 10, height: 20 },
    },
    {
      name: 'dash-leading timeout option',
      argv: ['browser', 'work', 'wait', 'time', '1', '--timeout', '-5'],
      command: 'browser/wait',
      action: 'wait',
      args: { type: 'time', value: '1', timeout: '-5' },
    },
    {
      name: 'dash-leading observation option and boolean flag',
      argv: ['browser', 'work', 'console', '--since', '-dash', '--follow'],
      command: 'browser/console',
      action: 'console',
      args: { level: 'all', follow: true, since: '-dash' },
    },
    {
      name: 'dash-leading positional behind separator',
      argv: ['browser', 'work', 'eval', '--', '-script'],
      command: 'browser/eval',
      action: 'exec',
      args: { js: '-script' },
    },
    {
      name: 'repeated namespace window option',
      argv: ['browser', 'work', '--window', 'foreground', '--window=background', 'state'],
      command: 'browser/state',
      action: 'snapshot',
      args: { source: 'dom', compareSources: false },
      windowMode: 'background',
    },
    {
      name: 'retained tab and comparison options',
      argv: ['browser', 'work', 'state', '--compare-sources', '--tab', 'page-2'],
      command: 'browser/state',
      action: 'snapshot',
      args: { source: 'dom', compareSources: true, tab: 'page-2' },
    },
    {
      name: 'semantic click without positional target',
      argv: ['browser', 'work', 'click', '--role', 'button', '--name', 'Submit', '--nth', '-1', '--tab', 'page-2'],
      command: 'browser/click',
      action: 'click',
      args: { role: 'button', name: 'Submit', nth: '-1', tab: 'page-2' },
    },
    {
      name: 'semantic type treats first positional as text',
      argv: ['browser', 'work', 'type', 'hello cloud', '--role', 'textbox', '--name', 'Search'],
      command: 'browser/type',
      action: 'type',
      args: { role: 'textbox', name: 'Search', text: 'hello cloud' },
    },
    {
      name: 'double-click retains action-specific options',
      argv: ['browser', 'work', 'dblclick', '#ok', '--nth', '2', '--tab', 'page-2'],
      command: 'browser/dblclick',
      action: 'dblclick',
      args: { target: '#ok', nth: '2', tab: 'page-2' },
    },
    {
      name: 'get text reaches hosted get action',
      argv: ['browser', 'work', 'get', 'text', '#result', '--nth', '0'],
      command: 'browser/get/text',
      action: 'get-text',
      args: { target: '#result', nth: '0' },
    },
  ])('sends canonical browser request bodies for $name', async ({ argv, command, action, args, windowMode }) => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        requests.push({ url: String(url), ...(body ? { body } : {}) });
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        if (String(url).endsWith('/commands')) {
          return new Response(JSON.stringify({
            ok: true,
            result: {},
            columns: [],
            trace: null,
            run: {
              executionId: 'exec_browser_canonical',
              session: 'work',
              profile: { id: 'profile_default', displayName: 'default' },
            },
            execution: { id: 'exec_browser_canonical', status: 'succeeded' },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED', message: String(url), exitCode: 1 } }), { status: 500 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests[1]?.body).toEqual({
      command,
      action,
      args,
      ...(windowMode ? { windowMode } : {}),
      trace: 'off',
    });
  });

  it('stages browser upload files without sending local paths to Cloud', async () => {
    const uploadDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-browser-upload-'));
    const uploadFile = path.join(uploadDir, '-one.txt');
    await writeFile(uploadFile, 'one file');
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    try {
      const result = await runHostedCli(['browser', 'work', 'upload', 'input[type=file]', '--', uploadFile], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: sink().stream,
        stderr: sink().stream,
        fetchImpl: async (url, init) => {
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
          requests.push({ url: String(url), ...(body ? { body } : {}) });
          if (String(url).endsWith('/v1/manifest')) return manifestResponse();
          if (String(url).endsWith('/commands')) {
            return new Response(JSON.stringify({
              ok: true,
              result: { uploaded: true, file_names: ['-one.txt'] },
              columns: ['uploaded', 'file_names'],
              trace: null,
              run: {
                executionId: 'exec_browser_upload',
                session: 'work',
                profile: { id: 'profile_default', displayName: 'default' },
              },
              execution: { id: 'exec_browser_upload', status: 'succeeded' },
            }), { status: 200 });
          }
          return new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED', message: String(url), exitCode: 1 } }), { status: 500 });
        },
      });

      expect(result).toEqual({ handled: true, exitCode: 0 });
      const files = requests[1]?.body?.args && (requests[1].body.args as Record<string, unknown>).files;
      expect(JSON.stringify(files)).not.toContain(uploadFile);
      expect(files).toEqual([{
        $webcmdBrowserUpload: {
          filename: '-one.txt',
          contentType: 'text/plain',
          base64: Buffer.from('one file').toString('base64'),
        },
      }]);
    } finally {
      await rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('rejects a browser manifest mismatch before starting a provider run', async () => {
    const requests: string[] = [];
    const stdout = sink();
    const stderr = sink();
    const mismatched = {
      ...manifest,
      metadata: { ...manifest.metadata, webcmdPackageVersion: '0.4.0' },
    };
    const result = await runHostedCli(['browser', 'work', 'state'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        requests.push(String(url));
        return new Response(JSON.stringify({ ok: true, manifest: mismatched }), { status: 200 });
      },
    });

    expect(result.exitCode).toBe(1);
    expect(requests).toEqual(['https://api.example.com/v1/manifest']);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toMatch(/HOSTED_PROTOCOL|hosted contract/i);
  });

  it('does not render private fields from a malformed browser action success', async () => {
    const requests: string[] = [];
    const stdout = sink();
    const stderr = sink();
    const privatePath = '/srv/private/token.json';
    const result = await runHostedCli(['browser', 'work', 'state'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        requests.push(String(url));
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        if (String(url).endsWith('/commands')) {
          return new Response(JSON.stringify({ ok: true, internalPath: privatePath }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED', message: String(url), exitCode: 1 } }), { status: 500 });
      },
    });

    expect(result.exitCode).toBe(1);
    expect(stdout.text()).toBe('');
    expect(stdout.text()).not.toContain(privatePath);
    expect(stderr.text()).toContain('HOSTED_PROTOCOL');
    expect(stderr.text()).not.toContain(privatePath);
    expect(requests).toEqual([
      'https://api.example.com/v1/manifest',
      'https://api.example.com/v1/browser/work/commands',
    ]);
  });

  it('reconstructs AutoFix commands without treating global option values as command words', async () => {
    const stderr = sink();
    const result = await runHostedCli(['--profile', 'default', 'github', 'whoami'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl: async () => { throw new Error('network failed'); },
    });

    expect(result.exitCode).toBe(1);
    expect(stderr.text()).toContain('# webcmd github whoami --trace retain-on-failure');
    expect(stderr.text()).not.toContain('# webcmd default github');
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
