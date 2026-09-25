import { chromium, type Browser, type BrowserContext, type ConnectOverCDPTransport } from 'playwright-core';
import { CdpIpcTransport } from '../../../slab/cdp-ipc-transport.js';
import type { SlabAttachResult } from '../../../slab/protocol.js';
import { connectSlabControlBridge, type SlabControlBridge } from '../../../slab/control-bridge.js';

export interface AttachedSlabProfile {
  profileId: string;
  browserVersion: string;
  context: BrowserContext;
  browser: Browser;
  closeTransport(): void;
  release(): Promise<void>;
}

export type SlabAttachment = SlabAttachResult;

export type SlabBridge = SlabControlBridge;

export interface AttachSlabProfileOptions {
  bridge?: SlabBridge;
  connectBridge?: () => Promise<SlabBridge>;
  connectOverCDP?: typeof chromium.connectOverCDP;
  connectTransport?: typeof CdpIpcTransport.connect;
  attachTimeoutMs?: number;
}

export async function attachSlabProfile(profileId: string, options: AttachSlabProfileOptions = {}): Promise<AttachedSlabProfile> {
  const bridge = options.bridge ?? await (options.connectBridge ?? connectSlabControlBridge)();
  let attachment: SlabAttachResult;
  try {
    attachment = await bridge.attach(profileId);
  } catch (error) {
    await bridge.close().catch(() => {});
    throw error;
  }
  const attachTimeoutMs = options.attachTimeoutMs ?? 30_000;
  let transport: ConnectOverCDPTransport | undefined;
  try {
    transport = await (options.connectTransport ?? CdpIpcTransport.connect)({ ...attachment.transport, timeoutMs: attachTimeoutMs });
    const browser = await (options.connectOverCDP ?? chromium.connectOverCDP.bind(chromium))(transport, { timeout: attachTimeoutMs });
    const context = browser.contexts()[0];
    if (!context) throw new Error('SLAB attachment returned no persistent browser context.');
    const connectedTransport = transport;
    let closed = false;
    const closeLocal = async () => {
      if (closed) return;
      closed = true;
      connectedTransport.close();
      await bridge.close().catch(() => {});
    };
    return {
      profileId: attachment.profile.id,
      browserVersion: browser.version(),
      context,
      browser,
      closeTransport: () => { void closeLocal(); },
      release: async () => {
        if (closed) return;
        connectedTransport.close();
        try {
          await bridge.release(attachment.connectionId);
        } finally {
          closed = true;
          await bridge.close().catch(() => {});
        }
      },
    };
  } catch (error) {
    transport?.close();
    try {
      await bridge.release(attachment.connectionId).catch(() => {});
    } finally {
      await bridge.close().catch(() => {});
    }
    throw error;
  }
}
