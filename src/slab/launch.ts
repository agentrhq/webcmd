import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { ConfigError, SlabRequiredError } from '../errors.js';
import { SlabBridgeClient } from '../browser/runtime/local-slab/bridge-client.js';
import type { SlabHelloResult } from '../browser/runtime/local-slab/protocol.js';
import { findSlabInstallation, type SlabInstallation } from './installation.js';

const execFile = promisify(execFileCallback);

export interface SlabLaunchIo {
  findInstallation(): SlabInstallation | null;
  isRunning(executablePath: string): boolean | Promise<boolean>;
  launch(executablePath: string): Promise<void>;
  restart(executablePath: string): Promise<void>;
  hello(): Promise<SlabHelloResult>;
  wait(): Promise<void>;
}

export async function launchSlab(io: SlabLaunchIo = createSlabLaunchIo()): Promise<SlabHelloResult> {
  const installation = io.findInstallation();
  if (!installation) throw new SlabRequiredError();
  try {
    return await io.hello();
  } catch {
    if (await io.isRunning(installation.executablePath)) {
      await io.restart(installation.executablePath);
    } else {
      await io.launch(installation.executablePath);
    }
    await io.wait();
    try {
      return await io.hello();
    } catch {
      throw new ConfigError('SLAB bridge is unavailable.', 'Run `webcmd setup` to repair SLAB.');
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
  };
}
