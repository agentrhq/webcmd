import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfigPath } from './config.js';
import { getHostedCredentialPath } from './credentials.js';
import { runHostedSetup, type SetupIo } from './setup.js';

let tempDir: string | undefined;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

function hostedSetupFixture(overrides: Partial<SetupIo>): SetupIo {
  const answers = ['hosted', 'wcmd_live_test'];
  return {
    env: { WEBCMD_CONFIG_DIR: tempDir, WEBCMD_CREDENTIAL_BACKEND: 'file' },
    question: async () => answers.shift() ?? '',
    fetchImpl: async () => new Response(JSON.stringify({ user: { id: 'user_demo' } }), { status: 200 }),
    write: () => {},
    ...overrides,
  };
}

function statusFixture(overrides: Partial<SetupIo> & { mode: 'hosted' | 'local' }): SetupIo {
  return {
    env: { WEBCMD_CONFIG_DIR: tempDir },
    readFileSync: () => JSON.stringify({
      mode: overrides.mode,
      updatedAt: '2026-07-08T00:00:00.000Z',
      ...(overrides.mode === 'hosted' ? { hosted: { apiBaseUrl: 'https://api.webcmd.dev', apiKeyRef: 'wcmd_cred_test' } } : {}),
    }),
    existsSync: () => true,
    ...overrides,
    status: true,
  } as SetupIo;
}

describe('webcmd setup', () => {
  it('offers SLAB only after local mode is selected', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-slab-'));
    const answers = ['local', 'yes'];
    const installSlab = vi.fn().mockResolvedValue({ platform: 'darwin', executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' });
    await runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      question: async () => answers.shift() ?? '',
      isSlabInstalled: () => false,
      installSlab,
      ensureBridgeReady: async () => {},
      write: () => {},
    });
    expect(installSlab).toHaveBeenCalledOnce();
  });

  it('never checks SLAB for hosted mode', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-hosted-slab-'));
    const isSlabInstalled = vi.fn(() => { throw new Error('must not run'); });
    await runHostedSetup(hostedSetupFixture({ isSlabInstalled }));
    expect(isSlabInstalled).not.toHaveBeenCalled();
  });

  it('reports configured hosted mode without probing SLAB', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-status-slab-'));
    const isSlabInstalled = vi.fn(() => { throw new Error('must not run'); });
    const messages: string[] = [];
    const code = await runHostedSetup(statusFixture({
      mode: 'hosted',
      isSlabInstalled,
      write: message => { messages.push(message); },
    }));
    expect(code).toBe(0);
    expect(messages.join('')).toBe('{"configured":true,"mode":"hosted"}\n');
    expect(isSlabInstalled).not.toHaveBeenCalled();
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

  it('persists interactive local setup before the real CLI process completes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-process-'));
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', 'setup'], {
      cwd: packageRoot,
      env: { ...process.env, WEBCMD_CONFIG_DIR: tempDir, WEBCMD_NO_UPDATE_CHECK: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.stdin.end('local\n');

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

  it('supports non-interactive local setup and JSON status', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-options-'));
    const env = { ...process.env, WEBCMD_CONFIG_DIR: tempDir, WEBCMD_NO_UPDATE_CHECK: '1' };

    const local = await runSetupProcess(['setup', '--mode', 'local'], env);
    expect(local.status).toBe(0);
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({ mode: 'local' });

    const status = await runSetupProcess(['setup', '--status', '--format', 'json'], env);
    expect(status.status).toBe(0);
    expect(status.stdout).toBe('{"configured":true,"mode":"local"}\n');
  }, 20_000);

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

async function runSetupProcess(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', ...args], {
    cwd: packageRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
  child.stdin.end();
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { status, stdout: Buffer.concat(stdout).toString('utf8') };
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
