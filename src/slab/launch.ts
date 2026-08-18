import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { ConfigError, SlabRequiredError } from '../errors.js';
import { SlabBridgeClient, SlabBridgeUnavailableError } from '../browser/runtime/local-slab/bridge-client.js';
import type { SlabHelloResult } from '../browser/runtime/local-slab/protocol.js';
import { findSlabInstallation, type SlabInstallation } from './installation.js';
import { SlabUpdateRequiredError } from '../errors.js';

const execFile = promisify(execFileCallback);

export interface SlabLaunchIo {
  findInstallation(): SlabInstallation | null;
  isRunning(executablePath: string): boolean | Promise<boolean>;
  launch(executablePath: string): Promise<void>;
  restart(executablePath: string): Promise<void>;
  hello(): Promise<SlabHelloResult>;
  wait(): Promise<void>;
  now(): number;
}

export async function launchSlab(io: SlabLaunchIo = createSlabLaunchIo()): Promise<SlabHelloResult> {
  const installation = io.findInstallation();
  if (!installation) throw new SlabRequiredError();
  try { return await io.hello(); } catch (error) {
    if (error instanceof SlabUpdateRequiredError || !(error instanceof SlabBridgeUnavailableError)) throw error;
  }
  if (await io.isRunning(installation.executablePath)) await io.restart(installation.executablePath);
  else await io.launch(installation.executablePath);

  const deadline = io.now() + 5_000;
  for (;;) {
    try { return await io.hello(); } catch (error) {
      if (error instanceof SlabUpdateRequiredError || !(error instanceof SlabBridgeUnavailableError)) throw error;
      if (io.now() >= deadline) throw new ConfigError('SLAB bridge is unavailable.', 'Run `webcmd setup` to repair SLAB.');
      await io.wait();
    }
  }
}

export function createSlabLaunchIo(): SlabLaunchIo {
  const client = new SlabBridgeClient();
  return {
    findInstallation: () => findSlabInstallation({ platform: process.platform, homeDir: homedir(), existsSync }),
    isRunning: async (executablePath) => execFile('pgrep', ['-f', executablePath]).then(() => true, () => false),
    launch: async (executablePath) => { await execFile('open', [dirname(dirname(dirname(executablePath)))]); },
    restart: async (executablePath) => {
      await execFile('pkill', ['-f', executablePath]).catch(() => {});
      await execFile('open', [dirname(dirname(dirname(executablePath)))]);
    },
    hello: () => client.hello('webcmd'),
    wait: () => new Promise((resolve) => setTimeout(resolve, 100)),
    now: Date.now,
  };
}
