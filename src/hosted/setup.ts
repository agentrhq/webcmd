import { createInterface } from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import * as fs from 'node:fs';
import { CLI_COMMAND } from '../brand.js';
import { ArgumentError, toEnvelope } from '../errors.js';
import { formatErrorEnvelope } from '../output.js';
import { writeToStream } from '../stream-write.js';
import { HostedClient } from './client.js';
import {
  defaultHostedApiBaseUrl,
  getConfigPath,
  loadWebcmdConfig,
  makeLocalConfig,
  saveWebcmdConfig,
  type ConfigIo,
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
  slabStatus?: () => Promise<'preliminary-running' | 'installed-running' | 'installed-not-running' | 'not-installed'>;
}

type SetupMode = 'local' | 'hosted';

const SETUP_USAGE = `usage: ${CLI_COMMAND} setup [--status] [--mode <local|hosted> [--api-key <key>]]`;
const SETUP_EXAMPLE = `example: ${CLI_COMMAND} setup --mode local`;
const SETUP_HELP = [
  `${CLI_COMMAND} setup`,
  '',
  'Configure local or hosted mode.',
  '',
  '  --status                Show the configured mode and local SLAB status',
  '  --mode <local|hosted>   Required when stdin is not a TTY',
  '  --api-key <key>         Required for --mode hosted when stdin is not a TTY',
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
      const config = loadWebcmdConfig(io);
      const status: { configured: boolean; mode: SetupMode; slab?: string } = {
        configured: (io.existsSync ?? fs.existsSync)(getConfigPath(io)),
        mode: config.mode,
      };
      if (config.mode === 'local') {
        status.slab = await (io.slabStatus ?? localSlabStatus)();
      }
      await write(`${JSON.stringify(status)}\n`);
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
      saveWebcmdConfig(makeLocalConfig(io.now?.() ?? new Date()), io);
      await write('Webcmd is now configured for local mode.\n');
      return 0;
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
  if (io.question) return true;
  if (io.isTTY !== undefined) return io.isTTY;
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function parseSetupArgs(argv: readonly string[]): { help?: true; status?: true; mode?: SetupMode; apiKey?: string } {
  let mode: SetupMode | undefined;
  let apiKey: string | undefined;
  let status = false;
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

    throw new ArgumentError(
      `unknown flag ${token} for \`setup\``,
      `valid flags for \`setup\`: --status, --mode, --api-key, --help\n${SETUP_USAGE}`,
    );
  }
  if (status && (mode || apiKey)) {
    throw new ArgumentError('--status cannot be combined with setup options.', SETUP_USAGE);
  }
  return { ...(status ? { status: true as const } : {}), mode, apiKey };
}

async function localSlabStatus(): Promise<'preliminary-running' | 'installed-running' | 'installed-not-running' | 'not-installed'> {
  const { inspectSlabStatus } = await import('../slab/status.js');
  return inspectSlabStatus();
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
