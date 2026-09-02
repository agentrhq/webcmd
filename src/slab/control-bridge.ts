import { homedir } from 'node:os';
import { SlabBridgeClient } from './bridge-client.js';
import { slabControlEndpoint } from './installation.js';
import { launchSlab } from './launch.js';
import type { SlabAttachResult, SlabCreateProfileResult } from './protocol.js';

export interface SlabControlBridge {
  attach(profileId: string): Promise<SlabAttachResult>;
  release(connectionId: string): Promise<void>;
  close(): Promise<void>;
}

export interface SlabControlBridgeIo {
  ensureLaunched(): Promise<unknown>;
  connect(): Promise<Pick<SlabBridgeClient, 'hello' | 'attach' | 'release' | 'close'>>;
}

export async function connectSlabControlBridge(io: SlabControlBridgeIo = createSlabControlBridgeIo()): Promise<SlabControlBridge> {
  await io.ensureLaunched();
  const client = await io.connect();
  try {
    await client.hello();
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
  return {
    attach: profileId => client.attach(profileId),
    release: async connectionId => {
      try {
        await client.release(connectionId);
      } finally {
        await client.close();
      }
    },
    close: () => client.close(),
  };
}

export function createSlabControlBridgeIo(): SlabControlBridgeIo {
  return {
    ensureLaunched: launchSlab,
    connect: () => SlabBridgeClient.connect(slabControlEndpoint(homedir())),
  };
}

/** Profile creation deliberately owns a short-lived control connection. */
export async function ensureSlabProfile(
  input: { alias: string; idempotencyKey: string },
  connect: () => Promise<SlabBridgeClient> = () => SlabBridgeClient.connect(slabControlEndpoint(homedir())),
): Promise<SlabCreateProfileResult> {
  const client = await connect();
  try {
    await client.hello();
    return await client.createProfile(input.alias, input.idempotencyKey);
  } finally {
    await client.close();
  }
}
