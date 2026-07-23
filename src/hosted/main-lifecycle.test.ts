import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entrypoint = path.join(packageRoot, 'src/main.ts');
const largeOutput = 'hosted-lifecycle-chunk\n'.repeat(64 * 1024);
const traceReceipt = 'https://api.example.test/v1/traces/exec_lifecycle';
const tempRoots: string[] = [];
const servers: Server[] = [];

const command = {
  site: 'lifecycle',
  name: 'stream',
  command: 'lifecycle/stream',
  description: 'Exercise hosted process lifecycle',
  access: 'read',
  strategy: 'PUBLIC',
  browser: false,
  args: [],
  columns: ['value'],
  defaultFormat: 'plain',
};

const authCommand = {
  site: 'auth',
  name: 'status',
  command: 'auth/status',
  description: 'Show hosted login status',
  access: 'read',
  strategy: 'PUBLIC',
  browser: false,
  args: [],
  columns: ['value'],
  defaultFormat: 'plain',
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('hosted CLI process lifecycle', () => {
  it.each([
    { name: 'version', argv: ['--version'] },
    { name: 'shell completion', argv: ['completion', 'bash'] },
  ])('preserves the legacy immediate-exit behavior for a backpressured $name fast path', async ({ argv }) => {
    const fixture = await createHostedFixture('success');
    const preload = await createDelayedStdoutPreload(path.dirname(fixture.discoverySentinel));

    const result = await runCli(argv, fixture.env, [preload]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    await expect(readFile(fixture.discoverySentinel, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('flushes delayed output and trace bytes, returns success, and never enters local discovery', async () => {
    const fixture = await createHostedFixture('success');

    const result = await runCli(['lifecycle', 'stream', '-f', 'plain', '--trace', 'on'], fixture.env);

    expect(result.status).toBe(0);
    expect(createHash('sha256').update(result.stdout).digest('hex'))
      .toBe(createHash('sha256').update(`${largeOutput}\n`).digest('hex'));
    expect(result.stdout).toBe(`${largeOutput}\n`);
    expect(result.stderr).toBe(`Webcmd trace artifact: ${traceReceipt}\n`);
    await expect(readFile(fixture.discoverySentinel, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('flushes the typed error envelope and returns its public exit status without local discovery', async () => {
    const fixture = await createHostedFixture('failure');

    const result = await runCli(['lifecycle', 'stream', '-f', 'plain'], fixture.env);

    expect(result.status).toBe(69);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe([
      'ok: false',
      'error:',
      '  code: LIFECYCLE_FAILURE',
      '  message: The hosted lifecycle fixture failed.',
      '  help: Retry the lifecycle fixture.',
      '  exitCode: 69',
      '',
    ].join('\n'));
    await expect(readFile(fixture.discoverySentinel, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('keeps an unknown first site authoritative with trailing tokens and never enters local discovery', async () => {
    const fixture = await createHostedFixture('success');

    const result = await runCli(['missing-site', 'child', '--format', 'json'], fixture.env);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("error: unknown command 'missing-site'\n");
    expect(result.stdout).toContain('Local-only commands:');
    await expect(readFile(fixture.discoverySentinel, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('runs skills add locally without contacting Cloud when hosted mode is configured', async () => {
    const fixture = await createHostedFixture('success');
    const installDir = path.join(fixture.root, 'agent-skills');

    const result = await runCli(['skills', 'add', '--path', installDir, '--json'], fixture.env);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const body = JSON.parse(result.stdout) as {
      skills: Array<{ name: string; stableLink: string; destination?: string }>;
    };
    expect(body.skills.map(skill => skill.name)).toEqual([
      'smart-search',
      'webcmd-adapter-author',
      'webcmd-autofix',
      'webcmd-browser',
      'webcmd-browser-sitemap',
      'webcmd-sitemap-author',
      'webcmd-usage',
    ]);
    expect(body.skills.every(skill => skill.destination?.startsWith(installDir))).toBe(true);
    await expect(readFile(path.join(installDir, 'webcmd-usage', 'SKILL.md'), 'utf8'))
      .resolves.toContain('webcmd-usage');
    await expect(readFile(fixture.discoverySentinel, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fixture.requests).toEqual([]);
  }, 20_000);

  it('keeps hosted auth on Cloud without local discovery', async () => {
    const fixture = await createHostedFixture('success');

    const result = await runCli(['auth', 'status', '-f', 'plain'], fixture.env);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(fixture.requests).toEqual(['GET /v1/manifest', 'POST /v1/execute']);
    await expect(readFile(fixture.discoverySentinel, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('rejects daemon commands in hosted mode without local discovery', async () => {
    const fixture = await createHostedFixture('success');

    const result = await runCli(['daemon', 'status'], fixture.env);

    expect(result.status).toBe(78);
    expect(result.stderr).toContain('Hosted mode has no local daemon.');
    expect(fixture.requests).toEqual([]);
    await expect(readFile(fixture.discoverySentinel, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);
});

async function createHostedFixture(outcome: 'success' | 'failure'): Promise<{
  root: string;
  env: NodeJS.ProcessEnv;
  discoverySentinel: string;
  requests: string[];
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-lifecycle-'));
  tempRoots.push(root);
  const configDir = path.join(root, 'config');
  const userClis = path.join(root, '.webcmd', 'clis', 'lifecycle-sentinel');
  const discoverySentinel = path.join(root, 'local-discovery-ran');
  const requests: string[] = [];
  await mkdir(configDir, { recursive: true });
  await mkdir(userClis, { recursive: true });
  await writeFile(path.join(userClis, 'sentinel.js'), [
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync(${JSON.stringify(discoverySentinel)}, 'read');`,
    "export const sentinel = 'cli(';",
    '',
  ].join('\n'));

  const server = createServer(async (request, response) => {
    requests.push(`${request.method ?? 'GET'} ${request.url ?? '/'}`);
    if (request.url === '/v1/manifest') {
      sendChunkedJson(response, {
        ok: true,
        manifest: {
          userId: 'user_lifecycle',
          metadata: {
            contractSchemaVersion: 1,
            webcmdPackageVersion: '0.3.0',
            generatedAt: '2026-07-14T00:00:00.000Z',
          },
          commands: [command, authCommand],
        },
      });
      return;
    }
    if (request.url === '/v1/execute' && request.method === 'POST') {
      let requestBody = '';
      for await (const chunk of request) requestBody += chunk;
      const invocation = JSON.parse(requestBody) as { command: string; trace?: string };
      if (outcome === 'failure') {
        sendChunkedJson(response, {
          ok: false,
          error: {
            code: 'LIFECYCLE_FAILURE',
            message: 'The hosted lifecycle fixture failed.',
            help: 'Retry the lifecycle fixture.',
            exitCode: 69,
          },
          execution: { id: 'exec_lifecycle', command: invocation.command, status: 'failed' },
        }, 422);
        return;
      }
      sendChunkedJson(response, {
        ok: true,
        result: { value: largeOutput },
        columns: ['value'],
        execution: { id: 'exec_lifecycle', command: invocation.command, status: 'succeeded' },
        ...(invocation.trace === 'on'
          ? { trace: { executionId: 'exec_lifecycle', receipt: traceReceipt } }
          : {}),
      });
      return;
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP lifecycle fixture address');

  await writeFile(path.join(configDir, 'config.json'), `${JSON.stringify({
    mode: 'hosted',
    updatedAt: '2026-07-14T00:00:00.000Z',
    hosted: {
      apiBaseUrl: `http://127.0.0.1:${address.port}`,
      apiKeyRef: 'wcmd_cred_lifecycle',
      credentialBackend: 'file-fallback',
    },
  })}\n`);
  await writeFile(path.join(configDir, 'hosted-credentials.json'), `${JSON.stringify({
    version: 1,
    credentials: { wcmd_cred_lifecycle: 'wcmd_lifecycle' },
    updatedAt: '2026-07-14T00:00:00.000Z',
  })}\n`, { mode: 0o600 });

  return {
    root,
    discoverySentinel,
    requests,
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      WEBCMD_CONFIG_DIR: configDir,
      WEBCMD_NO_UPDATE_CHECK: '1',
    },
  };
}

function sendChunkedJson(response: import('node:http').ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value);
  const split = Math.floor(body.length / 2);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.write(body.slice(0, split));
  setTimeout(() => response.end(body.slice(split)), 25);
}

function runCli(args: string[], env: NodeJS.ProcessEnv, imports: string[] = []): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const importArgs = imports.flatMap(specifier => ['--import', pathToFileURL(specifier).href]);
    const child = spawn(process.execPath, [...importArgs, '--import', 'tsx', entrypoint, ...args], {
      cwd: packageRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', status => resolve({
      status,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function createDelayedStdoutPreload(root: string): Promise<string> {
  const preload = path.join(root, 'delay-stdout.mjs');
  await writeFile(preload, [
    'const originalWrite = process.stdout.write.bind(process.stdout);',
    'process.stdout.write = function delayedWrite(chunk, encoding, callback) {',
    "  const actualEncoding = typeof encoding === 'string' ? encoding : undefined;",
    "  const done = typeof encoding === 'function' ? encoding : callback;",
    '  setTimeout(() => {',
    '    originalWrite(chunk, actualEncoding, (error) => {',
    '      done?.(error);',
    "      process.stdout.emit('drain');",
    '    });',
    '  }, 75);',
    '  return false;',
    '};',
    '',
  ].join('\n'));
  return preload;
}
