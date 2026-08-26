import { homedir } from 'node:os';
import { SlabBridgeClient } from './bridge-client.js';
import { slabControlEndpoint } from './installation.js';
import { launchSlab } from './launch.js';
import type { SlabAttachResult } from './protocol.js';

export interface SlabControlBridge {
  attach(profileId: string): Promise<SlabAttachResult>;
  release(connectionId: string): Promise<void>;
}

export interface SlabControlBridgeIo {
  ensureLaunched(): Promise<unknown>;
  connect(): Promise<Pick<SlabBridgeClient, 'attach' | 'release' | 'close'>>;
}

export async function connectSlabControlBridge(io: SlabControlBridgeIo = createSlabControlBridgeIo()): Promise<SlabControlBridge> {
  await io.ensureLaunched();
  const client = await io.connect();
  return {
    attach: profileId => client.attach(profileId),
    release: async connectionId => {
      try {
        await client.release(connectionId);
      } finally {
        await client.close();
      }
    },
  };
}

export function createSlabControlBridgeIo(): SlabControlBridgeIo {
  return {
    ensureLaunched: launchSlab,
    connect: () => SlabBridgeClient.connect(slabControlEndpoint(homedir())),
  };
}
