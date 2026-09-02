import path from 'node:path';
import { CONFIG_DIR_NAME, ENV_PREFIX } from '../../../brand.js';
import os from 'node:os';

export interface CloakProfileDirOptions {
  baseDir?: string;
}

export function normalizeProfileId(value: string | undefined | null): string {
  const id = value?.trim() || 'default';
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') {
    throw new Error(`Invalid profile id: ${value ?? ''}`);
  }
  return id;
}

export function getWebcmdConfigDir(): string {
  return process.env[`${ENV_PREFIX}_CONFIG_DIR`] || path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function resolveCloakProfileDir(profileId: string, opts: CloakProfileDirOptions = {}): string {
  const safeProfileId = normalizeProfileId(profileId);
  return path.join(opts.baseDir ?? getWebcmdConfigDir(), 'cloak', 'profiles', safeProfileId);
}
