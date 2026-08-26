import fs from 'node:fs';
import { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAEMON_HEADER_NAME } from '../../../constants.js';
import { createDaemonServer } from '../../../daemon/server.js';
import type { BrowserRuntimeProvider } from '../provider.js';

function fakeAttachedProfile() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const pageListeners = new WeakMap<object, Map<string, Set<(...args: unknown[]) => void>>>();
  const targetIds = new WeakMap<object, string>();
  const windowIds = new Map<string, number>();
  let targetCounter = 0;
  let windowCounter = 0;
  let context: any;
  const fakePage = () => {
    let closed = false;
    const page: any = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue('ok'),
      title: vi.fn().mockResolvedValue('Title'),
      url: vi.fn(() => 'https://example.com/'),
      bringToFront: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn(() => closed),
      close: vi.fn(async () => {
        closed = true;
      }),
      opener: vi.fn().mockResolvedValue(null),
      on(event: string, listener: (...args: unknown[]) => void) {
        const events = pageListeners.get(page) ?? new Map();
        const bucket = events.get(event) ?? new Set();
        bucket.add(listener);
        events.set(event, bucket);
        pageListeners.set(page, events);
      },
      once(event: string, listener: (...args: unknown[]) => void) {
        const once = (...args: unknown[]) => {
          page.off(event, once);
          listener(...args);
        };
        page.on(event, once);
      },
      off(event: string, listener: (...args: unknown[]) => void) {
        pageListeners.get(page)?.get(event)?.delete(listener);
      },
    };
    targetIds.set(page, `target-${++targetCounter}`);
    windowIds.set(targetIds.get(page)!, ++windowCounter);
    return page;
  };
  const page = fakePage();
  const allPages = [page];
  const cdp = {
    send: vi.fn(async (command: string, params?: { targetId?: string; hidden?: boolean }) => {
      if (command === 'Target.createTarget') {
        const created = fakePage();
        allPages.push(created);
        queueMicrotask(() => {
          for (const listener of listeners.get('page') ?? []) listener(created);
        });
        return { targetId: targetIds.get(created) };
      }
      if (command === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
      if (command === 'Target.closeTarget') return { success: true };
      return {};
    }),
    on: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    newBrowserCDPSession: vi.fn().mockResolvedValue(cdp),
    contexts: vi.fn(() => [context]),
    version: vi.fn(() => '146.0'),
  };
  context = {
    on(event: string, listener: (...args: unknown[]) => void) {
      const bucket = listeners.get(event) ?? new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
    pages: vi.fn(() => allPages.filter((candidate) => !candidate.isClosed())),
    newPage: vi.fn(async () => {
      const created = fakePage();
      allPages.push(created);
      return created;
    }),
    newCDPSession: vi.fn(async (target: object) => ({
      send: vi.fn(async (command: string, params?: { targetId?: string }) => {
        if (command === 'Target.getTargetInfo') return { targetInfo: { targetId: targetIds.get(target) } };
        if (command === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
        return {};
      }),
      detach: vi.fn().mockResolvedValue(undefined),
    })),
    browser: vi.fn(() => browser),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    profileId: 'default',
    browserVersion: '146.0',
    context,
    browser,
    closeTransport: vi.fn(),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

describe('local browser runtime selection', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
  });

  it('uses the local-slab manager factory and releases the SLAB lease on daemon shutdown without quitting the browser', async () => {
    const daemonSource = fs.readFileSync(fileURLToPath(new URL('../../../daemon.ts', import.meta.url)), 'utf8');
    expect(daemonSource).toContain("from './browser/runtime/local-slab/provider.js'");
    expect(daemonSource).toContain('createLocalBrowserRuntimeProvider');

    const { createLocalBrowserRuntimeProvider, LocalSlabRuntimeProvider } = await import('./provider.js');
    const attached = fakeAttachedProfile();
    const quitApp = vi.fn();
    const provider = createLocalBrowserRuntimeProvider({
      attachProfile: vi.fn().mockResolvedValue(attached),
    });
    expect(provider).toBeInstanceOf(LocalSlabRuntimeProvider);

    const daemon = createDaemonServer(provider as BrowserRuntimeProvider, {
      port: 0,
      host: '127.0.0.1',
      version: 'test',
    });
    await daemon.listen();
    servers.push(daemon);
    const address = daemon.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const created = await fetch(`${baseUrl}/command`, {
      method: 'POST',
      headers: { [DAEMON_HEADER_NAME]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'create', action: 'session-create', contextId: 'default' }),
    }).then((res) => res.json()) as { data: { id: string } };

    await fetch(`${baseUrl}/command`, {
      method: 'POST',
      headers: { [DAEMON_HEADER_NAME]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'navigate',
        action: 'navigate',
        contextId: 'default',
        session: created.data.id,
        url: 'https://example.com/',
        surface: 'browser',
      }),
    });

    await daemon.close();

    expect(attached.release).toHaveBeenCalledOnce();
    expect(attached.browser.close).not.toHaveBeenCalled();
    expect(attached.context.close).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
  });
});
