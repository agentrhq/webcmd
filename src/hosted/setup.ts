import { createInterface } from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { constants, existsSync } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import { CLI_COMMAND } from '../brand.js';
import { ArgumentError, toEnvelope } from '../errors.js';
import { formatErrorEnvelope } from '../output.js';
import { writeToStream } from '../stream-write.js';
import { fetchDaemonStatus, type DaemonStatus } from '../browser/daemon-transport.js';
import { restartDaemon, type DaemonRestartResult } from '../browser/daemon-lifecycle.js';
import { createSlabInstallerIo, installSlabMacos } from '../slab/install.js';
import { findSlabInstallation, type SlabInstallation } from '../slab/installation.js';
import { inspectSlabStatus, slabStatusHasHello, type SlabSetupStatus } from '../slab/status.js';
import { HostedClient } from './client.js';
import {
  defaultHostedApiBaseUrl,
  getConfigPath,
  loadWebcmdConfig,
  makeLocalConfig,
  saveWebcmdConfig,
  type ConfigIo,
  type LocalBrowserConfig,
  type WebcmdConfig,
} from './config.js';
import {
  makeStoredHostedConfig,
  storeHostedApiKey,
  type HostedCredentialBackend,
  type HostedCredentialIo,
} from './credentials.js';

export interface SetupIo extends ConfigIo, HostedCredentialIo {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  fetchImpl?: typeof fetch;
  question?: (prompt: string) => Promise<string>;
  write?: (message: string) => void | Promise<void>;
  argv?: readonly string[];
  isTTY?: boolean;
  resolveCloakPackage?: () => string | Promise<string>;
  realpath?: (path: string) => Promise<string>;
  stat?: (path: string) => Promise<{ isFile(): boolean }>;
  access?: (path: string, mode: number) => Promise<void>;
  findSlabInstallation?: () => SlabInstallation | null;
  installSlabMacos?: () => Promise<SlabInstallation>;
  inspectSlabStatus?: () => Promise<SlabSetupStatus>;
  fetchDaemonStatus?: () => Promise<DaemonStatus | null>;
  restartDaemon?: () => Promise<DaemonRestartResult>;
  saveConfig?: (config: WebcmdConfig, io: ConfigIo) => void;
}

type SetupMode = 'local' | 'hosted';

const SETUP_USAGE = `usage: ${CLI_COMMAND} setup --mode <local|hosted> [--browser <cloak|slab|absolute-path>] [--api-key <key>]`;
const SETUP_EXAMPLE = `example: ${CLI_COMMAND} setup --mode local`;
const SETUP_HELP = [
  `${CLI_COMMAND} setup`,
  '',
  'Configure local or hosted mode.',
  '',
  '  --mode <local|hosted>   Required when stdin is not a TTY',
  '  --browser <cloak|slab|absolute-path>  Local browser in local mode',
  '  --api-key <key>         Required for --mode hosted when stdin is not a TTY',
  '  --status                Show the configured mode and local browser',
  '  -h, --help',
  '',
  SETUP_EXAMPLE,
  `example: ${CLI_COMMAND} setup --mode hosted --api-key <key>`,
  '',
].join('\n');

