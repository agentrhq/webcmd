import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable, type WritableOptions } from 'node:stream';
import type { Command } from 'commander';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserCommandCatalog } from '../browser/command-catalog.js';
import { buildHostedContract } from './contract.js';
import { rejectPositionalBrowserSessionArgv } from '../cli-argv-preprocess.js';
import { createProgram } from '../cli.js';
import { formatRootHelp } from '../command-presentation.js';
import { HOSTED_ROOT_HELP } from '../completion-shared.js';
import { PKG_VERSION } from '../version.js';
import { makeHostedConfig, makeLocalConfig } from './config.js';
import { createCaptureStream } from './capture-stream.js';
import { HostedClient } from './client.js';
import { runHostedCli } from './runner.js';
import { createVirtualFileMap, createVirtualOutputSink } from './virtual-files.js';

const [packageMajor, packageMinor] = PKG_VERSION.split('.');
const compatiblePatchVersion = `${packageMajor}.${packageMinor}.99`;
const incompatibleMinorVersion = `${packageMajor}.${Number(packageMinor) + 1}.0`;

it('ships no default site commands while preserving the browser contract', () => {
  const contract = buildHostedContract([], browserCommandCatalog, PKG_VERSION);

  expect(contract.commands).toEqual([]);
  expect(contract.browserCommands.map(command => command.command)).toEqual(
    browserCommandCatalog.map(command => command.command).sort((a, b) => a.localeCompare(b)),
  );
});

const manifest = {
  userId: 'user_demo',
  metadata: {
    contractSchemaVersion: 1,
            sessionProtocolVersion: 1,
            webcmdPackageVersion: PKG_VERSION,
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
      browser: false,
      args: [],
      columns: ['username'],
      tags: ['search'],
      keywords: ['identity'],
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

function browserManifestResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    manifest: {
      ...manifest,
      commands: manifest.commands.map(command => command.command === 'github/whoami' ? { ...command, browser: true } : command),
    },
  }), { status: 200 });
}

