import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfigPath } from './config.js';
import { getHostedCredentialPath } from './credentials.js';
import { runHostedSetup } from './setup.js';

let tempDir: string | undefined;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('webcmd setup', () => {
  it('reports a running preliminary SLAB app in local setup status without invoking installation', async () => {
    const messages: string[] = [];
    const slabStatus = vi.fn(async () => 'preliminary-running' as const);

    const code = await runHostedSetup({
      argv: ['--status'],
      isTTY: false,
      existsSync: () => true,
      readFileSync: (() => JSON.stringify({ mode: 'local', updatedAt: '2026-08-27T00:00:00.000Z' })) as never,
      slabStatus,
      write: message => { messages.push(message); },
    });

    expect(code).toBe(0);
    expect(messages.join('')).toBe('{"configured":true,"mode":"local","slab":"preliminary-running"}\n');
    expect(slabStatus).toHaveBeenCalledOnce();
  });

  it('does not probe SLAB for hosted setup status', async () => {
    const messages: string[] = [];
    const slabStatus = vi.fn(async () => 'not-installed' as const);

    const code = await runHostedSetup({
      argv: ['--status'],
      isTTY: false,
      existsSync: () => true,
      readFileSync: (() => JSON.stringify({
        mode: 'hosted',
        updatedAt: '2026-08-27T00:00:00.000Z',
        hosted: { apiBaseUrl: 'https://api.webcmd.dev', apiKeyRef: 'wcmd_cred_test' },
      })) as never,
      slabStatus,
      write: message => { messages.push(message); },
    });

    expect(code).toBe(0);
    expect(messages.join('')).toBe('{"configured":true,"mode":"hosted"}\n');
    expect(slabStatus).not.toHaveBeenCalled();
  });

  it('writes local mode from interactive answer', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-'));
    const answers = ['local'];
    const messages: string[] = [];
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;

    const code = await runHostedSetup({
      env,
      platform: 'linux',
      now: () => new Date('2026-07-08T00:00:00.000Z'),
      question: async () => answers.shift() ?? '',
      write: (message) => { messages.push(message); },
    });

    expect(code).toBe(0);
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toEqual({
      mode: 'local',
      updatedAt: '2026-07-08T00:00:00.000Z',
    });
    expect(messages.join('')).toContain('local mode');
  });

  it('writes hosted mode and validates with /v1/me', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-'));
    const answers = ['hosted', 'wcmd_live_test'];
    const env = {
      WEBCMD_CONFIG_DIR: tempDir,
      WEBCMD_CREDENTIAL_BACKEND: 'file',
    } as NodeJS.ProcessEnv;
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const prompts: string[] = [];
    const messages: string[] = [];

    const code = await runHostedSetup({
      env,
      platform: 'linux',
      now: () => new Date('2026-07-08T00:00:00.000Z'),
      question: async (prompt) => {
        prompts.push(prompt);
        return answers.shift() ?? '';
      },
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: new Headers(init?.headers).get('authorization'),
        });
        return new Response(JSON.stringify({ ok: true, user: { id: 'user_demo' } }), { status: 200 });
      },
      write: (message) => { messages.push(message); },
    });

    expect(code).toBe(0);
    expect(prompts).toEqual([
      'Use hosted Webcmd Cloud or local Webcmd? [hosted/local] ',
      'Webcmd API key: ',
    ]);
    expect(requests).toEqual([{ url: 'https://api.webcmd.dev/v1/me', authorization: 'Bearer wcmd_live_test' }]);
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({
      mode: 'hosted',
      hosted: {
        apiBaseUrl: 'https://api.webcmd.dev',
        apiKeyRef: expect.stringMatching(/^wcmd_cred_/),
        credentialBackend: 'file-fallback',
      },
    });
    expect(await readFile(getConfigPath({ env }), 'utf8')).not.toContain('wcmd_live_test');
    expect(await readFile(getHostedCredentialPath({ env }), 'utf8')).toContain('wcmd_live_test');
    expect(messages.join('')).toContain('Verified Webcmd Cloud account: user_demo');
    expect(messages.join('')).toContain('Credential backend: protected file fallback.');
  });

  it('writes local mode from --mode without prompting', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-flags-'));
    const messages: string[] = [];
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const question = vi.fn(async () => 'hosted');

    const code = await runHostedSetup({
      env,
      platform: 'linux',
      now: () => new Date('2026-07-08T00:00:00.000Z'),
      argv: ['--mode', 'local'],
      isTTY: false,
      question,
      write: (message) => { messages.push(message); },
    });

    expect(code).toBe(0);
    expect(question).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toEqual({
      mode: 'local',
      updatedAt: '2026-07-08T00:00:00.000Z',
    });
    expect(messages.join('')).toContain('local mode');
  });

  it('rejects non-TTY setup without --mode and never prompts', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-nontty-'));
    const messages: string[] = [];
    const stderr = collectStderr();

    const code = await runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      argv: [],
      isTTY: false,
      stderr: stderr.stream,
      write: (message) => { messages.push(message); },
    });

    expect(code).toBe(2);
    expect(messages.join('')).toBe('');
    expect(stderr.text()).toContain('setup requires --mode when stdin is not a TTY.');
    expect(stderr.text()).toContain('example: webcmd setup --mode local');
  });

  it('rejects non-TTY hosted setup without --api-key', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-hosted-key-'));
    const stderr = collectStderr();

    const code = await runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      argv: ['--mode', 'hosted'],
      isTTY: false,
      stderr: stderr.stream,
      write: () => undefined,
    });

    expect(code).toBe(2);
    expect(stderr.text()).toContain('setup --mode hosted requires --api-key');
  });

  it('persists flag-driven local setup before the real CLI process completes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-process-'));
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', 'setup', '--mode', 'local'], {
      cwd: packageRoot,
      env: { ...process.env, WEBCMD_CONFIG_DIR: tempDir, WEBCMD_NO_UPDATE_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));

    const status = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });

    expect(status).toBe(0);
    expect(Buffer.concat(stderr).toString('utf8')).toBe('');
    expect(Buffer.concat(stdout).toString('utf8')).toContain('Webcmd is now configured for local mode.');
    expect(JSON.parse(await readFile(getConfigPath({ env: { WEBCMD_CONFIG_DIR: tempDir } }), 'utf8')))
      .toMatchObject({ mode: 'local' });
  }, 20_000);

  it('exits immediately when setup is run with stdin detached', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-hang-'));
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', 'setup'], {
      cwd: packageRoot,
      env: { ...process.env, WEBCMD_CONFIG_DIR: tempDir, WEBCMD_NO_UPDATE_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr: Buffer[] = [];
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));

    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('setup hung waiting for input'));
      }, 8_000);
      child.once('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      child.once('close', code => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(status).toBe(2);
    expect(Buffer.concat(stderr).toString('utf8')).toContain('setup requires --mode when stdin is not a TTY.');
  }, 12_000);

  it('does not resolve until all caller-owned output writes complete', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-slow-output-'));
    const output = new SetupControlledWritable();
    let settled = false;

    const run = runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      output,
      question: async () => 'local',
    }).then(code => {
      settled = true;
      return code;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(output.pendingCount()).toBe(1);
    output.release();
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(output.pendingCount()).toBe(1);
    output.release();

    await expect(run).resolves.toBe(0);
    expect(output.text()).toBe('Webcmd setup\nWebcmd is now configured for local mode.\n');
  });

  it('rejects caller-owned stream errors without ending the stream', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-output-error-'));
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('setup output failed'));
      },
    });
    const end = vi.spyOn(output, 'end');

    await expect(runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      output,
      question: async () => 'local',
    })).rejects.toThrow('setup output failed');
    expect(end).not.toHaveBeenCalled();
  });

  it('rejects within a bound when caller-owned output closes before its callback', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-output-close-'));
    const output = new SetupCloseBeforeCallbackWritable();
    const end = vi.spyOn(output, 'end');

    await expect(within(runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      output,
      question: async () => 'local',
    }))).rejects.toThrow('closed before the write completed');
    expect(end).not.toHaveBeenCalled();
  });
});

function collectStderr(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
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

class SetupCloseBeforeCallbackWritable extends Writable {
  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    _callback: (error?: Error | null) => void,
  ): void {
    this.destroy();
  }
}

class SetupControlledWritable extends Writable {
  private readonly chunks: Buffer[] = [];
  private readonly releases: Array<(error?: Error | null) => void> = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    this.releases.push(callback);
  }

  pendingCount(): number {
    return this.releases.length;
  }

  release(): void {
    const callback = this.releases.shift();
    if (!callback) throw new Error('No setup write is pending');
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}
