import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bashCompletionScript } from '../completion-shared.js';
import { PKG_VERSION } from '../version.js';

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

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('hosted CLI process lifecycle', () => {
  it.each([
    { name: 'version', argv: ['--version'], expected: `${PKG_VERSION}\n` },
    { name: 'shell completion', argv: ['completion', 'bash'], expected: bashCompletionScript() },
  ])('awaits a backpressured $name fast-path write before exiting', async ({ argv, expected }) => {
    const fixture = await createHostedFixture('success');
    const preload = await createDelayedStdoutPreload(path.dirname(fixture.discoverySentinel));

    const result = await runCli(argv, fixture.env, [preload]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expected);
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
});

async function createHostedFixture(outcome: 'success' | 'failure'): Promise<{
  env: NodeJS.ProcessEnv;
  discoverySentinel: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-lifecycle-'));
  tempRoots.push(root);
  const configDir = path.join(root, 'config');
  const userClis = path.join(root, '.webcmd', 'clis', 'lifecycle-sentinel');
  const discoverySentinel = path.join(root, 'local-discovery-ran');
  await mkdir(configDir, { recursive: true });
  await mkdir(userClis, { recursive: true });
  await writeFile(path.join(userClis, 'sentinel.js'), [
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync(${JSON.stringify(discoverySentinel)}, 'read');`,
    "export const sentinel = 'cli(';",
    '',
  ].join('\n'));

  const server = createServer((request, response) => {
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
          commands: [command],
        },
      });
      return;
    }
    if (request.url === '/v1/execute' && request.method === 'POST') {
      if (outcome === 'failure') {
        sendChunkedJson(response, {
          ok: false,
          error: {
            code: 'LIFECYCLE_FAILURE',
            message: 'The hosted lifecycle fixture failed.',
            help: 'Retry the lifecycle fixture.',
            exitCode: 69,
          },
          execution: { id: 'exec_lifecycle', command: command.command, status: 'failed' },
        }, 422);
        return;
      }
      sendChunkedJson(response, {
        ok: true,
        result: { value: largeOutput },
        columns: ['value'],
        execution: { id: 'exec_lifecycle', command: command.command, status: 'succeeded' },
        trace: { executionId: 'exec_lifecycle', receipt: traceReceipt },
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
    discoverySentinel,
    env: {
      ...process.env,
      HOME: root,
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
    const importArgs = imports.flatMap(specifier => ['--import', specifier]);
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