export async function runHostedSetup(io: SetupIo = {}): Promise<number> {
  const write = io.write
    ? async (message: string) => { await io.write!(message); }
    : async (message: string) => writeToStream(io.output ?? defaultOutput, message);
  let ownedReadline: ReturnType<typeof createInterface> | undefined;
  const ask = io.question ?? (async (prompt: string) => {
    ownedReadline ??= createInterface({
      input: io.input ?? defaultInput,
      output: io.output ?? defaultOutput,
    });
    return ownedReadline.question(prompt);
  });

  try {
    const parsed = parseSetupArgs(io.argv ?? []);
    if (parsed.help) {
      await write(SETUP_HELP);
      return 0;
    }
    if (parsed.status) {
      await write(`${JSON.stringify(await getSetupStatus(io))}\n`);
      return 0;
    }

    const interactive = canPrompt(io);
    let mode = parsed.mode;
    if (!mode) {
      if (!interactive) {
        throw new ArgumentError(
          'setup requires --mode when stdin is not a TTY.',
          `${SETUP_USAGE}\n${SETUP_EXAMPLE}`,
        );
      }
      await write('Webcmd setup\n');
      mode = (await ask('Use hosted Webcmd Cloud or local Webcmd? [hosted/local] ')).trim().toLowerCase().startsWith('l')
        ? 'local'
        : 'hosted';
    } else {
      await write('Webcmd setup\n');
    }

    if (mode === 'local') {
      if (parsed.apiKey) {
        throw new ArgumentError(
          '--api-key is only valid with --mode hosted.',
          `${SETUP_USAGE}\n${SETUP_EXAMPLE}`,
        );
      }
      const browser = parsed.browser ?? (interactive
        ? parseLocalBrowser((await ask('Local browser [cloak/slab/absolute path] (cloak): ')).trim() || 'cloak')
        : { kind: 'cloak' });
      const before = await (io.fetchDaemonStatus ?? fetchDaemonStatus)();
      try {
        const selected = await validateLocalBrowser(browser, io);
        (io.saveConfig ?? saveWebcmdConfig)(makeLocalConfig(io.now?.() ?? new Date(), selected), io);
        if (before) await restartConfiguredDaemon(selected, io);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await write(`Local browser setup failed: ${message}\n`);
        if (err instanceof DaemonRestartError) await write('Run `webcmd daemon restart` to apply the selected browser.\n');
        return 1;
      }
      await write('Webcmd is now configured for local mode.\n');
      return 0;
    }

    if (parsed.browser) {
      throw new ArgumentError(
        '--browser is only valid with --mode local.',
        `${SETUP_USAGE}\n${SETUP_EXAMPLE}`,
      );
    }

    let apiKey = parsed.apiKey?.trim();
    if (!apiKey) {
      if (!interactive) {
        throw new ArgumentError(
          'setup --mode hosted requires --api-key when stdin is not a TTY.',
          `${SETUP_USAGE}\nexample: ${CLI_COMMAND} setup --mode hosted --api-key <key>`,
        );
      }
      apiKey = (await ask('Webcmd API key: ')).trim();
      if (!apiKey) {
        await write('A Webcmd API key is required for hosted mode.\n');
        return 2;
      }
    }

    const apiBaseUrl = defaultHostedApiBaseUrl(io.env ?? process.env);
    let accountLabel: string | undefined;
    try {
      const me = await new HostedClient({
        apiBaseUrl,
        apiKey,
        fetchImpl: io.fetchImpl,
      }).getMe();
      accountLabel = hostedAccountLabel(me);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await write(`Warning: could not verify API key yet: ${message}\n`);
    }
    const credential = await storeHostedApiKey(apiKey, io);
    const config = makeStoredHostedConfig({
      apiBaseUrl,
      apiKeyRef: credential.apiKeyRef,
      credentialBackend: credential.credentialBackend,
      now: io.now?.() ?? new Date(),
    });
    saveWebcmdConfig(config, io);
    if (accountLabel) await write(`Verified Webcmd Cloud account: ${accountLabel}\n`);
    if (credential.credentialBackend === 'file-fallback') {
      await write('Warning: OS credential storage was unavailable; API key stored in a protected Webcmd credentials file.\n');
    }
    await write(`Credential backend: ${credentialBackendLabel(credential.credentialBackend)}.\n`);
    await write('Webcmd is now configured for hosted mode.\n');
    return 0;
  } catch (err) {
    if (err instanceof ArgumentError) {
      await writeToStream(io.stderr ?? process.stderr, formatErrorEnvelope(toEnvelope(err)));
      return err.exitCode;
    }
    throw err;
  } finally {
    ownedReadline?.close();
  }
}

