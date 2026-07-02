import { describe, expect, it } from 'vitest';
import '../protocol.js';
import './provider.js';
import type { BrowserRuntimeCommand } from '../protocol.js';
import type { BrowserRuntimeProvider } from './provider.js';

class EchoProvider implements BrowserRuntimeProvider {
  async status() {
    return {
      runtimeConnected: true,
      runtimeName: 'fake',
      runtimeVersion: 'test',
      profiles: [{ contextId: 'default', runtimeConnected: true, pending: 0 }],
      pending: 0,
    };
  }

  async dispatch(command: BrowserRuntimeCommand) {
    return {
      id: command.id,
      ok: true,
      data: { action: command.action, session: command.session },
      page: command.page ?? 'page-1',
    };
  }

  async shutdown() {
    return undefined;
  }
}

describe('BrowserRuntimeProvider contract', () => {
  it('uses runtime-named status fields and the existing result envelope', async () => {
    const provider = new EchoProvider();
    await expect(provider.status()).resolves.toMatchObject({
      runtimeConnected: true,
      runtimeName: 'fake',
      profiles: [{ contextId: 'default', runtimeConnected: true }],
    });

    await expect(provider.dispatch({
      id: 'cmd-1',
      action: 'navigate',
      session: 'work',
      surface: 'browser',
      url: 'https://example.com',
      contextId: 'default',
      profileId: 'default',
    })).resolves.toEqual({
      id: 'cmd-1',
      ok: true,
      data: { action: 'navigate', session: 'work' },
      page: 'page-1',
    });
  });
});
