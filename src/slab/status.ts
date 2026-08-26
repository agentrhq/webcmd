import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { SlabBridgeClient } from './bridge-client.js';
import { findSlabInstallation, slabControlEndpoint, type SlabInstallation } from './installation.js';
import type { SlabHelloResult } from './protocol.js';

export type SlabSetupStatus = 'preliminary-running' | 'installed-running' | 'installed-not-running' | 'not-installed';

export interface SlabStatusIo {
  findInstallation(): SlabInstallation | null;
  hello(): Promise<SlabHelloResult>;
}

export async function inspectSlabStatus(io: SlabStatusIo = createSlabStatusIo()): Promise<SlabSetupStatus> {
  const installation = io.findInstallation();
  try {
    await io.hello();
    return installation ? 'installed-running' : 'preliminary-running';
  } catch {
    return installation ? 'installed-not-running' : 'not-installed';
  }
}

export function createSlabStatusIo(): SlabStatusIo {
  const endpoint = slabControlEndpoint(homedir());
  return {
    findInstallation: () => findSlabInstallation({ platform: process.platform, homeDir: homedir(), existsSync }),
    hello: async () => {
      const client = await SlabBridgeClient.connect(endpoint, { timeoutMs: 1_000 });
      try {
        return await client.hello();
      } finally {
        await client.close();
      }
    },
  };
}
