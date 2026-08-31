import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { ConfigError } from '../errors.js';
import { SlabBridgeClient, SlabProtocolError } from './bridge-client.js';
import { findSlabInstallation, slabControlEndpoint, type SlabInstallation } from './installation.js';
import type { SlabHelloResult } from './protocol.js';

const execFile = promisify(execFileCallback);
const CONTROL_READY_TIMEOUT_MS = 5_000;

export interface SlabLaunchIo {
  findInstallation(): SlabInstallation | null;
  isRunning(appPath: string): boolean | Promise<boolean>;
  launch(appPath: string): Promise<void>;
  hello(): Promise<SlabHelloResult>;
  wait(): Promise<void>;
  now(): number;
}

function isControlUnavailable(error: unknown): boolean {
  if (error instanceof SlabProtocolError) return false;
  return !(error instanceof Error && error.message.startsWith('SLAB control response'));
}

export async function launchSlab(io: SlabLaunchIo = createSlabLaunchIo()): Promise<SlabHelloResult> {
  try {
    return await io.hello();
  } catch (error) {
    if (!isControlUnavailable(error)) throw error;
  }

  const installation = io.findInstallation();
  if (!installation) {
    throw new ConfigError('SLAB is not installed and its control endpoint is unavailable.', 'Open a preliminary SLAB build, or install the official SLAB.app.');
  }
  if (!await io.isRunning(installation.appPath)) await io.launch(installation.appPath);

  const deadline = io.now() + CONTROL_READY_TIMEOUT_MS;
  for (;;) {
    try {
      return await io.hello();
    } catch (error) {
      if (!isControlUnavailable(error)) throw error;
      if (io.now() >= deadline) throw new ConfigError('SLAB control endpoint did not become ready within five seconds.', 'Open SLAB and retry the browser command.');
      await io.wait();
    }
  }
}

export function createSlabLaunchIo(): SlabLaunchIo {
  const endpoint = slabControlEndpoint(homedir());
  return {
    findInstallation: () => findSlabInstallation({ platform: process.platform, homeDir: homedir(), existsSync }),
    isRunning: async () => execFile('pgrep', ['-x', 'SLAB']).then(() => true, () => false),
    launch: async appPath => { await execFile('open', [appPath]); },
    hello: async () => {
      const client = await SlabBridgeClient.connect(endpoint, { timeoutMs: 1_000 });
      try {
        return await client.hello();
      } finally {
        await client.close();
      }
    },
    wait: () => new Promise(resolve => setTimeout(resolve, 100)),
    now: Date.now,
  };
}
