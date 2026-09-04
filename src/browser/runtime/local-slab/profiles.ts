import path from 'node:path';
import { CONFIG_DIR_NAME, ENV_PREFIX } from '../../../brand.js';
import os from 'node:os';

export interface SlabProfileDirOptions {
  baseDir?: string;
}

export function normalizeProfileId(value: string | undefined | null): string {
  const id = value?.trim() || 'default';
  if (/[/\\\0-\x1F\x7F]/.test(id) || id === '.' || id === '..') {
    throw new Error(`Invalid profile id: ${value ?? ''}`);
  }
  return id;
}

export function getWebcmdConfigDir(): string {
  return process.env[`${ENV_PREFIX}_CONFIG_DIR`] || path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function resolveSlabProfileDir(profileId: string, opts: SlabProfileDirOptions = {}): string {
  const safeProfileId = normalizeProfileId(profileId);
  return path.join(opts.baseDir ?? getWebcmdConfigDir(), 'slab', 'profiles', safeProfileId);
}
