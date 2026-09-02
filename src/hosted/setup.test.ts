import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfigPath, makeLocalConfig, saveWebcmdConfig } from './config.js';
import { getHostedCredentialPath } from './credentials.js';
import { runHostedSetup } from './setup.js';
import type { SlabSetupStatus } from '../slab/status.js';

let tempDir: string | undefined;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('webcmd setup', () => {
  it('writes local mode from interactive answer', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-'));
    const answers = ['local', 'cloak'];
    const messages: string[] = [];
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;

    const code = await runHostedSetup({
      env,
      platform: 'linux',
      now: () => new Date('2026-07-08T00:00:00.000Z'),
      question: async () => answers.shift() ?? '',
      fetchDaemonStatus: async () => null,
      write: (message) => { messages.push(message); },
    });

    expect(code).toBe(0);
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toEqual({
      mode: 'local',
      updatedAt: '2026-07-08T00:00:00.000Z',
      browser: { kind: 'cloak' },
    });
    expect(messages.join('')).toContain('local mode');
  });

  it('shows installed Chrome in the interactive browser prompt and reuses its detection', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-interactive-chrome-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const answers = ['local', 'chrome'];
    const prompts: string[] = [];
    const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const resolveGoogleChromeExecutable = vi.fn(async () => executablePath);

    await expect(runHostedSetup({
      env,
      question: async prompt => {
        prompts.push(prompt);
        return answers.shift() ?? '';
      },
      resolveGoogleChromeExecutable,
      fetchDaemonStatus: async () => null,
      write: () => undefined,
    })).resolves.toBe(0);

    expect(prompts).toContain('Local browser [cloak/chrome (installed)/slab/absolute path] (cloak): ');
    expect(resolveGoogleChromeExecutable).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({
      browser: { kind: 'chrome', executablePath },
    });
  });

  it('shows install required and the official link when unavailable Chrome is selected', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-interactive-chrome-missing-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    saveWebcmdConfig(makeLocalConfig(new Date('2026-08-31T00:00:00.000Z')), { env });
    const answers = ['local', 'chrome'];
    const prompts: string[] = [];
    const messages: string[] = [];
    const resolveGoogleChromeExecutable = vi.fn(async () => undefined);

    await expect(runHostedSetup({
      env,
      question: async prompt => {
        prompts.push(prompt);
        return answers.shift() ?? '';
      },
      resolveGoogleChromeExecutable,
      fetchDaemonStatus: async () => null,
      write: message => { messages.push(message); },
    })).resolves.toBe(1);

    expect(prompts).toContain('Local browser [cloak/chrome (install required)/slab/absolute path] (cloak): ');
    expect(resolveGoogleChromeExecutable).toHaveBeenCalledOnce();
    expect(messages.join('')).toContain('https://www.google.com/chrome/');
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({ browser: { kind: 'cloak' } });
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
      fetchDaemonStatus: async () => null,
      write: (message) => { messages.push(message); },
    });

    expect(code).toBe(0);
    expect(question).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toEqual({
      mode: 'local',
      updatedAt: '2026-07-08T00:00:00.000Z',
      browser: { kind: 'cloak' },
    });
    expect(messages.join('')).toContain('local mode');
  });

  it('validates Cloak before persisting the selection', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-browser-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const events: string[] = [];

    await expect(runHostedSetup({
      env,
      argv: ['--mode', 'local', '--browser', 'cloak'],
      isTTY: false,
      now: () => new Date('2026-08-31T00:00:00.000Z'),
      resolveCloakPackage: async () => { events.push('validate'); return 'file:///cloakbrowser/index.js'; },
      fetchDaemonStatus: async () => null,
      saveConfig: (config, configIo) => {
        events.push('save');
        saveWebcmdConfig(config, configIo);
      },
      write: () => undefined,
    })).resolves.toBe(0);

    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({
      mode: 'local',
      browser: { kind: 'cloak' },
    });
    expect(events).toEqual(['validate', 'save']);
  });

  it('persists a canonical custom executable path', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-custom-browser-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;

    await expect(runHostedSetup({
      env,
      argv: ['--mode', 'local', '--browser', '/Applications/Chrome.app/Contents/MacOS/Google Chrome'],
      isTTY: false,
      realpath: async () => '/private/Applications/Chrome.app/Contents/MacOS/Google Chrome',
      stat: async () => ({ isFile: () => true }),
      access: async () => undefined,
      fetchDaemonStatus: async () => null,
      write: () => undefined,
    })).resolves.toBe(0);

    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({
      mode: 'local',
      browser: { kind: 'custom', executablePath: '/private/Applications/Chrome.app/Contents/MacOS/Google Chrome' },
    });
  });

  it('detects and persists an installed Google Chrome executable', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-chrome-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

    await expect(runHostedSetup({
      env,
      argv: ['--mode', 'local', '--browser', 'chrome'],
      isTTY: false,
      resolveGoogleChromeExecutable: async () => executablePath,
      fetchDaemonStatus: async () => null,
      write: () => undefined,
    })).resolves.toBe(0);

    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({
      mode: 'local',
      browser: { kind: 'chrome', executablePath },
    });
  });

  it('explains how to install Google Chrome when it is unavailable', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-chrome-missing-'));
    const messages: string[] = [];

    await expect(runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      argv: ['--mode', 'local', '--browser', 'chrome'],
      isTTY: false,
      resolveGoogleChromeExecutable: async () => undefined,
      fetchDaemonStatus: async () => null,
      write: message => { messages.push(message); },
    })).resolves.toBe(1);

    expect(messages.join('')).toContain('Google Chrome is not installed');
    expect(messages.join('')).toContain('https://www.google.com/chrome/');
  });

  it('reuses an existing SLAB app without downloading it again', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-slab-reuse-'));
    const events: string[] = [];
    const installSlabMacos = vi.fn();

    await expect(runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      argv: ['--mode', 'local', '--browser', 'slab'],
      isTTY: false,
      platform: 'darwin',
      homeDir: '/Users/me',
      existsSync: candidate => candidate === '/Applications/SLAB.app/Contents/MacOS/SLAB',
      installSlabMacos,
      verifySlabApp: async () => { events.push('verify'); },
      launchSlabApp: async () => { events.push('launch'); },
      inspectSlabStatus: async () => { events.push('hello'); return 'installed-running'; },
      fetchDaemonStatus: async () => null,
      saveConfig: (config, configIo) => { events.push('save'); saveWebcmdConfig(config, configIo); },
      write: () => undefined,
    })).resolves.toBe(0);

    expect(installSlabMacos).not.toHaveBeenCalled();
    expect(events).toEqual(['verify', 'launch', 'hello', 'save']);
  });

  it('rejects SLAB when it does not answer its control protocol after install', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-slab-reuse-not-ready-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    saveWebcmdConfig(makeLocalConfig(new Date('2026-08-30T00:00:00.000Z')), { env });

    await expect(runHostedSetup({
      env,
      argv: ['--mode', 'local', '--browser', 'slab'],
      isTTY: false,
      platform: 'darwin',
      existsSync: () => false,
      installSlabMacos: async () => ({ platform: 'darwin', appPath: '/Applications/SLAB.app', executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' }),
      inspectSlabStatus: async () => 'installed-not-running',
      wait: async () => undefined,
      fetchDaemonStatus: async () => null,
      write: () => undefined,
    })).resolves.toBe(1);

    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({ browser: { kind: 'cloak' } });
  });

  it('installs SLAB and probes its control protocol before persisting', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-slab-install-'));
    const events: string[] = [];

    await expect(runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      argv: ['--mode', 'local', '--browser', 'slab'],
      isTTY: false,
      platform: 'darwin',
      existsSync: () => false,
      installSlabMacos: async () => { events.push('install'); return { platform: 'darwin', appPath: '/Applications/SLAB.app', executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' }; },
      inspectSlabStatus: async () => { events.push('hello'); return 'installed-running'; },
      fetchDaemonStatus: async () => null,
      saveConfig: (config, configIo) => { events.push('save'); saveWebcmdConfig(config, configIo); },
      write: () => undefined,
    })).resolves.toBe(0);

    expect(events).toEqual(['install', 'hello', 'save']);
  });

  it('polls for SLAB control readiness before persisting', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-slab-ready-poll-'));
    const events: string[] = [];
    const statuses: SlabSetupStatus[] = ['installed-not-running', 'installed-running'];

    await expect(runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      argv: ['--mode', 'local', '--browser', 'slab'],
      isTTY: false,
      platform: 'darwin',
      existsSync: () => false,
      installSlabMacos: async () => { events.push('install'); return { platform: 'darwin', appPath: '/Applications/SLAB.app', executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' }; },
      inspectSlabStatus: async () => { events.push('hello'); return statuses.shift() ?? 'installed-running'; },
      wait: async () => { events.push('wait'); },
      fetchDaemonStatus: async () => null,
      saveConfig: (config, configIo) => { events.push('save'); saveWebcmdConfig(config, configIo); },
      write: () => undefined,
    })).resolves.toBe(0);

    expect(events).toEqual(['install', 'hello', 'wait', 'hello', 'save']);
  });

  it('allows slow first SLAB launch before persisting', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-slab-slow-ready-'));
    const statuses: SlabSetupStatus[] = [
      ...Array.from<SlabSetupStatus>({ length: 41 }).fill('installed-not-running'),
      'installed-running',
    ];

    await expect(runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      argv: ['--mode', 'local', '--browser', 'slab'],
      isTTY: false,
      platform: 'darwin',
      existsSync: () => false,
      installSlabMacos: async () => ({ platform: 'darwin', appPath: '/Applications/SLAB.app', executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' }),
      inspectSlabStatus: async () => statuses.shift() ?? 'installed-running',
      wait: async () => undefined,
      fetchDaemonStatus: async () => null,
      write: () => undefined,
    })).resolves.toBe(0);
  });

  it('leaves config and daemon unchanged when SLAB installation fails', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-slab-failure-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    saveWebcmdConfig(makeLocalConfig(new Date('2026-08-30T00:00:00.000Z')), { env });
    const restartDaemon = vi.fn();

    await expect(runHostedSetup({
      env,
      argv: ['--mode', 'local', '--browser', 'slab'],
      isTTY: false,
      platform: 'darwin',
      existsSync: () => false,
      installSlabMacos: async () => { throw new Error('download failed'); },
      fetchDaemonStatus: async () => daemonStatus('cloak'),
      restartDaemon,
      write: () => undefined,
    })).resolves.toBe(1);

    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({ browser: { kind: 'cloak' } });
    expect(restartDaemon).not.toHaveBeenCalled();
  });

  it('does not restart a daemon when config persistence fails', async () => {
    const restartDaemon = vi.fn();

    await expect(runHostedSetup({
      argv: ['--mode', 'local'],
      isTTY: false,
      resolveCloakPackage: async () => 'file:///cloakbrowser/index.js',
      fetchDaemonStatus: async () => daemonStatus('cloak'),
      saveConfig: () => { throw new Error('disk full'); },
      restartDaemon,
      write: () => undefined,
    })).resolves.toBe(1);

    expect(restartDaemon).not.toHaveBeenCalled();
  });

  it('restarts a running daemon and requires the selected runtime', async () => {
    const restartDaemon = vi.fn(async () => ({ previousStatus: daemonStatus('cloak'), status: daemonStatus('custom'), stopped: true, spawned: true }));

    await expect(runHostedSetup({
      argv: ['--mode', 'local', '--browser', '/custom/browser'],
      isTTY: false,
      realpath: async () => '/custom/browser',
      stat: async () => ({ isFile: () => true }),
      access: async () => undefined,
      fetchDaemonStatus: async () => daemonStatus('cloak'),
      restartDaemon,
      write: () => undefined,
    })).resolves.toBe(0);

    expect(restartDaemon).toHaveBeenCalledOnce();
  });

  it('does not start a stopped daemon during setup', async () => {
    const restartDaemon = vi.fn();

    await expect(runHostedSetup({
      argv: ['--mode', 'local'],
      isTTY: false,
      resolveCloakPackage: async () => 'file:///cloakbrowser/index.js',
      fetchDaemonStatus: async () => null,
      restartDaemon,
      write: () => undefined,
    })).resolves.toBe(0);

    expect(restartDaemon).not.toHaveBeenCalled();
  });

  it('keeps a valid selection when the restarted daemon reports the wrong runtime', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-runtime-mismatch-'));
    const messages: string[] = [];

    await expect(runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      argv: ['--mode', 'local'],
      isTTY: false,
      resolveCloakPackage: async () => 'file:///cloakbrowser/index.js',
      fetchDaemonStatus: async () => daemonStatus('custom'),
      restartDaemon: async () => ({ previousStatus: daemonStatus('custom'), status: daemonStatus('custom'), stopped: true, spawned: true }),
      write: message => { messages.push(message); },
    })).resolves.toBe(1);

    expect(JSON.parse(await readFile(getConfigPath({ env: { WEBCMD_CONFIG_DIR: tempDir } }), 'utf8'))).toMatchObject({ browser: { kind: 'cloak' } });
    expect(messages.join('')).toContain('webcmd daemon restart');
  });

  it('keeps a valid selection and prints restart guidance when daemon restart fails', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-restart-failure-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const messages: string[] = [];

    await expect(runHostedSetup({
      env,
      argv: ['--mode', 'local'],
      isTTY: false,
      resolveCloakPackage: async () => 'file:///cloakbrowser/index.js',
      fetchDaemonStatus: async () => daemonStatus('custom'),
      restartDaemon: async () => { throw new Error('port still busy'); },
      write: message => { messages.push(message); },
    })).resolves.toBe(1);

    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({ browser: { kind: 'cloak' } });
    expect(messages.join('')).toContain('webcmd daemon restart');
  });

  it('rejects SLAB setup off macOS before changing config', async () => {
    const installSlabMacos = vi.fn();

    await expect(runHostedSetup({
      argv: ['--mode', 'local', '--browser', 'slab'],
      isTTY: false,
      platform: 'linux',
      installSlabMacos,
      write: () => undefined,
    })).resolves.toBe(1);

    expect(installSlabMacos).not.toHaveBeenCalled();
  });

  it.each([
    [['--mode', 'local', '--browser'], '--browser requires a value.'],
    [['--mode', 'local', '--browser', 'relative/browser'], '--browser must be cloak, chrome, slab, or an absolute path'],
    [['--mode', 'hosted', '--browser', 'slab', '--api-key', 'wcmd_live_test'], '--browser is only valid with --mode local.'],
  ])('rejects invalid browser arguments from %j', async (argv, message) => {
    const stderr = collectStderr();

    await expect(runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: join(tmpdir(), `webcmd-setup-browser-error-${Date.now()}`) },
      argv,
      isTTY: false,
      stderr: stderr.stream,
      write: () => undefined,
    })).resolves.toBe(2);

    expect(stderr.text()).toContain(message);
  });

  it('shows browser usage in setup help', async () => {
    const messages: string[] = [];

    await expect(runHostedSetup({
      argv: ['--help'],
      write: message => { messages.push(message); },
    })).resolves.toBe(0);

    expect(messages.join('')).toContain('--browser <cloak|chrome|slab|absolute-path>');
    expect(messages.join('')).toContain('Cloak is default, Chrome reuses an installed Google Chrome');
  });

  it('reports the configured custom browser without probing SLAB', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-status-custom-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const inspectSlabStatus = vi.fn();
    saveWebcmdConfig(makeLocalConfig(new Date('2026-08-31T00:00:00.000Z'), { kind: 'custom', executablePath: '/custom/browser' }), { env });
    const messages: string[] = [];

    await expect(runHostedSetup({ env, argv: ['--status'], inspectSlabStatus, write: message => { messages.push(message); } })).resolves.toBe(0);

    expect(JSON.parse(messages.join(''))).toEqual({
      configured: true,
      mode: 'local',
      browser: { kind: 'custom', executablePath: '/custom/browser' },
    });
    expect(inspectSlabStatus).not.toHaveBeenCalled();
  });

  it('reports SLAB runtime status without installing or launching it', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-status-slab-'));
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const installSlabMacos = vi.fn();
    saveWebcmdConfig(makeLocalConfig(new Date('2026-08-31T00:00:00.000Z'), { kind: 'slab' }), { env });
    const messages: string[] = [];

    await expect(runHostedSetup({
      env,
      argv: ['--status'],
      inspectSlabStatus: async () => 'installed-not-running',
      installSlabMacos,
      write: message => { messages.push(message); },
    })).resolves.toBe(0);

    expect(JSON.parse(messages.join(''))).toEqual({
      configured: true,
      mode: 'local',
      browser: { kind: 'slab' },
      runtime: 'installed-not-running',
    });
    expect(installSlabMacos).not.toHaveBeenCalled();
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
    const answers = ['local', 'cloak'];

    const run = runHostedSetup({
      env: { WEBCMD_CONFIG_DIR: tempDir },
      output,
      question: async () => answers.shift() ?? '',
      fetchDaemonStatus: async () => null,
      resolveCloakPackage: async () => 'file:///cloakbrowser/index.js',
      resolveGoogleChromeExecutable: async () => undefined,
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

function daemonStatus(runtimeName: string) {
  return {
    ok: true,
    pid: 1234,
    uptime: 1,
    runtimeConnected: true,
    runtimeName,
    pending: 0,
    memoryMB: 1,
    port: 9777,
  };
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
