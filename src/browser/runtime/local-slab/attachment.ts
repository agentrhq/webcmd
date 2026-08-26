import { chromium, type Browser, type BrowserContext, type ConnectOverCDPTransport } from 'playwright-core';
import { CdpIpcTransport } from '../../../slab/cdp-ipc-transport.js';
import type { SlabAttachResult } from '../../../slab/protocol.js';

export interface AttachedSlabProfile {
  profileId: string;
  browserVersion: string;
  context: BrowserContext;
  browser: Browser;
  release(): Promise<void>;
}

export type SlabAttachment = SlabAttachResult;

export interface SlabBridge {
  attach(profileId: string): Promise<SlabAttachment>;
  release(connectionId: string): Promise<void>;
}

export interface AttachSlabProfileOptions {
  bridge?: SlabBridge;
  connectOverCDP?: typeof chromium.connectOverCDP;
  connectTransport?: typeof CdpIpcTransport.connect;
  attachTimeoutMs?: number;
}

export async function attachSlabProfile(profileId: string, options: AttachSlabProfileOptions = {}): Promise<AttachedSlabProfile> {
  const bridge = options.bridge;
  if (!bridge) throw new Error('SLAB control client is not available.');
  const attachment = await bridge.attach(profileId);
  const attachTimeoutMs = options.attachTimeoutMs ?? 30_000;
  let transport: ConnectOverCDPTransport | undefined;
  try {
    transport = await (options.connectTransport ?? CdpIpcTransport.connect)({ ...attachment.transport, timeoutMs: attachTimeoutMs });
    const browser = await (options.connectOverCDP ?? chromium.connectOverCDP.bind(chromium))(transport, { timeout: attachTimeoutMs });
    const context = browser.contexts()[0];
    if (!context) throw new Error('SLAB attachment returned no persistent browser context.');
    return {
      profileId: attachment.profile.id,
      browserVersion: browser.version(),
      context,
      browser,
      release: () => bridge.release(attachment.connectionId),
    };
  } catch (error) {
    transport?.close();
    await bridge.release(attachment.connectionId).catch(() => {});
    throw error;
  }
}
