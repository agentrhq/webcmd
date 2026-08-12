import { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAEMON_HEADER_NAME } from '../constants.js';
import type { BrowserRuntimeCommand, BrowserRuntimeResult, BrowserRuntimeStatus } from '../browser/protocol.js';
import type { BrowserSessionListRow, BrowserSessionRecord } from '../browser/sessions.js';
import type { BrowserRuntimeProvider } from '../browser/runtime/provider.js';
import { createDaemonServer } from './server.js';

class FakeProvider implements BrowserRuntimeProvider {
  commands: BrowserRuntimeCommand[] = [];
  sessions: BrowserSessionRecord[] = [];
  activeSessions = new Set<string>();
  foregroundedSessions: string[] = [];
  shutdownCalled = false;
  delayMs = 0;
  dispatchImpl?: (command: BrowserRuntimeCommand, signal?: AbortSignal) => Promise<BrowserRuntimeResult>;
  resolveProfileId?: (command: BrowserRuntimeCommand) => string;
  sessionId = 'session_11111111-1111-4111-8111-111111111111';

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
      sessions: this.listSessionRows(),
    };
  }

  async createSession(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    const profileId = command.contextId ?? 'default';
    const session = {
      id: this.sessionId,
      profileId,
      kind: 'explicit' as const,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      lastUsedAt: '2026-08-11T00:00:00.000Z',
    };
    this.sessions.push(session);
    return session;
  }

  async listSessions(input: { profileId?: string }): Promise<BrowserSessionListRow[]> {
    return this.listSessionRows(input.profileId);
  }

  async closeSession(command: BrowserRuntimeCommand): Promise<{ closed: boolean; alreadyIdle: boolean; session: string }> {
    const session = String(command.session);
    const wasActive = this.activeSessions.delete(session);
    return { closed: wasActive, alreadyIdle: !wasActive, session };
  }

  async requireSession(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    const profileId = command.contextId ?? 'default';
    const existing = this.sessions.find((session) => session.profileId === profileId && session.id === command.session);
    if (existing) return existing;
    return {
      id: String(command.session),
      profileId,
      kind: command.session === 'session_default' ? 'adapter-default' : 'explicit',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      lastUsedAt: '2026-08-11T00:00:00.000Z',
    };
  }

  async resolveAdapterDefault(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    return {
      ...await this.requireSession({ ...command, session: command.session ?? 'session_default' }),
      kind: 'adapter-default',
    };
  }

  async startSessionHandoff(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    const record = await this.requireSession(command);
    record.handoff = { site: String(command.site), expiresAt: String(command.expiresAt) };
    const index = this.sessions.findIndex((session) => session.profileId === record.profileId && session.id === record.id);
    if (index === -1) this.sessions.push(record);
    else this.sessions[index] = record;
    this.foregroundedSessions.push(record.id);
    return record;
  }

  async clearSessionHandoff(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    const record = await this.requireSession(command);
    delete record.handoff;
    return record;
  }

  async dispatch(command: BrowserRuntimeCommand, signal?: AbortSignal) {
    this.commands.push(command);
    if (this.dispatchImpl) return this.dispatchImpl(command, signal);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.result(command);
  }

  async shutdown() {
    this.shutdownCalled = true;
  }

  private listSessionRows(profileId?: string): BrowserSessionListRow[] {
    return this.sessions
      .filter((session) => profileId === undefined || session.profileId === profileId)
      .map((session) => ({
        ...session,
        runtimeState: this.activeSessions.has(session.id) ? 'active' as const : 'idle' as const,
      }));
  }
}