function executionResponse(input: {
  result: unknown;
  columns?: string[];
  trace?: Record<string, unknown>;
  command?: string;
}): Response {
  return new Response(JSON.stringify({
    ok: true,
    result: input.result,
    ...(input.columns ? { columns: input.columns } : {}),
    execution: { id: 'exec_success', command: input.command ?? 'github/whoami', status: 'succeeded' },
    ...(input.trace ? { trace: input.trace } : {}),
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
        browser: true,
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
    program.parse(rejectPositionalBrowserSessionArgv(argv), { from: 'user' });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const commander = error as { exitCode?: number };
    return { exitCode: commander.exitCode ?? 1, stdout, stderr };
  }
}

describe('runHostedCli', () => {
  const hostedValidationReport = {
    ok: true,
    results: [{ label: 'github/list', errors: [], warnings: [] }],
    errors: 0,
    warnings: 0,
    commands: 1,
  };
  const hostedConventionReport = {
    ok: true,
    summary: { commands: 1, sites: 1, files_scanned: 1, violations: 0 },
    categories: [],
  };
  const hostedProfile = {
    id: 'profile_1',
    name: 'work',
    workspace: 'workspace_1',
    default: false,
    status: 'available',
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    lastUsedAt: '2026-08-27T00:00:00.000Z',
  };

  it.each([
    {
      name: 'validate',
      id: 'validate',
      argv: ['validate', 'github', '-f', 'json'],
      request: { path: '/v1/adapters/validate?target=github', method: 'GET' },
      response: { ok: true, report: hostedValidationReport },
      structured: hostedValidationReport,
    },
    {
      name: 'verify',
      id: 'verify',
      argv: ['verify', 'github/list', '--smoke'],
      request: { path: '/v1/adapters/verify', method: 'POST', body: '{"target":"github/list","smoke":true}' },
      response: { ok: true, report: { ok: true, validation: hostedValidationReport, smoke: { requested: true, executed: true, ok: true, summary: '1 passed', results: [{ command: 'github/list', status: 'passed', message: 'Passed.' }] } } },
      contains: 'webcmd validate: PASS',
    },
    {
      name: 'convention audit',
      id: 'convention-audit',
      argv: ['convention-audit', '--site', 'github'],
      request: { path: '/v1/adapters/convention-audit?site=github', method: 'GET' },
      response: { ok: true, report: hostedConventionReport },
      contains: 'Convention Audit Report',
    },
    {
      name: 'doctor',
      id: 'doctor',
      argv: ['doctor'],
      request: { path: '/v1/doctor', method: 'GET' },
      response: { ok: true, report: { ok: true, checks: [{ id: 'api', ok: true, required: true, message: 'Authenticated.' }] } },
      contains: 'PASS  api  Authenticated.',
    },
    {
      name: 'adapter status',
      id: 'adapter/status',
      argv: ['adapter', 'status'],
      request: { path: '/v1/adapters/status', method: 'GET' },
      response: { ok: true, adapters: [{ command: 'github/list', kind: 'override', package: '@user/github', reconciliationState: 'current', loadError: null }] },
      contains: 'github/list',
    },
    {
      name: 'adapter reset',
      id: 'adapter/reset',
      argv: ['adapter', 'reset', 'github'],
      request: { path: '/v1/adapters/overrides?site=github', method: 'DELETE' },
      response: { ok: true, removed: [{ packageId: 'package_1', package: '@user/github', commands: ['github/list', 'github/get'] }] },
      contains: '@user/github: github/list, github/get',
    },
    {
      name: 'profile create',
      id: 'profile/create',
      argv: ['profile', 'create', 'work'],
      request: { path: '/v1/profiles', method: 'POST', body: '{"name":"work"}' },
      response: { ok: true, profile: hostedProfile, created: true },
      responseStatus: 201,
      structured: { ok: true, profile: hostedProfile, created: true },
    },
    {
      name: 'plugin catalog list',
      id: 'plugin/catalog/list',
      argv: ['plugin', 'catalog', 'list', '-f', 'json'],
      request: { path: '/v1/marketplace/catalog', method: 'GET' },
      response: { ok: true, sources: [{ id: 'official', repository: 'https://github.com/agentrhq/webcmd', commit: 'abc123', manifestPath: 'marketplace.json', status: 'consistent' }] },
      structured: { ok: true, sources: [{ id: 'official', repository: 'https://github.com/agentrhq/webcmd', commit: 'abc123', manifestPath: 'marketplace.json', status: 'consistent' }] },
    },
  ])('gates and dispatches hosted $name', async ({ id, argv, request, response, responseStatus = 200, structured, contains }) => {
    const requests: Array<{ path: string; method: string; body?: string }> = [];
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname + new URL(String(url)).search;
        requests.push({ path, method: init?.method ?? 'GET', ...(init?.body !== undefined ? { body: String(init.body) } : {}) });
        if (path === '/v1/manifest') {
          return new Response(JSON.stringify({ ok: true, manifest: { ...manifest, metadata: { ...manifest.metadata, coreCommands: [id] } } }));
        }
        return new Response(JSON.stringify(response), { status: responseStatus });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(requests).toEqual([{ path: '/v1/manifest', method: 'GET' }, request]);
    if (structured) expect(yaml.load(stdout.text())).toEqual(structured);
    if (contains) expect(stdout.text()).toContain(contains);
  });

  it('resolves a hosted profile name before rename', async () => {
    const requests: Array<{ path: string; method: string; body?: string }> = [];
    const stdout = sink();
    const result = await runHostedCli(['profile', 'rename', 'work', 'personal'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname + new URL(String(url)).search;
        requests.push({ path, method: init?.method ?? 'GET', ...(init?.body !== undefined ? { body: String(init.body) } : {}) });
        if (path === '/v1/manifest') return new Response(JSON.stringify({ ok: true, manifest: { ...manifest, metadata: { ...manifest.metadata, coreCommands: ['profile/rename'] } } }));
        if (path === '/v1/profiles') return new Response(JSON.stringify({ ok: true, profiles: [hostedProfile] }));
        return new Response(JSON.stringify({ ok: true, profile: { ...hostedProfile, name: 'personal' }, changed: true }));
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests).toEqual([
      { path: '/v1/manifest', method: 'GET' },
      { path: '/v1/profiles', method: 'GET' },
      { path: '/v1/profiles/profile_1', method: 'PATCH', body: '{"name":"personal"}' },
    ]);
    expect(yaml.load(stdout.text())).toEqual({ ok: true, profile: { ...hostedProfile, name: 'personal' }, changed: true });
  });

  it('does not call an unavailable hosted core endpoint', async () => {
    const requests: string[] = [];
    const stderr = sink();
    const result = await runHostedCli(['validate'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        requests.push(new URL(String(url)).pathname);
        return new Response(JSON.stringify({ ok: true, manifest: { ...manifest, metadata: { ...manifest.metadata, coreCommands: [] } } }));
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 78 });
    expect(requests).toEqual(['/v1/manifest']);
    expect(stderr.text()).toContain('Upgrade Webcmd Cloud or use a compatible endpoint.');
  });

  it('preserves a failed doctor report on stdout and exits CONFIG_ERROR', async () => {
    const report = { ok: false, checks: [{ id: 'capacity', ok: false, required: true, message: 'No capacity.' }] };
    const stdout = sink();
    const result = await runHostedCli(['doctor', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: sink().stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? new Response(JSON.stringify({ ok: true, manifest: { ...manifest, metadata: { ...manifest.metadata, coreCommands: ['doctor'] } } }))
        : new Response(JSON.stringify({ ok: true, report })),
    });

    expect(result).toEqual({ handled: true, exitCode: 78 });
    expect(JSON.parse(stdout.text())).toEqual(report);
  });

  it('maps a failing strict convention audit to exit 1', async () => {
    const report = { ok: false, summary: { commands: 1, sites: 1, files_scanned: 1, violations: 1 }, categories: [] };
    const result = await runHostedCli(['convention-audit', '--strict', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? new Response(JSON.stringify({ ok: true, manifest: { ...manifest, metadata: { ...manifest.metadata, coreCommands: ['convention-audit'] } } }))
        : new Response(JSON.stringify({ ok: true, report })),
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
  });

  it.each([
    ['daemon', 'status'],
    ['daemon', 'stop'],
    ['daemon', 'restart'],
    ['plugin', 'catalog', 'add', 'github:owner/repo'],
    ['plugin', 'catalog', 'remove', 'official'],
    ['plugin', 'install', 'github:owner/repo', '--all'],
  ])('keeps excluded hosted mutations local-only: %j', async (...argv) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: sink().stream,
      fetchImpl,
    });

    expect(result.exitCode).toBe(78);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('registers the hosted site-memory and adapter-source grammar', async () => {
    const grammar = [
      ['site', 'memory', 'show'], ['site', 'memory', 'list'], ['site', 'note', 'add'],
      ['site', 'endpoint', 'set'], ['site', 'endpoint', 'stale'], ['site', 'field-map', 'add'],
      ['site', 'fixture', 'get'], ['site', 'fixture', 'put'], ['site', 'sample', 'add'],
      ['adapter', 'source', 'get'], ['adapter', 'source', 'put'], ['adapter', 'path'],
    ];
    const program = createProgram('', '');
    for (const path of grammar) {
      let command: Command | undefined = program;
      for (const segment of path) command = command?.commands.find(candidate => candidate.name() === segment);
      expect(command).toBeDefined();
    }
  });

  it('uses hosted manifest provenance for adapter source and keeps memory reads on stdout', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-authoring-'));
    const stdout = sink();
    const source = 'export const search = true;\n';
    const sourceManifest = {
      ...manifest,
      commands: [{ ...manifest.commands[0], adapterPackageId: 'pkg_github', sourceFile: 'clis/github/search.js' }],
    };
    try {
      const run = (argv: string[]) => runHostedCli(argv, {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        homeDir,
        stdout: stdout.stream,
        fetchImpl: async (url) => {
          const pathname = new URL(String(url)).pathname;
          if (pathname === '/v1/manifest') return new Response(JSON.stringify({ ok: true, manifest: sourceManifest }));
          if (pathname === '/v1/sites/github/memory') return new Response(JSON.stringify({ ok: true, artifacts: [{ path: 'notes.md', kind: 'notes', contentType: 'application/json', sha256: 'abc', byteSize: 1, updatedAt: '2026-08-14T00:00:00.000Z' }] }));
          return new Response(pathname.includes('/memory/') ? 'Uses GraphQL\n' : source);
        },
      });

      await expect(run(['adapter', 'source', 'get', 'github/whoami'])).resolves.toMatchObject({ exitCode: 0 });
      await expect(readFile(path.join(homeDir, '.webcmd', 'hosted', 'clis', 'github', 'whoami.js'), 'utf8')).resolves.toBe(source);
      await expect(run(['adapter', 'source', 'get', 'github', 'whoami', '--output', '-'])).resolves.toMatchObject({ exitCode: 0 });
      await expect(run(['site', 'memory', 'show', 'github'])).resolves.toMatchObject({ exitCode: 0 });
      expect(stdout.text()).toContain('Uses GraphQL');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('writes the default adapter source destination into virtual outputs', async () => {
    const outputs = createVirtualOutputSink();
    const source = 'export const whoami = true;\n';
    const sourceManifest = {
      ...manifest,
      commands: [{ ...manifest.commands[0], adapterPackageId: 'pkg_github', sourceFile: 'clis/github/whoami.js' }],
    };

    const result = await runHostedCli(['adapter', 'source', 'get', 'github/whoami'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      homeDir: '/nonexistent-home',
      files: createVirtualFileMap([]),
      outputs,
      fetchImpl: async (url) => {
        const pathname = new URL(String(url)).pathname;
        return pathname === '/v1/manifest'
          ? new Response(JSON.stringify({ ok: true, manifest: sourceManifest }))
          : new Response(source);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(outputs.files()).toEqual([{
      path: '.webcmd/hosted/clis/github/whoami.js',
      content: new TextEncoder().encode(source),
    }]);
  });

  it('never writes to the host filesystem when only virtual files are injected', async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'webcmd-one-sided-files-'));
    const sentinel = path.join(scratch, 'must-not-be-created.js');
    const sourceManifest = {
      ...manifest,
      commands: [{ ...manifest.commands[0], adapterPackageId: 'pkg_github', sourceFile: 'clis/github/whoami.js' }],
    };
    try {
      const result = await runHostedCli(['adapter', 'source', 'get', 'github/whoami', '--output', sentinel], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        files: createVirtualFileMap([]),
        stdout: sink().stream,
        stderr: sink().stream,
        fetchImpl: async (url) => new URL(String(url)).pathname === '/v1/manifest'
          ? new Response(JSON.stringify({ ok: true, manifest: sourceManifest }))
          : new Response('host write sentinel'),
      });

      expect(result.exitCode).not.toBe(0);
      await expect(access(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('never reads from the host filesystem when only virtual outputs are injected', async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'webcmd-one-sided-outputs-'));
    const sentinel = path.join(scratch, 'must-not-be-read.js');
    const uploadedBodies: string[] = [];
    const sourceManifest = {
      ...manifest,
      commands: [{ ...manifest.commands[0], adapterPackageId: 'pkg_github', sourceFile: 'clis/github/whoami.js' }],
    };
    await writeFile(sentinel, 'host read sentinel');
    try {
      const result = await runHostedCli(['adapter', 'source', 'put', 'github/whoami', sentinel], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        outputs: createVirtualOutputSink(),
        stdout: sink().stream,
        stderr: sink().stream,
        fetchImpl: async (url, init) => {
          const pathname = new URL(String(url)).pathname;
          if (pathname === '/v1/manifest') {
            return new Response(JSON.stringify({ ok: true, manifest: sourceManifest }));
          }
          uploadedBodies.push(String(init?.body ?? ''));
          return new Response(JSON.stringify({
            ok: true,
            package: { id: 'pkg_github', storagePath: 'plugins/pkg_github' },
            commands: ['github/whoami'],
          }));
        },
      });

      expect(result.exitCode).not.toBe(0);
      expect(uploadedBodies).toEqual([]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('accepts hosted adapter source put command keys as two tokens', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-source-put-'));
    const update = path.join(homeDir, 'whoami.js');
    const requested: Array<{ pathname: string; method: string; body: string }> = [];
    const sourceManifest = {
      ...manifest,
      commands: [{ ...manifest.commands[0], adapterPackageId: 'pkg_github', sourceFile: 'clis/github/whoami.js' }],
    };
    await writeFile(update, 'export const updated = true;\n');
    try {
      const result = await runHostedCli(['adapter', 'source', 'put', 'github', 'whoami', update], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        homeDir,
        fetchImpl: async (url, init) => {
          const pathname = new URL(String(url)).pathname;
          if (pathname === '/v1/manifest') return new Response(JSON.stringify({ ok: true, manifest: sourceManifest }));
          requested.push({ pathname, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
          return new Response(JSON.stringify({ ok: true, package: { id: 'pkg_github', storagePath: 'pkg' }, commands: ['github/whoami'] }));
        },
      });

      expect(result.exitCode).toBe(0);
      expect(requested).toEqual([{
        pathname: '/v1/adapters/pkg_github/source/clis/github/whoami.js',
        method: 'PUT',
        body: 'export const updated = true;\n',
      }]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('forks a system command through hosted adapter override', async () => {
    const stdout = sink();
    const requested: Array<{ pathname: string; body: unknown }> = [];
    const result = await runHostedCli(['adapter', 'override', 'github/whoami'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        requested.push({ pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify({
          ok: true,
          command: 'github/whoami',
          package: { id: 'package_1', name: 'private-github-whoami', visibility: 'private' },
          installation: { id: 'install_1' },
          sourceFile: 'clis/github/whoami.js',
        }), { status: 201 });
      },
    });

    expect(result.exitCode).toBe(0);
    expect(requested).toEqual([{ pathname: '/v1/adapters/override', body: { command: 'github/whoami' } }]);
    expect(stdout.text()).toContain('Override created for github/whoami');
    expect(stdout.text()).toContain('package_1');
    expect(stdout.text()).toContain('adapter source put github/whoami');
  });

  it('rejects an unsafe hosted adapter override command key before any request', async () => {
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}'));
    const result = await runHostedCli(['adapter', 'override', '../escape'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result.exitCode).not.toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects unsafe hosted adapter command keys and source provenance', async () => {
    const stdout = sink();
    const stderr = sink();
    const requested: string[] = [];
    const config = makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' });
    const unsafeManifest = { ...manifest, commands: [{ ...manifest.commands[0], adapterPackageId: 'pkg_github', sourceFile: '../escape.js' }] };
    const result = await runHostedCli(['adapter', 'path', '../outside'], { config, stdout: stdout.stream, stderr: stderr.stream });
    expect(result.exitCode).not.toBe(0);
    expect(stdout.text()).not.toContain('outside');
    const provenance = await runHostedCli(['adapter', 'source', 'get', 'github/whoami'], {
      config,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        requested.push(new URL(String(url)).pathname);
        return new Response(JSON.stringify({ ok: true, manifest: unsafeManifest }));
      },
    });
    expect(provenance.exitCode).not.toBe(0);
    expect(requested).toEqual(['/v1/manifest']);
  });

  it('writes hosted site and adapter help to stdout', async () => {
    const stdout = sink();
    const config = makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' });
    await expect(runHostedCli(['site', '--help'], { config, stdout: stdout.stream })).resolves.toMatchObject({ exitCode: 0 });
    await expect(runHostedCli(['adapter', 'source', '--help'], { config, stdout: stdout.stream })).resolves.toMatchObject({ exitCode: 0 });
    expect(stdout.text()).toContain('webcmd site <group> <verb> <site>');
    expect(stdout.text()).toContain('adapter source');
  });

  it('writes hosted adapter group help to stdout', async () => {
    const stdout = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());
    const result = await runHostedCli(['adapter', '--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toContain('Commands:\n  source');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('presents web fetch help from local metadata without dispatching it to Cloud', async () => {
    const stdout = sink();
    const fetchImpl = vi.fn<typeof fetch>(async () => manifestResponse());

    const result = await runHostedCli(['web', 'fetch', '--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl,
      enableServerWebFetch: true,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toContain('--url <value>');
    expect(stdout.text()).toContain('--timeout [value]');
    expect(stdout.text()).toContain('--max-chars [value]');
    expect(stdout.text()).toContain('--allow-private [value]');
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(['https://api.example.com/v1/manifest']);
  });

  const publicProfile = {
    id: 'profile_work',
    name: 'Work',
    workspace: 'ws_demo',
    default: false,
    status: 'available',
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    lastUsedAt: '2026-07-24T00:00:00.000Z',
  };

  it('searches hosted marketplace plugins without fetching the manifest', async () => {
    const requests: string[] = [];
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['plugin', 'search', 'mercury'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        requests.push(String(url));
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
            }],
            errors: [],
          },
        }));
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('mixed');
    expect(stdout.text()).toContain('mercury/reimbursement-plan');
    expect(requests).toEqual(['https://api.example.com/v1/marketplace/plugins?query=mercury']);
  });

  it('labels empty hosted plugin search JSON as catalog discovery, not web search', async () => {
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['plugin', 'search', 'tls fingerprint', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: { plugins: [], errors: [] },
      })),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    const payload = JSON.parse(stdout.text());
    expect(payload).toMatchObject({
      kind: 'plugin-catalog',
      query: 'tls fingerprint',
      total: 0,
      plugins: [],
      errors: [],
    });
    expect(payload.hint).toContain('not web pages');
    expect(payload.hint).toContain('webcmd web fetch --url "https://html.duckduckgo.com/html/?q=tls%20fingerprint"');
  });

  it('installs hosted marketplace plugins without fetching the manifest', async () => {
    const requests: string[] = [];
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['plugin', 'install', 'github:agentrhq/webcmd/acme'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        requests.push(String(url));
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

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toBe('✅ Plugin "acme" installed successfully. Commands are ready to use.\n');
    expect(requests).toEqual(['https://api.example.com/v1/marketplace/installations']);
  });

  it('rejects plugin install --all in hosted mode before a marketplace request', async () => {
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runHostedCli(['plugin', 'install', 'github:agentrhq/webcmd', '--all'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 78 });
    expect(yaml.load(stderr.text())).toMatchObject({
      error: {
        code: 'CONFIG',
        message: 'plugin install --all is not available in hosted mode.',
        help: expect.stringContaining('github:user/repo/<plugin>'),
        exitCode: 78,
      },
    });
    expect((yaml.load(stderr.text()) as { error: { help: string } }).error.help).toContain('local mode');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('renders Cloud local-only marketplace install guidance', async () => {
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['plugin', 'install', 'github:agentrhq/webcmd/local-only'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'MARKETPLACE_PLUGIN_LOCAL_ONLY',
          message: 'This plugin is only available in local mode.',
          help: 'Run `webcmd setup` and choose local mode to install this plugin.',
        },
      }), { status: 409 }),
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('MARKETPLACE_PLUGIN_LOCAL_ONLY');
    expect(stderr.text()).toContain('Run `webcmd setup` and choose local mode to install this plugin.');
  });

  it('renders a JSON error envelope on stderr when -f json is set', async () => {
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['profile', 'use', 'work', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(result).toEqual({ handled: true, exitCode: 78 });
    expect(stdout.text()).toBe('');
    expect(JSON.parse(stderr.text())).toMatchObject({
      ok: false,
      error: { code: 'CONFIG', message: 'webcmd profile use is not available in hosted mode.' },
    });
  });

  it.each(['catalog'])('rejects unsupported hosted plugin %s without an API call', async (subcommand) => {
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runHostedCli(['plugin', subcommand], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 78 });
    expect(stderr.text()).toContain(`webcmd plugin ${subcommand} is not available in hosted mode.`);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lists hosted installations as a table', async () => {
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['plugin', 'list'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: {
          installations: [{
            name: 'alpha', version: '0.1.0', installSource: 'github:agentrhq/webcmd/alpha',
            sourceCommit: 'a'.repeat(40), installedAt: '2026-08-07T00:00:00.000Z', updateAvailable: true,
          }],
        },
      })),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('alpha');
    expect(stdout.text()).toContain('0.1.0');
  });

  it('uninstalls a hosted plugin', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['plugin', 'uninstall', 'alpha'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? 'GET' });
        return new Response(JSON.stringify({ ok: true, result: { uninstalled: true } }));
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('alpha');
    expect(requests).toEqual([{ url: 'https://api.example.com/v1/marketplace/installations/alpha', method: 'DELETE' }]);
  });

  it('reports when update finds nothing newer', async () => {
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['plugin', 'update', 'alpha'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: { updated: false, name: 'alpha', version: '0.1.0' },
      })),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toMatch(/already|up to date/i);
  });

  it('reports a delisted plugin distinctly from an ordinary no-op update', async () => {
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['plugin', 'update', 'alpha'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        result: { updated: false, name: 'alpha', version: '0.1.0', delisted: true },
      })),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toMatch(/delisted/i);
    expect(stdout.text()).not.toMatch(/already|up to date/i);
  });

  it('updates all installed plugins with --all and keeps going after one failure', async () => {
    const stdout = sink();
    const stderr = sink();
    let calls = 0;
    const result = await runHostedCli(['plugin', 'update', '--all'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/installations')) {
          return new Response(JSON.stringify({
            ok: true,
            result: {
              installations: [
                { name: 'alpha', version: '0.1.0', installSource: 'a', sourceCommit: null, installedAt: 'x', updateAvailable: true },
                { name: 'beta', version: '0.1.0', installSource: 'b', sourceCommit: null, installedAt: 'x', updateAvailable: true },
              ],
            },
          }));
        }
        calls += 1;
        if (String(url).includes('/alpha/update')) {
          return new Response(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'gone' } }), { status: 404 });
        }
        return new Response(JSON.stringify({ ok: true, result: { updated: true, name: 'beta', version: '0.2.0' } }));
      },
    });

    expect(calls).toBe(2);
    expect(stdout.text()).toContain('beta');
    expect(stderr.text()).toContain('alpha');
    expect(result.exitCode).not.toBe(0);
  });

  it('scaffolds into the requested virtual directory without leaking a host path', async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();
    const outputs = createVirtualOutputSink();
    const result = await runHostedCli(['plugin', 'create', 'acme', '--dir', 'plugins/custom-acme',
      '--author-name', 'A', '--author-handle', 'a'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      files: createVirtualFileMap([]),
      outputs,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toContain('Plugin scaffold created');
    expect(stdout.text()).toContain('plugins/custom-acme');
    expect(stdout.text()).not.toContain(process.cwd());
    expect(stdout.text()).not.toContain('plugin install file://');
    expect(stdout.text()).toMatch(/pull request|contribute/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outputs.files()).toHaveLength(5);
    expect(outputs.files().map(file => file.path).sort()).toEqual([
      'plugins/custom-acme/webcmd-plugin.json',
      'plugins/custom-acme/package.json',
      'plugins/custom-acme/hello.ts',
      'plugins/custom-acme/greet.ts',
      'plugins/custom-acme/README.md',
    ].sort());
    expect(outputs.files().every(file => !path.isAbsolute(file.path) && !file.path.includes(process.cwd()))).toBe(true);
    const readme = outputs.files().find(file => file.path.endsWith('/README.md'));
    expect(new TextDecoder().decode(readme?.content)).toContain('file://plugins/custom-acme');
    expect(new TextDecoder().decode(readme?.content)).not.toContain(process.cwd());
  });

  it('rejects a non-empty requested virtual scaffold directory', async () => {
    const outputs = createVirtualOutputSink();
    const stderr = sink();
    const result = await runHostedCli(['plugin', 'create', 'acme', '--dir', 'plugins/custom-acme',
      '--author-name', 'A', '--author-handle', 'a'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      files: createVirtualFileMap([{ path: 'plugins/custom-acme/existing.txt', content: new Uint8Array([1]) }]),
      outputs,
    });

    expect(result.exitCode).not.toBe(0);
    expect(stderr.text()).toContain('not empty');
    expect(outputs.files()).toEqual([]);
  });

  it('shows hosted plugin search and install help without an API call', async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runHostedCli(['plugin', '--help'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('search');
    expect(stdout.text()).toContain('install');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['plugin search'],
    ['profile list'],
    ['list'],
    ['session create Work-Project'],
    ['session list'],
    ['session close session_abc'],
  ])('rejects an unknown hosted %s format without an API call', async (argvCommand) => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();
    const argv = argvCommand === 'list'
      ? ['list', '-f', 'xml']
      : [...argvCommand.split(' '), '-f', 'xml'];
    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(stderr.text()).toContain('error: Unknown output format "xml"');
    expect(stdout.text()).toBe('');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a missing hosted Session create name as a structural usage error without an API call', async () => {
    const stdout = sink();
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await runHostedCli(['session', 'create'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain("error: missing required argument 'name'");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards the raw hosted Session create name and Profile to the client', async () => {
    const stdout = sink();
    const createdSession = {
      id: 'session_work', kind: 'explicit', profileId: 'profile_work', runtimeState: 'idle', handoff: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z', lastUsedAt: '2026-01-01T00:02:00.000Z',
      liveViewUrl: 'https://api.example.com/account/live/session_work',
    } as const;
    const createBrowserSession = vi.spyOn(HostedClient.prototype, 'createBrowserSession').mockResolvedValue({ ok: true, session: createdSession });
    try {
      const result = await runHostedCli(['--profile', 'work', 'session', 'create', 'Work Project'], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
          ? manifestResponse()
          : new Response(JSON.stringify({ ok: false, error: { code: 'UNEXPECTED', message: String(url), exitCode: 1 } })),
      });

      expect(result).toEqual({ handled: true, exitCode: 0 });
      expect(createBrowserSession).toHaveBeenCalledExactlyOnceWith('Work Project', 'work');
    } finally {
      createBrowserSession.mockRestore();
    }
  });

  it('normalizes hosted list output format aliases and case', async () => {
    const stdout = sink();
    const stderr = sink();
    const result = await runHostedCli(['list', '-f', 'JSON'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async () => manifestResponse(),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toEqual(expect.arrayContaining([expect.objectContaining({ command: 'github/whoami' })]));
  });

  it('lists and deletes hosted profiles without fetching the manifest', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const request = {
        url: String(url),
        method: init?.method ?? 'GET',
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      };
      requests.push(request);
      if (request.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true, deleted: true }));
      }
      return new Response(JSON.stringify({ ok: true, profiles: [publicProfile] }));
    });

    for (const argv of [
      ['profile', 'list', '-f', 'json'],
      ['profile', 'delete', 'profile_work', '-f', 'json'],
    ]) {
      const stdout = sink();
      const stderr = sink();
      const result = await runHostedCli(argv, {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        stderr: stderr.stream,
        fetchImpl,
      });
      expect(result).toEqual({ handled: true, exitCode: 0 });
      expect(stderr.text()).toBe('');
      expect(stdout.text()).toContain(argv[1] === 'delete' ? '"deleted": true' : '"id": "profile_work"');
    }

    expect(requests).toEqual([
      { url: 'https://api.example.com/v1/profiles', method: 'GET' },
      { url: 'https://api.example.com/v1/profiles/profile_work', method: 'DELETE' },
    ]);
    expect(requests.some(request => request.url.endsWith('/v1/manifest'))).toBe(false);
  });

  it('preflights the hosted contract before managing browser Sessions', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const session = {
      id: 'session_abc', kind: 'explicit', profileId: 'profile_work', runtimeState: 'idle',
      handoff: { site: 'github', expiresAt: '2026-01-01T00:15:00.000Z' },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z', lastUsedAt: '2026-01-01T00:02:00.000Z',
    };
    const createdSession = { ...session, liveViewUrl: 'https://api.example.com/account/live/session_abc' };
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const request = {
        url: String(url), method: init?.method ?? 'GET',
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      };
      requests.push(request);
      if (request.url.endsWith('/v1/manifest')) return manifestResponse();
      if (request.method === 'POST' && request.url.endsWith('/v1/sessions')) return new Response(JSON.stringify({ ok: true, session: createdSession }));
      if (request.method === 'POST' && request.url.endsWith(`/v1/sessions/${session.id}/close?profile=work`)) {
        return new Response(JSON.stringify({ ok: true, closed: false, alreadyIdle: true, session: session.id }));
      }
      return new Response(JSON.stringify({ ok: true, sessions: [session] }));
    });

    const outputs: string[] = [];
    for (const argv of [
      ['--profile', 'work', 'session', 'create', 'Work Project', '-f', 'json'],
      ['--profile', 'work', 'session', 'list', '-f', 'json'],
      ['--profile', 'work', 'session', 'close', session.id, '--force', '-f', 'json'],
    ]) {
      const stdout = sink();
      const result = await runHostedCli(argv, {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        fetchImpl,
      });
      expect(result).toEqual({ handled: true, exitCode: 0 });
      expect(stdout.text()).toContain(session.id);
      outputs.push(stdout.text());
    }
    expect(outputs[0]).toContain('"runtimeState": "idle"');
    expect(outputs[0]).toContain('"liveViewUrl": "https://api.example.com/account/live/session_abc"');
    expect(outputs[1]).toContain('"handoff": "github until 2026-01-01T00:15:00.000Z"');
    expect(outputs[0]).not.toContain('"profileId"');

    expect(requests).toEqual([
      { url: 'https://api.example.com/v1/manifest', method: 'GET' },
      { url: 'https://api.example.com/v1/sessions', method: 'POST', body: { name: 'Work Project', profile: 'work' } },
      { url: 'https://api.example.com/v1/manifest', method: 'GET' },
      { url: 'https://api.example.com/v1/sessions?profile=work&limit=20', method: 'GET' },
      { url: 'https://api.example.com/v1/manifest', method: 'GET' },
      { url: 'https://api.example.com/v1/sessions/session_abc/close?profile=work', method: 'POST', body: { force: true } },
    ]);
  });

  it('normalizes aliases and case across hosted Session create/list/close', async () => {
    const session = {
      id: 'session_abc', kind: 'explicit', profileId: 'profile_work', runtimeState: 'idle',
      handoff: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z', lastUsedAt: '2026-01-01T00:02:00.000Z',
    };
    const createdSession = { ...session, liveViewUrl: 'https://api.example.com/account/live/session_abc' };
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/v1/manifest')) return manifestResponse();
      if (init?.method === 'POST' && requestUrl.endsWith('/v1/sessions')) {
        return new Response(JSON.stringify({ ok: true, session: createdSession }));
      }
      if (requestUrl.includes('/close')) {
        return new Response(JSON.stringify({ ok: true, closed: true, alreadyIdle: false, session: session.id }));
      }
      return new Response(JSON.stringify({ ok: true, sessions: [session] }));
    });

    const create = sink();
    await runHostedCli(['session', 'create', 'Work Project', '-f', 'JSON'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }), stdout: create.stream, fetchImpl,
    });
    expect(JSON.parse(create.text())).toMatchObject({ id: session.id });

    const list = sink();
    await runHostedCli(['session', 'list', '-f', 'YML'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }), stdout: list.stream, fetchImpl,
    });
    expect(list.text()).toContain(`id: ${session.id}`);

    const close = sink();
    await runHostedCli(['session', 'close', session.id, '-f', 'Markdown'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }), stdout: close.stream, fetchImpl,
    });
    expect(close.text()).toContain('| ok | closed | alreadyIdle | session |');
    expect(close.text()).toContain(`| true | true | false | ${session.id} |`);
  });

  it.each(['JSON', 'YML'])('keeps an empty hosted Session list machine-readable with explicit %s', async (format) => {
    const stdout = sink();
    await runHostedCli(['session', 'list', '-f', format], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : new Response(JSON.stringify({ ok: true, sessions: [] })),
    });

    expect(format === 'JSON' ? JSON.parse(stdout.text()) : yaml.load(stdout.text())).toEqual([]);
  });

  it('keeps an explicit empty hosted Session table outside a TTY', async () => {
    const stdout = sink(false);
    await runHostedCli(['session', 'list', '-f', 'table'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : new Response(JSON.stringify({ ok: true, sessions: [] })),
    });

    expect(stdout.text()).toBe('(no data)\n');
  });

  it('rejects Session lifecycle calls when the hosted Session protocol differs', async () => {
    const stderr = sink();
    const result = await runHostedCli(['session', 'list', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        manifest: { ...manifest, metadata: { ...manifest.metadata, sessionProtocolVersion: 99 } },
      }), { status: 200 }),
    });

    expect(result.exitCode).toBe(78);
    expect(stderr.text()).toMatch(/HOSTED_CONTRACT_MISMATCH/);
  });

  it('forwards hosted session list limit to Cloud', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const stdout = sink();
    const result = await runHostedCli(['session', 'list', '--limit', '50', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? 'GET' });
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        return new Response(JSON.stringify({ ok: true, sessions: [] }));
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests).toContainEqual({
      url: 'https://api.example.com/v1/sessions?limit=50',
      method: 'GET',
    });
  });

  it('rejects the removed profile get subcommand', async () => {
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runHostedCli(['profile', 'get', 'Work'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result.handled).toBe(true);
    expect(stderr.text()).toMatch(/unknown command|not supported|not available/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('threads the ambient workspace onto hosted profile requests', async () => {
    const cases: Array<{ name: string; argv: string[]; env: NodeJS.ProcessEnv; expected: string }> = [
      { name: 'from WEBCMD_WORKSPACE env', argv: ['profile', 'list', '-f', 'json'], env: { WEBCMD_WORKSPACE: 'ws1' }, expected: 'ws1' },
      { name: 'from --workspace flag', argv: ['--workspace', 'ws2', 'profile', 'list', '-f', 'json'], env: {}, expected: 'ws2' },
    ];

    for (const testCase of cases) {
      let capturedHeader: string | null = null;
      const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
        capturedHeader = new Headers(init?.headers).get('x-webcmd-workspace');
        return new Response(JSON.stringify({ ok: true, profiles: [publicProfile] }));
      });
      const stdout = sink();
      const stderr = sink();
      const result = await runHostedCli(testCase.argv, {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        stderr: stderr.stream,
        fetchImpl,
        env: testCase.env,
      });

      expect(result).toEqual({ handled: true, exitCode: 0 });
      expect(stderr.text()).toBe('');
      expect(capturedHeader).toBe(testCase.expected);
    }
  });

  it('rejects local-only profile use in hosted mode without an API call', async () => {
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runHostedCli(['profile', 'use', 'value'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result).toEqual({ handled: true, exitCode: 78 });
    expect(stderr.text()).toContain('webcmd profile use is not available in hosted mode.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['list', 'rename', 'use'])('leaves profile %s to the existing local command surface', async (command) => {
    const result = await runHostedCli(['profile', command, 'value'], {
      config: makeLocalConfig(),
    });

    expect(result).toEqual({ handled: false, exitCode: 0 });
  });

  it.each([
    ['missing-site'],
    ['missing-site', 'child'],
    ['missing-site', 'child', 'grandchild'],
    ['missing-site', '--format', 'json'],
    ['missing-site', '--trace=on'],
  ])('guides an unknown site without searching, installing, or retrying when argv is %j', async (...argv) => {
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
    expect(stderr.text()).toContain([
      'Site "missing-site" is not installed.',
      'Search: webcmd plugin search missing-site',
      'Install using the installSource returned by search.',
    ].join('\n'));
    // Error path: nothing on stdout, so a caller parsing stdout cannot mistake
    // the root help for a successful response.
    expect(stdout.text()).toBe('');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/\/v1\/manifest$/);
    expect(fetchImpl.mock.calls.some(([url]) => /plugin|execute/.test(String(url)))).toBe(false);
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

    // Usage error: exit 2, one line plus the valid subcommands.
    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(stderr.text()).toBe([
      "error: unknown command 'missing-command'",
      'help: valid subcommands for `webcmd github`: whoami',
      '',
    ].join('\n'));
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

    // Usage error: exit 2, one line plus the usage restatement.
    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(stderr.text()).toBe([
      "error: missing required argument 'account'",
      'help: usage: webcmd github whoami [options] <account>',
      '',
    ].join('\n'));
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

    // Usage error: exit 2, one line plus the usage restatement.
    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(stderr.text()).toContain("error: missing required argument 'account'\nhelp: usage: webcmd github whoami");
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
      exitCode: 2,
      usage: true,
      stderr: "error: required option '--token <value>' not specified\n",
      help: false,
    },
    {
      name: 'required named option before invalid trace',
      tail: ['account', '--trace', 'always'],
      exitCode: 2,
      usage: true,
      stderr: "error: required option '--token <value>' not specified\n",
      help: false,
    },
    {
      name: 'required named option before invalid choice',
      tail: ['account', '--mode', 'bad'],
      exitCode: 2,
      usage: true,
      stderr: "error: required option '--token <value>' not specified\n",
      help: false,
    },
    {
      name: 'required positional before invalid format',
      tail: ['--token', 'secret', '-f', 'xml'],
      exitCode: 2,
      usage: true,
      stderr: "error: missing required argument 'account'\n",
      help: false,
    },
    {
      name: 'ordinary unknown option',
      tail: ['account', '--token', 'secret', '--unknown'],
      exitCode: 2,
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
      exitCode: 2,
      usage: true,
      stderr: "error: too many arguments for 'whoami'. Expected 1 argument but got 2.\n",
      help: false,
    },
  ])('matches public Commander structural bytes and discovery order: $name', async ({ name, tail, exitCode, stderr: expectedStderr, help, usage }) => {
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
    if (help) {
      expect(stderr.text()).toBe(expectedStderr);
    } else if (name === 'ordinary unknown option') {
      expect(stderr.text().startsWith(expectedStderr)).toBe(true);
      expect(stderr.text()).toContain('help: valid flags for');
    } else if (usage) {
      // Usage error: the Commander line, a `help:` line, and no UNKNOWN envelope.
      expect(stderr.text().startsWith(expectedStderr)).toBe(true);
      expect(stderr.text()).toContain('help: usage: webcmd github whoami');
      expect(stderr.text()).not.toContain('ok: false');
    } else {
      expect(stderr.text()).toContain(`${expectedStderr}ok: false\nerror:\n  code: UNKNOWN\n`);
    }
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
    if (calls === 1) {
      expect(stderr.text()).toContain("error: option '--profile <name>' argument missing\nok: false\nerror:\n  code: UNKNOWN\n");
    } else {
      expect(stderr.text()).toBe("error: option '--profile <name>' argument missing\n");
    }
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

    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(stderr.text().startsWith("error: unknown option '--profile'\n")).toBe(true);
    expect(stderr.text()).toContain('help: valid flags for');
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

    expect(result).toEqual({ handled: true, exitCode: 2 });
    expect(stderr.text().startsWith("error: unknown option '-dash'\n")).toBe(true);
    expect(stderr.text()).toContain('help: valid flags for');
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

  it('writes unknown-site guidance to stderr only', async () => {
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
    expect(order).toEqual(['stderr']);
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

  it('filters hosted structured list rows by an exact case-insensitive tag', async () => {
    const stdout = sink();

    const result = await runHostedCli(['list', '--tag', 'SEARCH', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      fetchImpl: async () => manifestResponse(),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(JSON.parse(stdout.text())).toEqual([expect.objectContaining({
      command: 'github/whoami',
      tags: ['search'],
      keywords: ['identity'],
    })]);
  });

  it('prepares browser-capable hosted commands before running them', async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const stdout = sink();
    const stderr = sink();

    const result = await runHostedCli(['--session', 'session_a', 'github', 'whoami', '-f', 'json'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
        });
        if (String(url).endsWith('/v1/manifest')) {
          return browserManifestResponse();
        }
        if (String(url).endsWith('/v1/executions')) {
          return new Response(JSON.stringify({
            ok: true,
            execution: { id: 'exec_success', command: 'github/whoami', status: 'queued' },
            fileArguments: [],
            liveViewUrl: 'https://api.example.com/account/live/exec_success',
          }));
        }
        return executionResponse({ result: [{ username: 'octocat' }], columns: ['username'] });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests.at(-1)).toEqual({
      url: 'https://api.example.com/v1/executions/exec_success/run',
      body: {
        command: 'github/whoami',
        args: {},
        format: 'json',
        trace: 'off',
        session: 'session_a',
      },
    });
    expect(stdout.text()).toBe('[\n  {\n    "username": "octocat"\n  }\n]\n');
    expect(stderr.text()).toBe('Webcmd live view: https://api.example.com/account/live/exec_success\n');
  });

  it.each(['table', 'plain', 'json', 'yaml', 'md', 'csv'])('preserves %s stdout bytes when a browser live view is present', async (format) => {
    const run = async (withViewer: boolean) => {
      const stdout = sink(true);
      const stderr = sink();
      await runHostedCli(['github', 'whoami', '-f', format], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        stderr: stderr.stream,
        fetchImpl: async (url) => {
          const pathname = new URL(String(url)).pathname;
          if (pathname === '/v1/manifest') return browserManifestResponse();
          if (pathname === '/v1/executions') return new Response(JSON.stringify({
            ok: true,
            execution: { id: 'exec_format', command: 'github/whoami', status: 'queued' },
            fileArguments: [],
            ...(withViewer ? { liveViewUrl: 'https://api.example.com/account/live/exec_format' } : {}),
          }));
          return executionResponse({ result: [{ username: 'octocat' }], columns: ['username'] });
        },
      });
      return { stdout: stdout.text(), stderr: stderr.text() };
    };

    const withoutViewer = await run(false);
    const withViewer = await run(true);
    expect(withViewer.stdout).toBe(withoutViewer.stdout);
    expect(withViewer.stderr).toBe('Webcmd live view: https://api.example.com/account/live/exec_format\n');
  });

  it('prints a stable live view once for each browser command in the same session', async () => {
    const stderr = sink();
    let prepared = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname === '/v1/manifest') return browserManifestResponse();
      if (pathname === '/v1/executions') {
        prepared += 1;
        return new Response(JSON.stringify({
          ok: true,
          execution: { id: `exec_${prepared}`, command: 'github/whoami', status: 'queued' },
          fileArguments: [],
          liveViewUrl: 'https://api.example.com/account/live/session_a',
        }));
      }
      return executionResponse({ result: [], columns: ['username'] });
    };
    const options = {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: stderr.stream,
      fetchImpl,
    };

    await runHostedCli(['--session', 'session_a', 'github', 'whoami'], options);
    await runHostedCli(['--session', 'session_a', 'github', 'whoami'], options);

    expect(stderr.text()).toBe([
      'Webcmd live view: https://api.example.com/account/live/session_a',
      'Webcmd live view: https://api.example.com/account/live/session_a',
      '',
    ].join('\n'));
  });

  // Hosted dispatch parsed -v and then dropped it, so the flag local mode honours
  // was a silent no-op in hosted mode (#174).
  describe('hosted verbose mode', () => {
    let written: string[] = [];

    function runWhoami(argv: string[]) {
      return runHostedCli(argv, {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'hosted-secret-key' }),
        stdout: sink().stream,
        fetchImpl: async (url) => (String(url).endsWith('/v1/manifest')
          ? manifestResponse()
          : executionResponse({ result: [{ username: 'octocat' }], columns: ['username'] })),
      });
    }

    beforeEach(() => {
      delete process.env.WEBCMD_VERBOSE;
      written = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      });
    });

    afterEach(() => {
      delete process.env.WEBCMD_VERBOSE;
      vi.restoreAllMocks();
    });

    it('turns on verbose mode and emits request diagnostics for -v', async () => {
      await expect(runWhoami(['github', 'whoami', '-f', 'json', '-v'])).resolves.toMatchObject({ exitCode: 0 });

      expect(process.env.WEBCMD_VERBOSE).toBe('1');
      const output = written.join('');
      expect(output).toContain('hosted → POST /v1/execute');
      expect(output).toMatch(/hosted ← POST \/v1\/execute 200 \(\d+ms\)/);
      expect(output).not.toContain('hosted-secret-key');
    });

    it('emits no diagnostics without -v', async () => {
      await expect(runWhoami(['github', 'whoami', '-f', 'json'])).resolves.toMatchObject({ exitCode: 0 });

      expect(process.env.WEBCMD_VERBOSE).toBeUndefined();
      expect(written.join('')).not.toContain('hosted →');
    });

    // The wire body is a server contract; -v is a local concern and must not
    // start appearing as an unknown field in execute requests.
    it('keeps verbose out of the /v1/execute request body', async () => {
      const bodies: unknown[] = [];
      await runHostedCli(['github', 'whoami', '-f', 'json', '-v'], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: sink().stream,
        fetchImpl: async (url, init) => {
          if (init?.body) bodies.push(JSON.parse(String(init.body)) as unknown);
          return String(url).endsWith('/v1/manifest')
            ? manifestResponse()
            : executionResponse({ result: [{ username: 'octocat' }], columns: ['username'] });
        },
      });

      expect(bodies.at(-1)).toEqual({
        command: 'github/whoami',
        args: {},
        format: 'json',
        trace: 'off',
      });
    });
  });

  it('uploads local file args, runs a prepared execution, and materializes hosted output artifacts', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    try {
      const sourcePath = path.join(tempDir, 'source.txt');
      const outputDir = path.join(tempDir, 'downloads');
      await writeFile(sourcePath, 'input bytes');
      const requests: Array<{ method: string; pathname: string; body?: unknown; filename?: string | null; contentType?: string | null }> = [];
      const stdout = sink();
      const stderr = sink();

      const result = await runHostedCli(['files', 'copy', '--source', sourcePath, '--output', outputDir, '-f', 'json'], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        stderr: stderr.stream,
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
              liveViewUrl: 'https://api.example.com/account/live/exec_files',
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
      expect(stderr.text()).toBe('Webcmd live view: https://api.example.com/account/live/exec_files\n');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('prepares execution for an implicit mutable file default', async () => {
    const requests: Array<{ pathname: string; body?: unknown }> = [];
    const commandWithOnlyFileDefault = {
      ...manifest,
      commands: [{
        site: 'likes', name: 'list', command: 'likes/list', description: 'List likes',
        access: 'read', strategy: 'PUBLIC', browser: false, columns: [], args: [{
          name: 'resume', file: {
            direction: 'input-output', pathKind: 'file', multiple: false, defaultPath: 'likes.resume.json',
          },
        }],
      }],
    };
    const result = await runHostedCli(['likes', 'list'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      fetchImpl: async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        requests.push({ pathname, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (pathname === '/v1/manifest') return new Response(JSON.stringify({ ok: true, manifest: commandWithOnlyFileDefault }));
        if (pathname === '/v1/executions') return new Response(JSON.stringify({
          ok: true, execution: { id: 'exec_likes', command: 'likes/list', status: 'queued' }, fileArguments: [],
        }));
        return new Response(JSON.stringify({
          ok: true, result: [], execution: { id: 'exec_likes', command: 'likes/list', status: 'succeeded' },
        }));
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests.map(request => request.pathname)).toEqual(['/v1/manifest', '/v1/executions', '/v1/executions/exec_likes/run']);
    expect(requests[1]?.body).toEqual({ command: 'likes/list' });
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
      name: 'escaped Markdown cells',
      result: [{ username: 'a|b\nline 2' }],
      argv: ['-f', 'md'],
      expected: '| username |\n| --- |\n| a\\|b\nline 2 |\n',
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

  it.each(['success', 'failure'])('rejects a raw provider trace URL before $phase output or attachment', async (phase) => {
    const rawUrl = 'https://provider.example/session/private?token=provider-secret-token';
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
    expect(`${stdout.text()}\n${stderr.text()}`).not.toContain('provider-secret-token');
  });

  it('accepts a manifest patch bump on the same hosted compatibility line', async () => {
    const requests: string[] = [];
    const stdout = sink();
    const patchBumped = {
      ...manifest,
      metadata: { ...manifest.metadata, webcmdPackageVersion: compatiblePatchVersion },
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
      metadata: { ...manifest.metadata, webcmdPackageVersion: incompatibleMinorVersion },
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
    expect(stderr.text()).toMatch(/HOSTED_CONTRACT_MISMATCH|hosted contract/i);
    expect(requests).toEqual(['https://api.example.com/v1/manifest']);
  });

  it('rejects a manifest whose Session protocol differs before execution', async () => {
    const stderr = sink();
    const mismatched = {
      ...manifest,
      metadata: { ...manifest.metadata, sessionProtocolVersion: 99 },
    };
    const result = await runHostedCli(['github', 'whoami'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, manifest: mismatched }), { status: 200 }),
    });

    expect(result.exitCode).toBe(78);
    expect(stderr.text()).toMatch(/HOSTED_CONTRACT_MISMATCH/);
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

  it('matches the exact local text help for every raw-session browser leaf without a cloud call', async () => {
    const program = createProgram('', '');
    const browser = program.commands.find(command => command.name() === 'browser');
    if (!browser) throw new Error('Local browser namespace is missing');

    for (const contract of browserCommandCatalog.filter(command => command.command !== 'init' && command.command !== 'verify')) {
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

      const result = await runHostedCli(['--session', 'work-k7', 'browser', ...parts, '--help'], {
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

  it('dispatches every catalogued hosted browser command to the cloud command endpoint', async () => {
    const uploadDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-browser-upload-'));
    const uploadFile = path.join(uploadDir, 'sample-upload.txt');
    await writeFile(uploadFile, 'hello browser upload');
    try {
      for (const contract of browserCommandCatalog.filter(command => (
        command.sessionPolicy !== 'local-only' && command.sessionPolicy !== 'sessionless'
      ))) {
        const requests: Array<{ pathname: string; body?: Record<string, unknown> }> = [];
        const positionals = sampleBrowserPositionals(contract);
        const options = contract.command === 'bind'
          ? ['--page', 'page-123']
          : contract.command === 'run'
            ? ['--file', uploadFile]
            : [];
        const result = await runHostedCli(['--session', 'work-k7', 'browser', ...contract.command.split('/'), ...positionals, ...options], {
          config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
          stdout: sink().stream,
          stderr: sink().stream,
          fetchImpl: async (url, init) => {
            const parsedUrl = new URL(String(url));
            const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
            requests.push({ pathname: parsedUrl.pathname, ...(body ? { body } : {}) });
            if (parsedUrl.pathname === '/v1/manifest') return manifestResponse();
            if (parsedUrl.pathname === '/v1/browser/work-k7/commands') {
              return new Response(JSON.stringify({
                ok: true,
                result: {},
                columns: [],
                trace: null,
                run: {
                  executionId: `exec_${contract.command.replaceAll('/', '_')}`,
                  session: 'work-k7',
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
          action: requests.find(request => request.pathname === '/v1/browser/work-k7/commands')?.body,
        }).toMatchObject({
          command: contract.command,
          action: { command: `browser/${contract.command}`, action: contract.action },
        });
      }
    } finally {
      await rm(uploadDir, { recursive: true, force: true });
    }
  });

  it('dispatches hosted browser verify with its local verification options', async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const result = await runHostedCli([
      'browser', 'verify', 'hn/top',
      '--no-fixture', '--write-fixture', '--update-fixture', '--strict-memory',
      '--seed-args', '{"limit":3}', '--trace', 'retain-on-failure', '--max-top-level-keys', '20',
    ], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        requests.push({ url: String(url), ...(body ? { body } : {}) });
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        return new Response(JSON.stringify({
          ok: true,
          result: {},
          columns: [],
          trace: null,
          run: { executionId: 'exec_browser_verify', profile: { id: 'profile_default', displayName: 'default' } },
          execution: { id: 'exec_browser_verify', status: 'succeeded' },
        }), { status: 200 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests[1]?.body).toMatchObject({
      command: 'browser/verify',
      action: 'verify',
      args: {
        name: 'hn/top',
        noFixture: true,
        writeFixture: true,
        updateFixture: true,
        strictMemory: true,
        seedArgs: '{"limit":3}',
        trace: 'retain-on-failure',
        maxTopLevelKeys: 20,
      },
    });
  });

  it('dispatches hosted browser verify with a numeric default maxTopLevelKeys', async () => {
    const requests: Array<{ body?: Record<string, unknown> }> = [];
    const result = await runHostedCli(['browser', 'verify', 'hn/top'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        if (!String(url).endsWith('/v1/manifest')) requests.push({ ...(body ? { body } : {}) });
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        return new Response(JSON.stringify({
          ok: true,
          result: {},
          columns: [],
          trace: null,
          run: { executionId: 'exec_browser_verify', profile: { id: 'profile_default', displayName: 'default' } },
          execution: { id: 'exec_browser_verify', status: 'succeeded' },
        }), { status: 200 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests[0]?.body).toMatchObject({ args: { name: 'hn/top', maxTopLevelKeys: 12 } });
  });

  it('sends browser-run file contents and snapshot-diff options to Cloud instead of the local path', async () => {
    const sourceDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-run-source-'));
    const sourcePath = path.join(sourceDir, 'program.js');
    await writeFile(sourcePath, 'return 42;');
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    try {
      const result = await runHostedCli(['--session', 'work-k7', 'browser', 'run', '--file', sourcePath, '--snapshot-mode', 'tree', '--no-snapshot-diff'], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: sink().stream,
        stderr: sink().stream,
        fetchImpl: async (url, init) => {
          const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
          requests.push({ url: String(url), ...(body ? { body } : {}) });
          if (String(url).endsWith('/v1/manifest')) return manifestResponse();
          return new Response(JSON.stringify({
            ok: true,
            result: {},
            columns: [],
            trace: null,
            run: { executionId: 'exec_browser_run', session: 'work-k7', profile: { id: 'profile_default', displayName: 'default' } },
            execution: { id: 'exec_browser_run', status: 'succeeded' },
          }), { status: 200 });
        },
      });

      expect(result).toEqual({ handled: true, exitCode: 0 });
      expect(requests[1]?.body).toMatchObject({
        command: 'browser/run',
        action: 'run',
        args: { source: 'return 42;', snapshotMode: 'tree', noSnapshotDiff: true },
      });
      expect(JSON.stringify(requests[1]?.body)).not.toContain(sourcePath);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it('forwards browser snapshot mode to hosted browser actions', async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const result = await runHostedCli(['--session', 'work-k7', 'browser', 'snapshot', '--snapshot-mode', 'read', '--ref', 'l7', '--max-output', '1000'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        requests.push({ url: String(url), ...(body ? { body } : {}) });
        if (String(url).endsWith('/v1/manifest')) return manifestResponse();
        return new Response(JSON.stringify({
          ok: true,
          run: { executionId: 'exec_browser_snapshot', session: 'work-k7', profile: { id: 'profile_default', displayName: 'default' } },
          result: { ok: true, tree: '<page />', page: { url: 'https://example.test', title: 'Example' }, warnings: [], limits: { snapshotTruncated: false } },
        }), { status: 200 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests[1]?.body).toMatchObject({
      action: 'snapshot',
      args: { snapshotMode: 'read', ref: 'l7', maxOutput: 1000 },
    });
  });

  it('prints hosted snapshot trees', async () => {
    const stdout = sink();
    const result = await runHostedCli(['--session', 'work-k7', 'browser', 'snapshot'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: stdout.stream,
      stderr: sink().stream,
      fetchImpl: async (url) => String(url).endsWith('/v1/manifest')
        ? manifestResponse()
        : new Response(JSON.stringify({
            ok: true,
            run: { executionId: 'exec_browser_snapshot', session: 'work-k7', profile: { id: 'profile_default', displayName: 'default' } },
            result: { ok: true, tree: '<page />', page: { url: 'https://example.test', title: 'Example' }, warnings: [], limits: { snapshotTruncated: false } },
          }), { status: 200 }),
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(stdout.text()).toBe('<page />\n');
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

  it('rejects retired positional hosted browser sessions', async () => {
    const stderr = sink();
    const result = await runHostedCli(['browser', 'work', 'state'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
    });

    expect(result.exitCode).toBe(2);
    expect(stderr.text()).toMatch(/Browser sessions are root selectors/i);
  });

  it.each(['init', 'verify'] as const)('sends hosted browser %s without a Session to the authoring route', async (leaf) => {
    const requests: Array<{ pathname: string; body?: Record<string, unknown> }> = [];
    const result = await runHostedCli(['browser', leaf, 'quotes/list'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url, init) => {
        const parsedUrl = new URL(String(url));
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        requests.push({ pathname: parsedUrl.pathname, ...(body ? { body } : {}) });
        if (parsedUrl.pathname === '/v1/manifest') return manifestResponse();
        if (parsedUrl.pathname === '/v1/browser/authoring/commands') {
          return new Response(JSON.stringify({
            ok: true,
            result: {},
            columns: [],
            trace: null,
            run: {
              executionId: `exec_browser_${leaf}`,
              profile: { id: 'profile_default', displayName: 'default' },
            },
            execution: { id: `exec_browser_${leaf}`, status: 'succeeded' },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          ok: false,
          error: { code: 'UNEXPECTED', message: parsedUrl.pathname, exitCode: 1 },
        }), { status: 500 });
      },
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(requests.map(request => request.pathname)).toEqual(['/v1/manifest', '/v1/browser/authoring/commands']);
    expect(requests[1]?.body).toMatchObject({
      command: `browser/${leaf}`,
      action: leaf,
      args: { name: 'quotes/list' },
    });
    expect(JSON.stringify(requests[1]?.body)).not.toMatch(/session/i);
  });

  it('rejects --session on sessionless init', async () => {
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runHostedCli(['--session', 'session_work', 'browser', 'init', 'quotes/list'], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl,
    });
    expect(result.exitCode).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stderr.text()).toContain('SESSION_NOT_ALLOWED');
  });

  it.each([
    { argv: ['browser', 'tabs'], code: 'SESSION_REQUIRED' },
    { argv: ['browser', 'snapshot'], code: 'SESSION_REQUIRED' },
    { argv: ['browser', 'close'], code: 'SESSION_REQUIRED' },
    { argv: ['browser', 'bind', '--page', 'page-123'], code: 'SESSION_REQUIRED' },
    { argv: ['--session', 'work', 'browser', 'tabs'], code: 'INVALID_SESSION_SELECTOR' },
  ])('rejects an unusable raw selector before hosted transport: $code', async ({ argv, code }) => {
    const stderr = sink();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await runHostedCli(argv, {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stderr: stderr.stream,
      fetchImpl,
    });

    expect(result.exitCode).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stderr.text()).toContain(code);
  });
});

describe('runHostedCli injected I/O', () => {
  const hostedConfig = {
    mode: 'hosted' as const,
    updatedAt: new Date(0).toISOString(),
    hosted: { apiBaseUrl: 'https://api.example.test', apiKey: 'token' },
  };

  it('does not read process.env when env is injected', async () => {
    const previous = process.env.WEBCMD_WORKSPACE;
    process.env.WEBCMD_WORKSPACE = 'leaked-workspace';
    try {
      const seenHeaders: Record<string, string>[] = [];
      const stdout = createCaptureStream(64 * 1024);
      await runHostedCli(['list'], {
        config: hostedConfig,
        env: {},
        homeDir: '/nonexistent',
        stdout: stdout.stream,
        stderr: createCaptureStream(64 * 1024).stream,
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          seenHeaders.push(init?.headers as Record<string, string>);
          return new Response(
            JSON.stringify({ userId: 'u1', metadata: { contractSchemaVersion: 1, sessionProtocolVersion: 1, webcmdPackageVersion: '0.7.4', generatedAt: new Date(0).toISOString() }, commands: [] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }) as unknown as typeof fetch,
      });
      expect(seenHeaders[0]?.['x-webcmd-workspace']).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.WEBCMD_WORKSPACE;
      else process.env.WEBCMD_WORKSPACE = previous;
    }
  });

  it('aborts an in-flight invocation when the signal fires', async () => {
    const controller = new AbortController();
    const stderr = createCaptureStream(64 * 1024);
    let fetchStartedResolve!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { fetchStartedResolve = resolve; });
    let receivedSignal: AbortSignal | undefined;
    const run = runHostedCli(['list'], {
      config: hostedConfig,
      env: {},
      homeDir: '/nonexistent',
      signal: controller.signal,
      stdout: createCaptureStream(64 * 1024).stream,
      stderr: stderr.stream,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          receivedSignal = init?.signal ?? undefined;
          fetchStartedResolve();
          receivedSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })) as unknown as typeof fetch,
    });
    await fetchStarted;
    expect(receivedSignal).toBe(controller.signal);
    controller.abort();
    const result = await run;
    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(130);
    expect(yaml.load(stderr.result().text)).toMatchObject({
      ok: false,
      error: { code: 'INTERRUPTED', exitCode: 130 },
    });
  });

  it('handles an already-aborted invocation before issuing a request', async () => {
    const controller = new AbortController();
    controller.abort();
    let fetchCalled = false;
    const stderr = createCaptureStream(64 * 1024);
    const result = await runHostedCli(['list'], {
      config: hostedConfig,
      env: {},
      homeDir: '/nonexistent',
      signal: controller.signal,
      stdout: createCaptureStream(64 * 1024).stream,
      stderr: stderr.stream,
      fetchImpl: (async () => {
        fetchCalled = true;
        return new Response();
      }) as typeof fetch,
    });

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(130);
    expect(fetchCalled).toBe(false);
    expect(yaml.load(stderr.result().text)).toMatchObject({
      ok: false,
      error: { code: 'INTERRUPTED', exitCode: 130 },
    });
  });

  it('does not misclassify an unrelated network failure as interruption', async () => {
    const controller = new AbortController();
    const stderr = createCaptureStream(64 * 1024);
    const result = await runHostedCli(['list'], {
      config: hostedConfig,
      env: {},
      homeDir: '/nonexistent',
      signal: controller.signal,
      stderr: stderr.stream,
      fetchImpl: (async () => { throw new Error('network unavailable'); }) as typeof fetch,
    });

    expect(result.exitCode).toBe(1);
    expect(yaml.load(stderr.result().text)).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN', exitCode: 1 },
    });
  });
});

describe('hosted artifact download', () => {
  it('rejects a foreign origin before sending a request', async () => {
    const requests: string[] = [];
    const stderr = sink();
    const result = await runHostedCli([
      'artifact', 'download',
      'https://evil.example/v1/executions/exec_1/artifacts/trace_a',
      '--output', '/tmp/out.bin',
    ], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: stderr.stream,
      fetchImpl: async (url) => {
        requests.push(String(url));
        return new Response('nope');
      },
    });

    expect(result.exitCode).not.toBe(0);
    expect(requests).toEqual([]);
  });

  it('rejects a malformed path before sending a request', async () => {
    const requests: string[] = [];
    const result = await runHostedCli([
      'artifact', 'download',
      'https://api.example.com/v1/artifacts/trace_a',
      '--output', '/tmp/out.bin',
    ], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url) => {
        requests.push(String(url));
        return new Response('nope');
      },
    });

    expect(result.exitCode).not.toBe(0);
    expect(requests).toEqual([]);
  });

  it('requires --output', async () => {
    const requests: string[] = [];
    const result = await runHostedCli([
      'artifact', 'download',
      'https://api.example.com/v1/executions/exec_1/artifacts/trace_a',
    ], {
      config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
      stdout: sink().stream,
      stderr: sink().stream,
      fetchImpl: async (url) => {
        requests.push(String(url));
        return new Response('nope');
      },
    });

    expect(result.exitCode).not.toBe(0);
    expect(requests).toEqual([]);
  });

  it('downloads bytes to --output and reports the local path', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'webcmd-artifact-dl-'));
    const output = path.join(dir, 'saved.csv');
    const stdout = sink();
    const requests: string[] = [];
    try {
      const result = await runHostedCli([
        'artifact', 'download',
        'https://api.example.com/v1/executions/exec_1/artifacts/trace_a',
        '--output', output,
      ], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        stderr: sink().stream,
        fetchImpl: async (url) => {
          requests.push(String(url));
          return new Response(Buffer.from('csv-bytes'), { status: 200 });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(requests).toEqual(['https://api.example.com/v1/executions/exec_1/artifacts/trace_a']);
      await expect(readFile(output, 'utf8')).resolves.toBe('csv-bytes');
      expect(stdout.text()).toContain(output);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('renders structured JSON when -f json is set', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'webcmd-artifact-dl-json-'));
    const output = path.join(dir, 'saved.csv');
    const stdout = sink();
    try {
      const result = await runHostedCli([
        'artifact', 'download',
        'https://api.example.com/v1/executions/exec_1/artifacts/trace_a',
        '--output', output,
        '-f', 'json',
      ], {
        config: makeHostedConfig({ apiBaseUrl: 'https://api.example.com', apiKey: 'key' }),
        stdout: stdout.stream,
        stderr: sink().stream,
        fetchImpl: async () => new Response(Buffer.from('csv-bytes'), { status: 200 }),
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(stdout.text())).toEqual({ output, bytes: 9 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
