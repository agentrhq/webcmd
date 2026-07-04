import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAEMON_HEADER_NAME } from '../constants.js';
import type { BrowserRuntimeCommand, BrowserRuntimeStatus } from '../browser/protocol.js';
import type { BrowserRuntimeProvider } from '../browser/runtime/provider.js';
import { createDaemonServer } from './server.js';

class FakeProvider implements BrowserRuntimeProvider {
  commands: BrowserRuntimeCommand[] = [];
  shutdownCalled = false;
  delayMs = 0;

  async status(): Promise<BrowserRuntimeStatus> {
    return {
      runtimeConnected: true,
      runtimeName: 'fake',
      runtimeVersion: '1.2.3',
      profiles: [{ contextId: 'default', runtimeConnected: true, runtimeVersion: '1.2.3', pending: 0 }],
      pending: 0,
      commandResultUnknown: 0,
    };
  }

  async dispatch(command: BrowserRuntimeCommand) {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.commands.push(command);
    return { id: command.id, ok: true, data: { action: command.action }, page: 'page-1' };
  }

  async shutdown() {
    this.shutdownCalled = true;
  }
}

describe('createDaemonServer', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
  });

  async function start(provider = new FakeProvider()) {
    const daemon = createDaemonServer(provider, { port: 0, host: '127.0.0.1', version: 'test' });
    await daemon.listen();
    servers.push(daemon);
    const address = daemon.server.address() as AddressInfo;
    return { provider, baseUrl: `http://127.0.0.1:${address.port}` };
  }

  it('returns runtime-named status fields without extension aliases', async () => {
    const { baseUrl } = await start();
    const res = await fetch(`${baseUrl}/status`, { headers: { [DAEMON_HEADER_NAME]: '1' } });
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      runtimeConnected: true,
      runtimeName: 'fake',
      runtimeVersion: '1.2.3',
      profiles: [{ contextId: 'default', runtimeConnected: true }],
    });
    expect(body).not.toHaveProperty(`extension${'Connected'}`);
    expect(body).not.toHaveProperty(`extension${'Version'}`);
  });

  it('dispatches /command through the provider', async () => {
    const { provider, baseUrl } = await start();
    const res = await fetch(`${baseUrl}/command`, {
      method: 'POST',
      headers: { [DAEMON_HEADER_NAME]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'cmd-1', action: 'navigate', session: 'work', url: 'https://example.com' }),
    });
    await expect(res.json()).resolves.toEqual({
      id: 'cmd-1',
      ok: true,
      data: { action: 'navigate' },
      page: 'page-1',
    });
    expect(provider.commands).toHaveLength(1);
    expect(provider.commands[0]).toMatchObject({ id: 'cmd-1', action: 'navigate', session: 'work' });
  });

  it('clears custom command timeout timers after successful provider dispatch', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const { baseUrl } = await start();
      const res = await fetch(`${baseUrl}/command`, {
        method: 'POST',
        headers: { [DAEMON_HEADER_NAME]: '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'fast-custom-timeout', action: 'navigate', session: 'work', timeout: 60 }),
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        id: 'fast-custom-timeout',
        ok: true,
      });

      const timeoutCallIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 60_000);
      expect(timeoutCallIndex).toBeGreaterThanOrEqual(0);
      const commandTimeoutHandle = setTimeoutSpy.mock.results[timeoutCallIndex]?.value;
      expect(clearTimeoutSpy).toHaveBeenCalledWith(commandTimeoutHandle);
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it('uses deadlineAt as the command timeout budget when present', async () => {
    const now = 1_763_000_000_000;
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const { baseUrl } = await start();
      const res = await fetch(`${baseUrl}/command`, {
        method: 'POST',
        headers: { [DAEMON_HEADER_NAME]: '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'deadline-command',
          action: 'exec',
          session: 'work',
          timeout: 120,
          deadlineAt: now + 12_345,
        }),
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        id: 'deadline-command',
        ok: true,
      });
      expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 12_345)).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
      dateSpy.mockRestore();
    }
  });

  it('attaches duplicate command ids to the in-flight dispatch instead of re-dispatching', async () => {
    const provider = new FakeProvider();
    provider.delayMs = 50;
    const { baseUrl } = await start(provider);
    const body = JSON.stringify({ id: 'same-id', action: 'exec', session: 'work', code: '1' });

    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/command`, {
        method: 'POST',
        headers: { [DAEMON_HEADER_NAME]: '1', 'Content-Type': 'application/json' },
        body,
      }),
      fetch(`${baseUrl}/command`, {
        method: 'POST',
        headers: { [DAEMON_HEADER_NAME]: '1', 'Content-Type': 'application/json' },
        body,
      }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ id: 'same-id', ok: true });
    await expect(second.json()).resolves.toMatchObject({ id: 'same-id', ok: true });
    expect(provider.commands).toHaveLength(1);
  });

  it('requires X-Webcmd on non-ping endpoints', async () => {
    const { baseUrl } = await start();
    const res = await fetch(`${baseUrl}/status`);
    expect(res.status).toBe(403);
  });

  it('records daemon logs through /logs', async () => {
    const { baseUrl } = await start();
    const res = await fetch(`${baseUrl}/logs`, { headers: { [DAEMON_HEADER_NAME]: '1' } });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, logs: expect.any(Array) });
  });

  it('times out slow provider commands and clears pending state', async () => {
    const provider = new FakeProvider();
    provider.delayMs = 100;
    const { baseUrl } = await start(provider);
    const res = await fetch(`${baseUrl}/command`, {
      method: 'POST',
      headers: { [DAEMON_HEADER_NAME]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'slow', action: 'exec', session: 'work', timeout: 0.01 }),
    });
    expect(res.status).toBe(408);
    await expect(res.json()).resolves.toMatchObject({
      id: 'slow',
      ok: false,
      errorCode: 'command_result_unknown',
    });
  });

  it('calls provider shutdown before closing', async () => {
    const { provider, baseUrl } = await start();
    const res = await fetch(`${baseUrl}/shutdown`, {
      method: 'POST',
      headers: { [DAEMON_HEADER_NAME]: '1' },
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(provider.shutdownCalled).toBe(true));
  });
});
