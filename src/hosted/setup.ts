import { createInterface } from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { writeToStream } from '../stream-write.js';
import { HostedClient } from './client.js';
import {
  defaultHostedApiBaseUrl,
  makeLocalConfig,
  getConfigPath,
  loadWebcmdConfig,
  saveWebcmdConfig,
  type ConfigIo,
} from './config.js';
import {
  makeStoredHostedConfig,
  storeHostedApiKey,
  type HostedCredentialBackend,
  type HostedCredentialIo,
} from './credentials.js';
import type { InstallSlabOptions } from '../slab/install.js';
import type { SlabInstallation, SlabInstallationIo } from '../slab/installation.js';

export interface SetupIo extends ConfigIo, HostedCredentialIo {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  fetchImpl?: typeof fetch;
  question?: (prompt: string) => Promise<string>;
  write?: (message: string) => void | Promise<void>;
  mode?: 'hosted' | 'local';
  status?: boolean;
  isSlabInstalled?: (io: SlabInstallationIo) => boolean;
  installSlab?: (options?: InstallSlabOptions) => Promise<SlabInstallation>;
  ensureBridgeReady?: () => Promise<void>;
}

export async function runHostedSetup(io: SetupIo = {}): Promise<number> {
  const write = io.write
    ? async (message: string) => { await io.write!(message); }
    : async (message: string) => writeToStream(io.output ?? defaultOutput, message);
  const ownedReadline = io.question ? undefined : createInterface({
    input: io.input ?? defaultInput,
    output: io.output ?? defaultOutput,
  });
  const ask = io.question ?? ((prompt: string) => ownedReadline!.question(prompt));

  try {
    if (io.status) {
      const config = loadWebcmdConfig(io);
      await write(`${JSON.stringify({ configured: (io.existsSync ?? existsSync)(getConfigPath(io)), mode: config.mode })}\n`);
      return 0;
    }
    await write('Webcmd setup\n');
    const mode = io.mode ?? await ask('Use hosted Webcmd Cloud or local Webcmd? [hosted/local] ');
    if (mode.trim().toLowerCase().startsWith('l')) {
      if (io.isSlabInstalled || io.installSlab || (io.input as NodeJS.ReadStream | undefined)?.isTTY || defaultInput.isTTY) {
        await write('Local webcmd requires the SLAB browser.\n');
        const { isSlabInstalled, installSlab, ensureBridgeReady } = await slabHooks(io);
        if (!isSlabInstalled()) {
          const consent = await ask('Install SLAB now? [Y/n] ');
          if (!consent.trim() || consent.trim().toLowerCase().startsWith('y')) {
            await installSlab();
            await ensureBridgeReady();
          } else {
            await write('SLAB was not installed. The next local browser command will ask again.\n');
          }
        }
      }
      saveWebcmdConfig(makeLocalConfig(io.now?.() ?? new Date()), io);
      await write('Webcmd is now configured for local mode.\n');
      return 0;
    }

    const apiBaseUrl = defaultHostedApiBaseUrl(io.env ?? process.env);
    const apiKey = (await ask('Webcmd API key: ')).trim();
    if (!apiKey) {
      await write('A Webcmd API key is required for hosted mode.\n');
      return 2;
    }

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
  } finally {
    ownedReadline?.close();
  }
}

async function slabHooks(io: SetupIo): Promise<{
  isSlabInstalled: () => boolean;
  installSlab: () => Promise<SlabInstallation>;
  ensureBridgeReady: () => Promise<void>;
}> {
  if (io.isSlabInstalled && io.installSlab && io.ensureBridgeReady) {
    return {
      isSlabInstalled: () => io.isSlabInstalled!({
        platform: io.platform ?? process.platform,
        homeDir: io.homeDir ?? homedir(),
        existsSync: io.existsSync ?? existsSync,
      }),
      installSlab: () => io.installSlab!({ launchAfterInstall: true }),
      ensureBridgeReady: io.ensureBridgeReady,
    };
  }

  const [{ isSlabInstalled }, { createSlabInstallerIo, installSlabMacos }, { ensureBrowserBridgeReady }] = await Promise.all([
    import('../slab/installation.js'),
    import('../slab/install.js'),
    import('../browser/daemon-lifecycle.js'),
  ]);
  return {
    isSlabInstalled: () => (io.isSlabInstalled ?? isSlabInstalled)({
      platform: io.platform ?? process.platform,
      homeDir: io.homeDir ?? homedir(),
      existsSync: io.existsSync ?? existsSync,
    }),
    installSlab: () => io.installSlab
      ? io.installSlab({ launchAfterInstall: true })
      : installSlabMacos(createSlabInstallerIo(), { launchAfterInstall: true }),
    ensureBridgeReady: io.ensureBridgeReady ?? (async () => { await ensureBrowserBridgeReady({ verbose: false }); }),
  };
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
