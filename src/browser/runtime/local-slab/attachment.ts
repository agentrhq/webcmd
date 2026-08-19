import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { SlabBridgeClient } from './bridge-client.js';

export interface AttachedSlabProfile {
  profileId: string;
  browserVersion: string;
  context: BrowserContext;
  browser: Browser;
  release(): Promise<void>;
}

export interface AttachSlabProfileOptions {
  bridge?: Pick<SlabBridgeClient, 'attach' | 'release'>;
  connectOverCDP?: typeof chromium.connectOverCDP;
}

export async function attachSlabProfile(profileId: string, options: AttachSlabProfileOptions = {}): Promise<AttachedSlabProfile> {
  const bridge = options.bridge ?? new SlabBridgeClient();
  const attachment = await bridge.attach(profileId);
  try {
    const browser = await (options.connectOverCDP ?? chromium.connectOverCDP)(attachment.cdpUrl, {
      headers: { Authorization: `Bearer ${attachment.bearerToken}` },
    });
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
    await bridge.release(attachment.connectionId).catch(() => {});
    throw error;
  }
}