function canPrompt(io: SetupIo): boolean {
  if (io.isTTY !== undefined) return io.isTTY;
  if (io.question) return true;
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function validateLocalBrowser(browser: LocalBrowserConfig, io: SetupIo): Promise<LocalBrowserConfig> {
  if (browser.kind === 'cloak') {
    await (io.resolveCloakPackage ?? (() => import.meta.resolve('cloakbrowser')))();
    return browser;
  }
  if (browser.kind === 'custom') {
    const executablePath = await (io.realpath ?? realpath)(browser.executablePath);
    if (!(await (io.stat ?? stat)(executablePath)).isFile()) throw new Error(`Browser executable is not a file: ${executablePath}`);
    await (io.access ?? access)(executablePath, constants.X_OK);
    return { kind: 'custom', executablePath };
  }
  if ((io.platform ?? process.platform) !== 'darwin') throw new Error('SLAB setup is only supported on macOS.');
  if (!(io.findSlabInstallation ?? defaultFindSlabInstallation)()) {
    await (io.installSlabMacos ?? (() => installSlabMacos(createSlabInstallerIo(), { launchAfterInstall: true })))();
  }
  if (!slabStatusHasHello(await (io.inspectSlabStatus ?? inspectSlabStatus)())) throw new Error('SLAB did not report its control protocol after launch.');
  return browser;
}

function defaultFindSlabInstallation(): SlabInstallation | null {
  return findSlabInstallation({ platform: process.platform, homeDir: homedir(), existsSync });
}

async function restartConfiguredDaemon(browser: LocalBrowserConfig, io: SetupIo): Promise<void> {
  let result: DaemonRestartResult;
  try {
    result = await (io.restartDaemon ?? restartDaemon)();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DaemonRestartError(message);
  }
  const expected = browser.kind === 'slab' ? 'SLAB' : browser.kind;
  if (!result.stopped || result.status?.runtimeName !== expected) {
    throw new DaemonRestartError(`Daemon restarted without the selected ${expected} runtime.`);
  }
}

class DaemonRestartError extends Error {}

export interface SetupStatus {
  configured: boolean;
  mode: SetupMode;
  browser: LocalBrowserConfig | null;
  runtime?: SlabSetupStatus;
}

export async function getSetupStatus(io: SetupIo = {}): Promise<SetupStatus> {
  const config = loadWebcmdConfig(io);
  const browser = config.mode === 'local' ? config.browser : null;
  const status: SetupStatus = {
    configured: (io.existsSync ?? existsSync)(getConfigPath(io)),
    mode: config.mode,
    browser,
  };
  if (browser?.kind === 'slab') status.runtime = await (io.inspectSlabStatus ?? inspectSlabStatus)();
  return status;
}

function parseSetupArgs(argv: readonly string[]): { help?: true; status?: true; mode?: SetupMode; browser?: LocalBrowserConfig; apiKey?: string } {
  let mode: SetupMode | undefined;
  let browser: LocalBrowserConfig | undefined;
  let apiKey: string | undefined;
  let status: true | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--help' || token === '-h') return { help: true };
    if (token === '--status') {
      status = true;
      continue;
    }
    if (token === '--mode' || token.startsWith('--mode=')) {
      const value = token.startsWith('--mode=') ? token.slice('--mode='.length) : argv[++i];
      if (value !== 'local' && value !== 'hosted') {
        throw new ArgumentError(
          `--mode must be one of: local, hosted${value ? ` (got: "${value}")` : ''}.`,
          `${SETUP_USAGE}\n${SETUP_EXAMPLE}`,
        );
      }
      mode = value;
      continue;
    }

    if (token === '--api-key' || token.startsWith('--api-key=')) {
      const value = token.startsWith('--api-key=') ? token.slice('--api-key='.length) : argv[++i];
      if (!value || value.startsWith('-')) {
        throw new ArgumentError(
          '--api-key requires a value.',
          `${SETUP_USAGE}\nexample: ${CLI_COMMAND} setup --mode hosted --api-key <key>`,
        );
      }
      apiKey = value;
      continue;
    }

    if (token === '--browser' || token.startsWith('--browser=')) {
      const value = token.startsWith('--browser=') ? token.slice('--browser='.length) : argv[++i];
      browser = parseLocalBrowser(value);
      continue;
    }

    throw new ArgumentError(
      `unknown flag ${token} for \`setup\``,
      `valid flags for \`setup\`: --mode, --browser, --api-key, --status, --help\n${SETUP_USAGE}`,
    );
  }
  return { ...(status ? { status } : {}), mode, browser, apiKey };
}

function parseLocalBrowser(value: string | undefined): LocalBrowserConfig {
  if (!value || value.startsWith('-')) {
    throw new ArgumentError('--browser requires a value.', `${SETUP_USAGE}\n${SETUP_EXAMPLE}`);
  }
  if (value === 'cloak' || value === 'slab') return { kind: value };
  if (isAbsolute(value)) return { kind: 'custom', executablePath: value };
  throw new ArgumentError(
    `--browser must be cloak, slab, or an absolute path (got: "${value}").`,
    `${SETUP_USAGE}\n${SETUP_EXAMPLE}`,
  );
}

function hostedAccountLabel(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const user = (body as { user?: unknown }).user;
  if (!user || typeof user !== 'object' || Array.isArray(user)) return undefined;
  const record = user as { email?: unknown; id?: unknown };
  if (typeof record.email === 'string' && record.email.trim()) return record.email.trim();
  if (typeof record.id === 'string' && record.id.trim()) return record.id.trim();
  return undefined;
}

function credentialBackendLabel(backend: HostedCredentialBackend): string {
  return backend === 'os' ? 'OS credential store' : 'protected file fallback';
}
