import { execFile as execFileCallback } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile, chmod } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { ConfigError } from '../errors.js';
import {
  getConfigDir,
  normalizeApiBaseUrl,
  saveWebcmdConfig,
  type ConfigIo,
  type HostedManifestCache,
  type HostedWebcmdConfig,
} from './config.js';

const execFile = promisify(execFileCallback);
const MACOS_KEYCHAIN_SERVICE = 'dev.webcmd.hosted-api-key';
const MACOS_KEYCHAIN_TIMEOUT_MS = 5_000;

export type HostedCredentialBackend = 'os' | 'file-fallback';

export interface HostedCredentialStore {
  put(reference: string, secret: string): Promise<void>;
  get(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
  backend(): HostedCredentialBackend;
}

export interface HostedCredentialIo extends ConfigIo {
  credentialStore?: HostedCredentialStore;
  randomUUID?: () => string;
  platform?: NodeJS.Platform;
}

export interface HostedCredentialResolution {
  apiKey: string;
  backend?: HostedCredentialBackend;
  migrated: boolean;
  migrationError?: Error;
}

interface StoredHostedConfigInput {
  apiBaseUrl: string;
  apiKeyRef: string;
  credentialBackend: HostedCredentialBackend;
  manifestCache?: HostedManifestCache;
  now?: Date;
}

export function getHostedCredentialPath(io: Pick<ConfigIo, 'env' | 'homeDir'> = {}): string {
  return path.join(getConfigDir(io), 'hosted-credentials.json');
}

export async function storeHostedApiKey(
  apiKey: string,
  io: HostedCredentialIo = {},
): Promise<{ apiKeyRef: string; credentialBackend: HostedCredentialBackend }> {
  const apiKeyRef = createHostedCredentialReference(io);
  const candidates = createCredentialStoreCandidates(io);
  let lastError: Error | undefined;
  for (const store of candidates) {
    try {
      await store.put(apiKeyRef, apiKey);
      const readBack = await store.get(apiKeyRef);
      if (readBack !== apiKey) {
        throw new Error(`Hosted credential store ${store.backend()} did not verify the saved key.`);
      }
      return { apiKeyRef, credentialBackend: store.backend() };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      try {
        await store.delete(apiKeyRef);
      } catch {
        // Best-effort cleanup only; a failed candidate must not hide fallback stores.
      }
    }
  }
  throw lastError ?? new Error('No hosted credential store is available.');
}

export async function resolveHostedApiKey(
  config: HostedWebcmdConfig,
  io: HostedCredentialIo & { migrate?: boolean } = {},
): Promise<HostedCredentialResolution> {
  if (config.hosted.apiKeyRef) {
    const store = createCredentialStoreForBackend(config.hosted.credentialBackend, io);
    const apiKey = await store.get(config.hosted.apiKeyRef);
    if (!apiKey) {
      throw new ConfigError(
        'Webcmd hosted credentials are missing.',
        'Run `webcmd setup` again to reconnect hosted mode.',
      );
    }
    return {
      apiKey,
      backend: store.backend(),
      migrated: false,
    };
  }

  if (config.hosted.apiKey) {
    const apiKey = config.hosted.apiKey;
    if (io.migrate === false) return { apiKey, migrated: false };
    try {
      const stored = await storeHostedApiKey(apiKey, io);
      saveWebcmdConfig(makeStoredHostedConfig({
        apiBaseUrl: config.hosted.apiBaseUrl,
        apiKeyRef: stored.apiKeyRef,
        credentialBackend: stored.credentialBackend,
        ...(config.hosted.manifestCache ? { manifestCache: config.hosted.manifestCache } : {}),
        now: new Date(config.updatedAt),
      }), io);
      return {
        apiKey,
        backend: stored.credentialBackend,
        migrated: true,
      };
    } catch (error) {
      return {
        apiKey,
        migrated: false,
        migrationError: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  throw new ConfigError(
    'Webcmd hosted mode is missing its API key reference.',
    'Run `webcmd setup` again to reconnect hosted mode.',
  );
}

export function makeStoredHostedConfig(input: StoredHostedConfigInput): HostedWebcmdConfig {
  return {
    mode: 'hosted',
    updatedAt: (input.now ?? new Date()).toISOString(),
    hosted: {
      apiBaseUrl: normalizeApiBaseUrl(input.apiBaseUrl),
      apiKeyRef: input.apiKeyRef,
      credentialBackend: input.credentialBackend,
      ...(input.manifestCache ? { manifestCache: input.manifestCache } : {}),
    },
  };
}

function createHostedCredentialReference(io: HostedCredentialIo): string {
  const id = (io.randomUUID ?? randomUUID)().replace(/[^A-Za-z0-9_-]/g, '');
  return `wcmd_cred_${id}`;
}

function createCredentialStoreCandidates(io: HostedCredentialIo): HostedCredentialStore[] {
  if (io.credentialStore) return [io.credentialStore];
  const stores: HostedCredentialStore[] = [];
  if (isMacOsKeychainAvailable(io)) stores.push(new MacOsKeychainCredentialStore());
  stores.push(new FileHostedCredentialStore(io));
  return stores;
}

function createCredentialStoreForBackend(
  backend: HostedCredentialBackend | undefined,
  io: HostedCredentialIo,
): HostedCredentialStore {
  if (io.credentialStore) return io.credentialStore;
  if (backend === 'os' && isMacOsKeychainAvailable(io)) return new MacOsKeychainCredentialStore();
  if (backend === 'os') {
    throw new ConfigError(
      'The configured OS credential store is not available on this machine.',
      'Run `webcmd setup` again to reconnect hosted mode on this machine.',
    );
  }
  return new FileHostedCredentialStore(io);
}

function isMacOsKeychainAvailable(io: HostedCredentialIo): boolean {
  const env = io.env ?? process.env;
  if (env.WEBCMD_CREDENTIAL_BACKEND === 'file') return false;
  const platform = io.platform ?? process.platform;
  const existsSync = io.existsSync ?? fs.existsSync;
  return platform === 'darwin' && existsSync('/usr/bin/security');
}

class MacOsKeychainCredentialStore implements HostedCredentialStore {
  backend(): HostedCredentialBackend {
    return 'os';
  }

  async put(reference: string, secret: string): Promise<void> {
    validateCredentialReference(reference);
    await execFile('/usr/bin/security', [
      'add-generic-password',
      '-a',
      reference,
      '-s',
      MACOS_KEYCHAIN_SERVICE,
      '-w',
      secret,
      '-U',
    ], { timeout: MACOS_KEYCHAIN_TIMEOUT_MS });
  }

  async get(reference: string): Promise<string | null> {
    validateCredentialReference(reference);
    try {
      const { stdout } = await execFile('/usr/bin/security', [
        'find-generic-password',
        '-a',
        reference,
        '-s',
        MACOS_KEYCHAIN_SERVICE,
        '-w',
      ], { timeout: MACOS_KEYCHAIN_TIMEOUT_MS });
      return stdout.replace(/\r?\n$/, '');
    } catch {
      return null;
    }
  }

  async delete(reference: string): Promise<void> {
    validateCredentialReference(reference);
    try {
      await execFile('/usr/bin/security', [
        'delete-generic-password',
        '-a',
        reference,
        '-s',
        MACOS_KEYCHAIN_SERVICE,
      ], { timeout: MACOS_KEYCHAIN_TIMEOUT_MS });
    } catch {
      // Missing credentials are already deleted for the caller's purposes.
    }
  }
}

class FileHostedCredentialStore implements HostedCredentialStore {
  constructor(private readonly io: Pick<ConfigIo, 'env' | 'homeDir'> = {}) {}

  backend(): HostedCredentialBackend {
    return 'file-fallback';
  }

  async put(reference: string, secret: string): Promise<void> {
    validateCredentialReference(reference);
    const document = await this.readDocument();
    document.credentials[reference] = secret;
    document.updatedAt = new Date().toISOString();
    await this.writeDocument(document);
  }

  async get(reference: string): Promise<string | null> {
    validateCredentialReference(reference);
    const document = await this.readDocument();
    return document.credentials[reference] ?? null;
  }

  async delete(reference: string): Promise<void> {
    validateCredentialReference(reference);
    const document = await this.readDocument();
    if (!Object.prototype.hasOwnProperty.call(document.credentials, reference)) return;
    delete document.credentials[reference];
    document.updatedAt = new Date().toISOString();
    await this.writeDocument(document);
  }

  private async readDocument(): Promise<FileCredentialDocument> {
    try {
      const parsed = JSON.parse(await readFile(getHostedCredentialPath(this.io), 'utf8')) as Partial<FileCredentialDocument>;
      if (parsed.version === 1 && parsed.credentials && typeof parsed.credentials === 'object') {
        const credentials: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed.credentials)) {
          if (typeof value === 'string') credentials[key] = value;
        }
        return {
          version: 1,
          credentials,
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
        };
      }
    } catch {
      // Missing or malformed fallback storage starts empty. The main config still
      // holds only an opaque reference, so malformed fallback credentials surface
      // later as a missing credential rather than as config corruption.
    }
    return { version: 1, credentials: {}, updatedAt: new Date(0).toISOString() };
  }

  private async writeDocument(document: FileCredentialDocument): Promise<void> {
    const target = getHostedCredentialPath(this.io);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(temp, 0o600).catch(() => undefined);
      await rename(temp, target);
      await chmod(target, 0o600).catch(() => undefined);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

interface FileCredentialDocument {
  version: 1;
  credentials: Record<string, string>;
  updatedAt: string;
}

function validateCredentialReference(reference: string): void {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(reference)) {
    throw new Error('Hosted credential reference must be opaque and URL-safe.');
  }
}

export const _isMacOsKeychainAvailableForTest = isMacOsKeychainAvailable;