describe('createDaemonServer', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  beforeEach(() => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  function adapterCommand(
    id: string,
    runId: string,
    adapterSite: string,
    session?: string,
  ): BrowserRuntimeCommand {
    return persistentWrite(id, runId, {
      adapterSite,
      command: `${adapterSite} read`,
      ...(session === undefined ? { session: undefined } : { session }),
    });
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

  it('handles local Session lifecycle controls outside normal dispatch', async () => {
    const { provider, baseUrl } = await start();

    const created = await postCommand(baseUrl, { id: 'create-session', action: 'session-create' as BrowserRuntimeCommand['action'], contextId: 'profile_work' });
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      ok: true,
      data: { id: provider.sessionId, profileId: 'profile_work', kind: 'explicit' },
    });

    provider.activeSessions.add(provider.sessionId);
    const listed = await postCommand(baseUrl, { id: 'list-sessions', action: 'session-list' as BrowserRuntimeCommand['action'], contextId: 'profile_work' });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      ok: true,
      data: [{ id: provider.sessionId, runtimeState: 'active' }],
    });

    const closed = await postCommand(baseUrl, { id: 'close-session', action: 'session-close' as BrowserRuntimeCommand['action'], contextId: 'profile_work', session: provider.sessionId });
    expect(closed.status).toBe(200);
    await expect(closed.json()).resolves.toMatchObject({
      ok: true,
      data: { closed: true, alreadyIdle: false, session: provider.sessionId },
    });

    const closedAgain = await postCommand(baseUrl, { id: 'close-session-again', action: 'session-close' as BrowserRuntimeCommand['action'], contextId: 'profile_work', session: provider.sessionId });
    expect(closedAgain.status).toBe(200);
    await expect(closedAgain.json()).resolves.toMatchObject({
      ok: true,
      data: { closed: false, alreadyIdle: true, session: provider.sessionId },
    });
    expect(provider.commands).toEqual([]);
  });

  it('rejects Session close while its live human handoff owns the window', async () => {
    const provider = new FakeProvider();
    provider.sessions.push({
      id: 'session_a',
      profileId: 'profile_work',
      kind: 'explicit',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      lastUsedAt: '2026-08-11T00:00:00.000Z',
      handoff: {
        site: 'github',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    provider.activeSessions.add('session_a');
    const { baseUrl } = await start(provider);

    const close = await postCommand(baseUrl, {
      id: 'close-handoff-session',
      action: 'session-close',
      contextId: 'profile_work',
      session: 'session_a',
    });

    expect(close.status).toBe(409);
    await expect(close.json()).resolves.toMatchObject({
      errorCode: 'SESSION_PAUSED_FOR_HUMAN_HANDOFF',
      details: { sessionId: 'session_a', site: 'github' },
    });
    expect(provider.activeSessions).toContain('session_a');
  });

  it('rejects Session close while work is active in that Session', async () => {
    let settle!: () => void;
    const provider = new FakeProvider();
    provider.activeSessions.add('session_a');
    provider.dispatchImpl = (command, signal) => new Promise((resolve) => {
      settle = () => resolve({ id: command.id, ok: true, data: 'done' });
      signal?.addEventListener('abort', settle, { once: true });
    });
    const { baseUrl } = await start(provider);

    const active = postCommand(baseUrl, {
      id: 'active-work',
      action: 'exec',
      surface: 'browser',
      session: 'session_a',
      runId: 'run_100_1_1',
      command: 'browser/run',
    });
    try {
      await vi.waitFor(() => expect(provider.commands).toHaveLength(1));
      const close = await postCommand(baseUrl, {
        id: 'close-active-session',
        action: 'session-close',
        contextId: 'default',
        session: 'session_a',
      });

      expect(close.status).toBe(409);
      await expect(close.json()).resolves.toMatchObject({
        ok: false,
        code: 'session_busy',
        holder: { command: 'browser/run' },
      });
      expect(provider.activeSessions).toContain('session_a');
    } finally {
      settle();
      await active.catch(() => undefined);
    }
  });

  it('force-closes a Session while work is active', async () => {
    let settle!: () => void;
    let settled = false;
    const provider = new FakeProvider();
    provider.activeSessions.add('session_a');
    provider.dispatchImpl = (command, signal) => new Promise((resolve) => {
      settle = () => {
        settled = true;
        resolve({ id: command.id, ok: true, data: 'done' });
      };
      signal?.addEventListener('abort', settle, { once: true });
    });
    const { baseUrl } = await start(provider);

    const active = postCommand(baseUrl, {
      id: 'active-force-work',
      action: 'exec',
      surface: 'browser',
      session: 'session_a',
      runId: 'run_100_1_2',
      command: 'browser/run',
    });
    try {
      await vi.waitFor(() => expect(provider.commands).toHaveLength(1));
      const closeRequest = postCommand(baseUrl, {
        id: 'force-close-active-session',
        action: 'session-close',
        contextId: 'default',
        session: 'session_a',
        force: true,
      });
      await vi.waitFor(() => expect(provider.activeSessions).not.toContain('session_a'));
      const close = await closeRequest;
      expect(settled).toBe(true);
      expect(close.status).toBe(200);
      await expect(close.json()).resolves.toMatchObject({
        ok: true,
        data: {
          closed: true,
          alreadyIdle: false,
          session: 'session_a',
          displaced: 1,
          clearedHandoff: false,
        },
      });
    } finally {
      settle();
      await active.catch(() => undefined);
    }
    provider.dispatchImpl = async (command) => ({ id: command.id, ok: true });
    const admitted = await postCommand(baseUrl, {
      id: 'after-force-settled', action: 'exec', surface: 'browser', session: 'session_a',
      runId: 'run_200_2_2', command: 'browser/run',
    });
    expect(admitted.status).toBe(200);
  });

  it('force-closes every site-partitioned lease in an adapter-default Session', async () => {
    const provider = new FakeProvider();
    provider.activeSessions.add('session_default');
    const { baseUrl } = await start(provider);
    expect((await postCommand(baseUrl, adapterCommand('github-owner', 'run_100_1_1', 'github'))).status).toBe(200);
    expect((await postCommand(baseUrl, adapterCommand('linkedin-owner', 'run_200_2_2', 'linkedin'))).status).toBe(200);

    const close = await postCommand(baseUrl, {
      id: 'force-close-default', action: 'session-close', contextId: 'default',
      session: 'session_default', force: true,
    });
    const status = await fetch(`${baseUrl}/status`, { headers: { [DAEMON_HEADER_NAME]: '1' } });

    expect(close.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ sessionLeases: [] });
  });

  it('accepts the maximum browser-run source envelope', async () => {
    const { provider, baseUrl } = await start();
    const source = 'x'.repeat(256 * 1024);
    const res = await postCommand(baseUrl, {
      id: 'run-max-source',
      action: 'run',
      session: 'work',
      source,
    });

    expect(res.status).toBe(200);
    expect(provider.commands[0]).toMatchObject({
      id: 'run-max-source',
      action: 'run',
      source,
    });
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

  it('partitions adapter-default admission by site', async () => {
    const { provider, baseUrl } = await start();

    expect((await postCommand(baseUrl, adapterCommand('github-owner', 'run_100_1_1', 'github'))).status).toBe(200);
    expect((await postCommand(baseUrl, adapterCommand('linkedin-owner', 'run_200_2_2', 'linkedin'))).status).toBe(200);
    expect((await postCommand(baseUrl, adapterCommand('github-conflict', 'run_300_3_3', 'github'))).status).toBe(409);
    expect(provider.commands.map(({ id }) => id)).toEqual(['github-owner', 'linkedin-owner']);
    expect(provider.commands[0]).toMatchObject({
      sessionId: 'session_default',
      sessionKind: 'adapter-default',
      adapterSite: 'github',
    });
  });

  it('conflicts an explicitly selected adapter-default Session with its implicit adapter work', async () => {
    const { provider, baseUrl } = await start();

    expect((await postCommand(baseUrl, adapterCommand('github-owner', 'run_100_1_1', 'github'))).status).toBe(200);
    const rawConflict = await postCommand(baseUrl, {
      id: 'raw-conflict',
      action: 'exec',
      code: '1',
      surface: 'browser',
      session: 'session_default',
      runId: 'run_200_2_2',
      command: 'browser/run',
    });

    expect(rawConflict.status).toBe(409);
    expect(provider.commands.map(({ id }) => id)).toEqual(['github-owner']);
  });

  it('marks an explicitly selected adapter-default ID as explicit routing', async () => {
    const { provider, baseUrl } = await start();

    expect((await postCommand(baseUrl, adapterCommand('explicit-default', 'run_100_1_1', 'github', 'session_default'))).status).toBe(200);
    expect(provider.commands[0]).toMatchObject({
      sessionId: 'session_default',
      sessionKind: 'explicit',
    });
  });

  it('keeps explicit Session admission wide across sites and isolated across Sessions', async () => {
    const { provider, baseUrl } = await start();

    expect((await postCommand(baseUrl, adapterCommand('github-a', 'run_100_1_1', 'github', 'session_a'))).status).toBe(200);
    expect((await postCommand(baseUrl, adapterCommand('linkedin-a', 'run_200_2_2', 'linkedin', 'session_a'))).status).toBe(409);
    expect((await postCommand(baseUrl, adapterCommand('linkedin-b', 'run_300_3_3', 'linkedin', 'session_b'))).status).toBe(200);
    expect(provider.commands.map(({ id }) => id)).toEqual(['github-a', 'linkedin-b']);
  });

  it('pauses only the handoff Session and admits only its internal site verification', async () => {
    const { provider, baseUrl } = await start();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    const started = await postCommand(baseUrl, {
      id: 'handoff-start',
      action: 'session-handoff-start' as BrowserRuntimeCommand['action'],
      surface: 'adapter',
      session: 'session_a',
      adapterSite: 'github',
      site: 'github',
      expiresAt,
      runId: 'run_100_1_1',
      command: 'github/login',
    });
    expect(started.status).toBe(200);
    expect(provider.foregroundedSessions).toEqual(['session_a']);

    await postCommand(baseUrl, { id: 'release-login', action: 'lease-release', runId: 'run_100_1_1' });
    const paused = await postCommand(baseUrl, adapterCommand('paused', 'run_200_2_2', 'github', 'session_a'));
    expect(paused.status).toBe(409);
    await expect(paused.json()).resolves.toMatchObject({
      errorCode: 'SESSION_PAUSED_FOR_HUMAN_HANDOFF',
      details: { sessionId: 'session_a', site: 'github', expiresAt },
    });

    const sibling = await postCommand(baseUrl, adapterCommand('sibling', 'run_300_3_3', 'linkedin', 'session_b'));
    expect(sibling.status).toBe(200);

    const rawWhoami = await postCommand(baseUrl, {
      ...adapterCommand('raw-whoami', 'run_400_4_4', 'github', 'session_a'),
      surface: 'browser',
      command: 'github/whoami',
    });
    expect(rawWhoami.status).toBe(409);

    const wrongSite = await postCommand(baseUrl, {
      ...adapterCommand('wrong-site', 'run_400_4_4', 'linkedin', 'session_a'),
      command: 'github/whoami',
    });
    expect(wrongSite.status).toBe(409);

    const verification = await postCommand(baseUrl, {
      ...adapterCommand('verify', 'run_500_5_5', 'github', 'session_a'),
      command: 'github/whoami',
    });
    expect(verification.status).toBe(200);

    const cleared = await postCommand(baseUrl, {
      id: 'handoff-clear',
      action: 'session-handoff-clear' as BrowserRuntimeCommand['action'],
      surface: 'adapter',
      session: 'session_a',
      adapterSite: 'github',
      site: 'github',
      runId: 'run_500_5_5',
      command: 'github/whoami',
    });
    expect(cleared.status).toBe(200);

    await postCommand(baseUrl, { id: 'release-verify', action: 'lease-release', runId: 'run_500_5_5' });
    const resumed = await postCommand(baseUrl, adapterCommand('resumed', 'run_600_6_6', 'github', 'session_a'));
    expect(resumed.status).toBe(200);
  });

  it('ignores expired handoffs before admission', async () => {
    const provider = new FakeProvider();
    provider.sessions.push({
      id: 'session_a',
      profileId: 'default',
      kind: 'explicit',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      lastUsedAt: '2026-08-11T00:00:00.000Z',
      handoff: { site: 'github', expiresAt: '2026-08-11T00:15:00.000Z' },
    });
    const { baseUrl } = await start(provider);

    const result = await postCommand(baseUrl, adapterCommand('after-expiry', 'run_700_7_7', 'github', 'session_a'));

    expect(result.status).toBe(200);
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
        key: 'default␟site:example',
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
  ])('conflicts across %s when the resolved Session is the same', async (_case, overrides) => {
    const provider = new FakeProvider();
    provider.resolveProfileId = (command) => command.profileId ?? 'default';
    const { baseUrl } = await start(provider);

    expect((await postCommand(baseUrl, persistentWrite('owner', 'run_100_1_1'))).status).toBe(200);
    expect((await postCommand(baseUrl, persistentWrite('other', 'run_200_2_2', overrides))).status).toBe(409);
    expect(provider.commands.map((command) => command.id)).toEqual(['owner']);
  });

  it.each([
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

  it('keeps timed-out provider work pending until provider settlement', async () => {
    let now = 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let settleProvider: (() => void) | undefined;
    let providerStarted!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const provider = new FakeProvider();
    provider.dispatchImpl = (command) => {
      if (command.id !== 'timed-out') {
        return Promise.resolve({ id: command.id, ok: true, data: 'done' });
      }
      if (provider.commands.filter(({ id }) => id === command.id).length > 1) {
        return Promise.resolve({ id: command.id, ok: true, data: 'duplicate dispatch' });
      }
      providerStarted();
      return new Promise((resolve) => {
        settleProvider = () => resolve({ id: command.id, ok: true, data: 'done' });
      });
    };
    const { baseUrl } = await start(provider);

    const firstRequest = postCommand(baseUrl, persistentWrite('timed-out', 'run_100_1_1', { timeout: 0.01 }));
    try {
      await providerStartedPromise;
      const timedOut = await firstRequest;
      expect(timedOut.status).toBe(408);
      await expect(timedOut.json()).resolves.toMatchObject({
        id: 'timed-out',
        ok: false,
        errorCode: 'command_result_unknown',
      });

      now = 47_001;
      const duplicateRequest = postCommand(
        baseUrl,
        persistentWrite('timed-out', 'run_100_1_1', { timeout: 120 }),
      );
      const whileProviderPending = await fetch(`${baseUrl}/status`, { headers: { [DAEMON_HEADER_NAME]: '1' } });
      await expect(whileProviderPending.json()).resolves.toMatchObject({
        pending: 1,
        sessionLeases: [{ command: 'example write', heartbeatAt: 1_000 }],
      });
      expect(provider.commands.map((command) => command.id)).toEqual(['timed-out']);

      const conflict = await postCommand(baseUrl, persistentWrite('conflict', 'run_200_2_2'));
      expect(conflict.status).toBe(409);
      expect(provider.commands.map((command) => command.id)).toEqual(['timed-out']);

      settleProvider?.();
      const duplicate = await duplicateRequest;
      expect(duplicate.status).toBe(200);
      await expect(duplicate.json()).resolves.toMatchObject({ data: 'done' });
      const afterProviderSettle = await fetch(`${baseUrl}/status`, { headers: { [DAEMON_HEADER_NAME]: '1' } });
      await expect(afterProviderSettle.json()).resolves.toMatchObject({
        pending: 0,
        sessionLeases: [{ command: 'example write', heartbeatAt: 47_001 }],
      });

      now = 92_002;
      const reclaimed = await postCommand(baseUrl, persistentWrite('reclaimed', 'run_200_2_2'));
      expect(reclaimed.status).toBe(200);
      expect(provider.commands.map((command) => command.id)).toEqual(['timed-out', 'reclaimed']);
    } finally {
      settleProvider?.();
      await firstRequest.catch(() => undefined);
      dateNow.mockRestore();
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

  it('handles run-cancel locally and permits a new owner', async () => {
    const { provider, baseUrl } = await start();
    expect((await postCommand(baseUrl, persistentWrite('owner', 'run_100_1_1'))).status).toBe(200);

    const canceled = await postCommand(baseUrl, {
      id: 'cancel',
      action: 'run-cancel' as BrowserRuntimeCommand['action'],
      runId: 'run_100_1_1',
    });
    expect(canceled.status).toBe(200);
    await expect(canceled.json()).resolves.toMatchObject({
      id: 'cancel',
      ok: true,
      data: { released: 1 },
    });
    expect(provider.commands.map((command) => command.id)).toEqual(['owner']);

    expect((await postCommand(baseUrl, persistentWrite('next-owner', 'run_200_2_2'))).status).toBe(200);
    expect(provider.commands.map((command) => command.id)).toEqual(['owner', 'next-owner']);
  });

  it('aborts pending work when the command request disconnects', async () => {
    const provider = new FakeProvider();
    let aborted = false;
    provider.dispatchImpl = (command, signal) => new Promise((resolve) => {
      if (command.id !== 'owner') {
        resolve({ id: command.id, ok: true, data: 'done' });
        return;
      }
      signal?.addEventListener('abort', () => {
        aborted = true;
        resolve({ id: command.id, ok: false, errorCode: 'aborted', error: 'aborted' });
      });
    });
    const { baseUrl } = await start(provider);
    const url = new URL('/command', baseUrl);
    const body = JSON.stringify(persistentWrite('owner', 'run_100_1_1'));
    const req = httpRequest(url, {
      method: 'POST',
      headers: {
        [DAEMON_HEADER_NAME]: '1',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    });
    req.on('error', () => undefined);
    req.end(body);

    await vi.waitFor(() => expect(provider.commands.map((command) => command.id)).toEqual(['owner']));
    req.destroy();

    await vi.waitFor(() => expect(aborted).toBe(true));
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
