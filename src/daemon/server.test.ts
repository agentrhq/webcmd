import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAEMON_HEADER_NAME } from '../constants.js';
import type { BrowserRuntimeCommand, BrowserRuntimeResult, BrowserRuntimeStatus } from '../browser/protocol.js';
import type { BrowserRuntimeProvider } from '../browser/runtime/provider.js';
import { createDaemonServer } from './server.js';

class FakeProvider implements BrowserRuntimeProvider {
  commands: BrowserRuntimeCommand[] = [];
  shutdownCalled = false;
  delayMs = 0;
  dispatchImpl?: (command: BrowserRuntimeCommand) => Promise<BrowserRuntimeResult>;
  resolveProfileId?: (command: BrowserRuntimeCommand) => string;

  private result(command: BrowserRuntimeCommand) {
    return { id: command.id, ok: true as const, data: { action: command.action }, page: 'page-1' };
  }

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
    this.commands.push(command);
    if (this.dispatchImpl) return this.dispatchImpl(command);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.result(command);
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

  function postCommand(baseUrl: string, body: Partial<BrowserRuntimeCommand> & Pick<BrowserRuntimeCommand, 'id' | 'action'>) {
    return fetch(`${baseUrl}/command`, {
      method: 'POST',
      headers: { [DAEMON_HEADER_NAME]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function persistentWrite(
    id: string,
    runId: string,
    overrides: Partial<BrowserRuntimeCommand> = {},
  ): BrowserRuntimeCommand {
    return {
      id,
      action: 'exec',
      code: '1',
      surface: 'adapter',
      siteSession: 'persistent',
      access: 'write',
      session: 'site:example',
      runId,
      command: 'example write',
      pid: 4242,
      ...overrides,
    };
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

  it('rejects a second persistent adapter writer for the same resolved profile and session', async () => {
    const provider = new FakeProvider();
    provider.resolveProfileId = () => 'resolved-work';
    const { baseUrl } = await start(provider);

    const first = await postCommand(baseUrl, persistentWrite('first', 'run_100_1_1'));
    expect(first.status).toBe(200);

    const second = await postCommand(baseUrl, persistentWrite('second', 'run_200_2_2'));
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      ok: false,
      code: 'session_busy',
      holder: {
        command: 'example write',
        pid: 4242,
        acquiredAt: expect.any(Number),
        heartbeatAt: expect.any(Number),
      },
    });
    expect(provider.commands.map((command) => command.id)).toEqual(['first']);
  });

  it('lets one logical run issue multiple operations and heartbeat its lease', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { provider, baseUrl } = await start();

    expect((await postCommand(baseUrl, persistentWrite('first', 'run_100_1_1'))).status).toBe(200);
    now = 20_000;
    expect((await postCommand(baseUrl, persistentWrite('second', 'run_100_1_1'))).status).toBe(200);

    const status = await fetch(`${baseUrl}/status`, { headers: { [DAEMON_HEADER_NAME]: '1' } });
    await expect(status.json()).resolves.toMatchObject({
      sessionLeases: [{
        key: 'default␟adapter␟site%3Aexample',
        command: 'example write',
        acquiredAt: 1_000,
        heartbeatAt: 20_000,
      }],
    });
    expect(provider.commands.map((command) => command.id)).toEqual(['first', 'second']);
  });

  it.each([
    ['read access', { access: 'read' as const }],
    ['ephemeral sessions', { siteSession: 'ephemeral' as const }],
    ['raw browser surface', { surface: 'browser' as const }],
    ['different sites', { session: 'site:other' }],
    ['different resolved profiles', { profileId: 'other' }],
  ])('does not conflict across %s', async (_case, overrides) => {
    const provider = new FakeProvider();
    provider.resolveProfileId = (command) => command.profileId ?? 'default';
    const { baseUrl } = await start(provider);

    expect((await postCommand(baseUrl, persistentWrite('owner', 'run_100_1_1'))).status).toBe(200);
    expect((await postCommand(baseUrl, persistentWrite('other', 'run_200_2_2', overrides))).status).toBe(200);
    expect(provider.commands.map((command) => command.id)).toEqual(['owner', 'other']);
  });

  it('keeps pending holders live past the TTL and heartbeats them before pending removal', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let settle: (() => void) | undefined;
    const provider = new FakeProvider();
    provider.dispatchImpl = (command) => new Promise((resolve) => {
      settle = () => resolve({ id: command.id, ok: true, data: 'done' });
    });
    const { baseUrl } = await start(provider);

    const pending = postCommand(baseUrl, persistentWrite('pending', 'run_100_1_1'));
    try {
      await vi.waitFor(() => expect(provider.commands).toHaveLength(1));
      now = 46_001;

      const whilePending = await fetch(`${baseUrl}/status`, { headers: { [DAEMON_HEADER_NAME]: '1' } });
      await expect(whilePending.json()).resolves.toMatchObject({
        sessionLeases: [{ command: 'example write', heartbeatAt: 1_000 }],
      });
      const conflict = await postCommand(baseUrl, persistentWrite('conflict', 'run_200_2_2'));
      expect(conflict.status).toBe(409);
      expect(provider.commands).toHaveLength(1);

      now = 50_000;
      settle?.();
      expect((await pending).status).toBe(200);
      const afterSettle = await fetch(`${baseUrl}/status`, { headers: { [DAEMON_HEADER_NAME]: '1' } });
      const statusBody = await afterSettle.json() as { sessionLeases: Array<Record<string, unknown>> };
      expect(statusBody.sessionLeases).toEqual([expect.objectContaining({ heartbeatAt: 50_000 })]);
      expect(statusBody.sessionLeases[0]).not.toHaveProperty('runId');
    } finally {
      settle?.();
      await pending.catch(() => undefined);
    }
  });

  it('handles lease-release locally and permits a new owner', async () => {
    const { provider, baseUrl } = await start();
    expect((await postCommand(baseUrl, persistentWrite('owner', 'run_100_1_1'))).status).toBe(200);

    const released = await postCommand(baseUrl, {
      id: 'release',
      action: 'lease-release',
      runId: 'run_100_1_1',
    });
    expect(released.status).toBe(200);
    await expect(released.json()).resolves.toMatchObject({
      id: 'release',
      ok: true,
      data: { released: 1 },
    });
    expect(provider.commands.map((command) => command.id)).toEqual(['owner']);

    expect((await postCommand(baseUrl, persistentWrite('next-owner', 'run_200_2_2'))).status).toBe(200);
    expect(provider.commands.map((command) => command.id)).toEqual(['owner', 'next-owner']);
  });

  it('returns only sanitized current holders from status', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { baseUrl } = await start();
    expect((await postCommand(baseUrl, persistentWrite('owner', 'run_100_1_1'))).status).toBe(200);

    const current = await fetch(`${baseUrl}/status`, { headers: { [DAEMON_HEADER_NAME]: '1' } });
    const currentBody = await current.json() as { sessionLeases: Array<Record<string, unknown>> };
    expect(currentBody.sessionLeases).toHaveLength(1);
    expect(currentBody.sessionLeases[0]).not.toHaveProperty('runId');

    now = 46_001;
    const expired = await fetch(`${baseUrl}/status`, { headers: { [DAEMON_HEADER_NAME]: '1' } });
    await expect(expired.json()).resolves.toMatchObject({ sessionLeases: [] });
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
