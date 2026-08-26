import { chromium, type Browser, type BrowserContext } from 'playwright-core';

export interface AttachedSlabProfile {
  profileId: string;
  browserVersion: string;
  context: BrowserContext;
  browser: Browser;
  release(): Promise<void>;
}

export interface SlabAttachment {
  connectionId: string;
  profile: { id: string; displayName: string };
  cdpUrl: string;
  bearerToken: string;
  expiresAt: string;
}

export interface SlabBridge {
  attach(profileId: string): Promise<SlabAttachment>;
  release(connectionId: string): Promise<void>;
}

export interface AttachSlabProfileOptions {
  bridge?: SlabBridge;
  connectOverCDP?: typeof chromium.connectOverCDP;
}

export async function attachSlabProfile(profileId: string, options: AttachSlabProfileOptions = {}): Promise<AttachedSlabProfile> {
  const bridge = options.bridge;
  if (!bridge) throw new Error('SLAB control client is not available.');
  const attachment = await bridge.attach(profileId);
  try {
    const browser = await (options.connectOverCDP ?? chromium.connectOverCDP.bind(chromium))(attachment.cdpUrl, {
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
