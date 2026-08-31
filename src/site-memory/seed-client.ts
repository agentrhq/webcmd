import type { SeedLookupResult } from './model.js';

export interface GlobalSeedProvider {
  lookup(productKey: string, signal?: AbortSignal): Promise<SeedLookupResult>;
}

export const DEFAULT_GLOBAL_MEMORY_URL = 'https://api.webcmd.dev';
const LOOKUP_TIMEOUT_MS = 2000;

export function createHttpSeedProvider(options: {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
} = {}): GlobalSeedProvider {
  const fetchFn = options.fetch ?? fetch;
  const env = options.env ?? process.env;

  return {
    async lookup(productKey, signal) {
      if (env.WEBCMD_GLOBAL_MEMORY === 'off') return { status: 'unattempted' };

      const base = (env.WEBCMD_GLOBAL_MEMORY_URL ?? DEFAULT_GLOBAL_MEMORY_URL).replace(/\/+$/, '');
      const url = `${base}/v1/site-memory/seeds/${encodeURIComponent(productKey)}`;
      const timeout = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const response = await fetchFn(url, { method: 'GET', signal: combined, credentials: 'omit' });
        if (response.status === 404) return { status: 'absent' };
        if (!response.ok) return { status: 'lookup-failed' };
        return parseSeed(await response.json());
      } catch {
        return { status: 'lookup-failed' };
      }
    },
  };
}

function parseSeed(body: unknown): SeedLookupResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 'lookup-failed' };
  const { revision, site, references } = body as Record<string, unknown>;
  if (typeof revision !== 'string' || !revision || typeof site !== 'string') return { status: 'lookup-failed' };
  if (references === undefined) return { status: 'available', revision, site };
  if (!safeReferences(references)) return { status: 'lookup-failed' };
  return { status: 'available', revision, site, references };
}

function safeReferences(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, body]) => typeof body === 'string' && safeReferenceName(key));
}

function safeReferenceName(key: string): boolean {
  return Boolean(key) && !key.includes('/') && !key.includes('\\') && key !== '.' && key !== '..' && !key.startsWith('.');
}
