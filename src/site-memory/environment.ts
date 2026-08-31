import { isIP } from 'node:net';
import * as os from 'node:os';
import { PKG_VERSION } from '../version.js';
import type { CandidateEnvironment } from './model.js';

const PUBLIC_IP_TIMEOUT_MS = 2000;
const PUBLIC_IP_URL = 'https://api.ipify.org';

export interface CollectEnvironmentOptions {
  machine?: boolean;
  localIp?: boolean;
  publicIp?: boolean;
  os?: boolean;
  browserVersion?: string | false;
  webcmdVersion?: string | false;
  fetch?: typeof fetch;
  hostname?: () => string;
}

export async function collectEnvironment(options: CollectEnvironmentOptions = {}): Promise<CandidateEnvironment> {
  const env: CandidateEnvironment = {};
  if (options.machine !== false) {
    try { env.machine = (options.hostname ?? os.hostname)(); } catch {}
  }
  if (options.localIp !== false) {
    try {
      const localIp = firstLocalIp();
      if (localIp) env.localIp = localIp;
    } catch {}
  }
  if (options.os !== false) {
    try { env.os = `${os.type()} ${os.release()}`; } catch {}
  }
  if (typeof options.browserVersion === 'string') env.browserVersion = options.browserVersion;
  if (options.webcmdVersion !== false) {
    env.webcmdVersion = typeof options.webcmdVersion === 'string' ? options.webcmdVersion : PKG_VERSION;
  }
  if (options.publicIp !== false) {
    const publicIp = await lookupPublicIp(options.fetch ?? fetch);
    if (publicIp) env.publicIp = publicIp;
  }
  return env;
}

function firstLocalIp(): string | undefined {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry.internal && entry.family === 'IPv4') return entry.address;
    }
  }
}

async function lookupPublicIp(fetchFn: typeof fetch): Promise<string | undefined> {
  try {
    const response = await fetchFn(PUBLIC_IP_URL, { signal: AbortSignal.timeout(PUBLIC_IP_TIMEOUT_MS) });
    if (!response.ok) return;
    const value = (await response.text()).trim();
    return isIP(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
