import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  SESSION_LEASE_TTL_MS,
  SessionLeaseRegistry,
  clearDaemonRunContext,
  generateRunId,
  getDaemonRunContext,
  getSessionLeaseKey,
  isSessionLeaseCommand,
  isUnknownOutcomeError,
  runWithDaemonRunContext,
  setDaemonRunContext,
} from './session-lease.js';
import type { DaemonRunContext } from './session-lease.js';

const T0 = 1_000_000;

describe('logical daemon run context', () => {
  afterEach(() => {
    const current = getDaemonRunContext();
    if (current) clearDaemonRunContext(current.runId);
    vi.restoreAllMocks();
  });

  it('keeps one run id stable while a logical run is bound and generates a different id for the next run', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_000);
    const firstRunId = generateRunId();
    setDaemonRunContext({ runId: firstRunId, command: 'chatgpt ask' });

    expect(getDaemonRunContext()?.runId).toBe(firstRunId);
    expect(getDaemonRunContext()?.runId).toBe(firstRunId);

    clearDaemonRunContext(firstRunId);
    const secondRunId = generateRunId();
    expect(secondRunId).not.toBe(firstRunId);
    expect(firstRunId).toMatch(new RegExp(`^run_${process.pid}_1763000000000_\\d+$`));
  });

  it('does not let deferred cleanup from an older run clear a newer run context', () => {
    setDaemonRunContext({ runId: 'run_111_1_1', command: 'chatgpt ask' });
    setDaemonRunContext({ runId: 'run_222_2_2', command: 'claude ask' });

    clearDaemonRunContext('run_111_1_1');
    expect(getDaemonRunContext()).toEqual({
      runId: 'run_222_2_2',
      command: 'claude ask',
    });

    clearDaemonRunContext('run_222_2_2');
    expect(getDaemonRunContext()).toBeUndefined();
  });

  it('only accepts a concrete run context through the setter', () => {
    expectTypeOf(setDaemonRunContext).parameter(0).toEqualTypeOf<DaemonRunContext>();
  });

  it('keeps overlapping async run contexts isolated across awaits', async () => {
    let resumeFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { resumeFirst = resolve; });
    const firstContext: DaemonRunContext = {
      runId: 'run_111_1_1',
      command: 'first write',
    };
    const secondContext: DaemonRunContext = {
      runId: 'run_222_2_2',
      command: 'second write',
    };

    const first = runWithDaemonRunContext(firstContext, async () => {
      await firstGate;
      return getDaemonRunContext();
    });
    const second = runWithDaemonRunContext(secondContext, async () => getDaemonRunContext());

    expect(await second).toEqual(secondContext);
    resumeFirst();
    expect(await first).toEqual(firstContext);
    expect(getDaemonRunContext()).toBeUndefined();
  });
});

describe('isUnknownOutcomeError', () => {
  it('recognizes public, daemon, and message codes case-insensitively', () => {
    expect(isUnknownOutcomeError({ code: 'COMMAND_RESULT_UNKNOWN' })).toBe(true);
    expect(isUnknownOutcomeError({ errorCode: 'Command_Lost' })).toBe(true);
    expect(isUnknownOutcomeError(new Error('daemon returned RESULT_EVICTED'))).toBe(true);
    expect(isUnknownOutcomeError({ daemonCode: 'attach_failed', message: 'ordinary failure' })).toBe(false);
  });

  it('walks causes and AggregateError members without looping on cycles', () => {
    const cyclic = new Error('outer') as Error & { cause?: unknown };
    cyclic.cause = cyclic;
    const aggregate = new AggregateError([
      cyclic,
      new Error('wrapped', { cause: { errorCode: 'COMMAND_LOST' } }),
    ]);

    expect(isUnknownOutcomeError(aggregate)).toBe(true);
    expect(isUnknownOutcomeError(cyclic)).toBe(false);
  });
});

describe('session lease partitions', () => {
  it('partitions admission by resolved profile and immutable Session id', () => {
    const workSession = getSessionLeaseKey('work', 'session_a');
    expect(workSession).toBe('work␟session_a');
    expect(workSession).not.toBe(getSessionLeaseKey('personal', 'session_a'));
    expect(workSession).not.toBe(getSessionLeaseKey('work', 'session_b'));
  });

  it('arbitrates any resolved browser-backed command with complete run identity', () => {
    const eligible = {
      action: 'exec',
      sessionId: 'session_a',
      runId: 'run_111_1_1',
    };
    expect(isSessionLeaseCommand(eligible)).toBe(true);
    expect(isSessionLeaseCommand({ ...eligible, action: 'lease-release' })).toBe(false);
    expect(isSessionLeaseCommand({ ...eligible, action: 'run-cancel' })).toBe(false);
    expect(isSessionLeaseCommand({ ...eligible, sessionId: '' })).toBe(false);
    expect(isSessionLeaseCommand({ ...eligible, runId: undefined })).toBe(false);
  });
});

describe('SessionLeaseRegistry', () => {
  const KEY = getSessionLeaseKey('work', 'session_a');
  let now = T0;

  beforeEach(() => {
    now = T0;
  });

  it('allows same-run re-entry, rejects overlapping different runs, and allows sibling Sessions', () => {
    const leases = registry();
    const keyA = getSessionLeaseKey('profile_work', 'session_a');
    const keyB = getSessionLeaseKey('profile_work', 'session_b');

    expect(leases.acquire({ key: keyA, runId: 'run_7_one', command: 'browser/run', pid: 7 }, () => true).acquired)
      .toBe(true);
    expect(leases.acquire({ key: keyA, runId: 'run_7_one', command: 'browser/tabs', pid: 7 }, () => true).acquired)
      .toBe(true);
    expect(leases.acquire({ key: keyA, runId: 'run_7_two', command: 'github/issues', pid: 7 }, () => true))
      .toMatchObject({ acquired: false });
    expect(leases.acquire({ key: keyB, runId: 'run_7_two', command: 'github/issues', pid: 7 }, () => true).acquired)
      .toBe(true);
    leases.releaseByRunId('run_7_one');
    expect(leases.acquire({ key: keyA, runId: 'run_7_three', command: 'browser/run' }, () => false).acquired)
      .toBe(true);
  });

  function registry(): SessionLeaseRegistry {
    return new SessionLeaseRegistry(() => now, () => true);
  }

  function acquire(registry: SessionLeaseRegistry, runId: string, key = KEY) {
    return registry.acquire(
      { key, runId, command: 'chatgpt ask', pid: Number(runId.split('_')[1]) },
      () => false,
    );
  }

  it('acquires a free key and returns the live holder on a conflicting run without mutation', () => {
    const leases = registry();
    expect(acquire(leases, 'run_111_1_1')).toEqual({
      acquired: true,
      lease: expect.objectContaining({
        key: KEY,
        runId: 'run_111_1_1',
        command: 'chatgpt ask',
        pid: 111,
        acquiredAt: T0,
        heartbeatAt: T0,
      }),
    });

    now += 1_000;
    const conflict = acquire(leases, 'run_222_2_2');
    expect(conflict).toEqual({
      acquired: false,
      holder: expect.objectContaining({ runId: 'run_111_1_1', heartbeatAt: T0 }),
    });
    expect(leases.list(() => false)).toEqual([
      expect.objectContaining({ runId: 'run_111_1_1', heartbeatAt: T0 }),
    ]);
  });

  it('recovers the holder pid from a generated run id when explicit metadata is absent', () => {
    const leases = registry();
    expect(leases.acquire(
      { key: KEY, runId: 'run_4242_1700000000000_7', command: 'chatgpt ask' },
      () => false,
    )).toEqual({
      acquired: true,
      lease: expect.objectContaining({ pid: 4242 }),
    });
  });

  it('lets a challenger acquire when the live-looking holder pid is gone', () => {
    const leases = new SessionLeaseRegistry(() => now, () => false);
    expect(acquire(leases, 'run_111_1_1')).toMatchObject({ acquired: true });

    now += 1_000;
    expect(acquire(leases, 'run_222_2_2')).toEqual({
      acquired: true,
      lease: expect.objectContaining({
        runId: 'run_222_2_2',
        pid: 222,
        acquiredAt: now,
        heartbeatAt: now,
      }),
    });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('omits a non-actionable explicit holder pid (%s)', (pid) => {
    const leases = registry();
    const result = leases.acquire(
      { key: KEY, runId: 'opaque-run-id', command: 'chatgpt ask', pid },
      () => false,
    );

    expect(result.acquired).toBe(true);
    if (result.acquired) expect(result.lease).not.toHaveProperty('pid');
  });

  it.each([
    'run_0_1700000000000_1',
    'run_-1_1700000000000_1',
    'run_1.5_1700000000000_1',
    'run_NaN_1700000000000_1',
    'run_Infinity_1700000000000_1',
    `run_${Number.MAX_SAFE_INTEGER + 1}_1700000000000_1`,
  ])('does not recover a non-actionable holder pid from %s', (runId) => {
    const leases = registry();
    const result = leases.acquire(
      { key: KEY, runId, command: 'chatgpt ask' },
      () => false,
    );

    expect(result.acquired).toBe(true);
    if (result.acquired) expect(result.lease).not.toHaveProperty('pid');
  });

  it('treats same-run acquisition and explicit heartbeat as owner-only liveness refreshes', () => {
    const leases = registry();
    acquire(leases, 'run_111_1_1');
    now += SESSION_LEASE_TTL_MS;

    const refreshed = acquire(leases, 'run_111_1_1');
    expect(refreshed).toEqual({
      acquired: true,
      lease: expect.objectContaining({ acquiredAt: T0, heartbeatAt: now }),
    });

    now += 10;
    expect(leases.heartbeat(KEY, 'run_999_9_9')).toBe(false);
    expect(leases.heartbeat(KEY, 'run_111_1_1')).toBe(true);
    expect(leases.list(() => false)[0]).toMatchObject({ acquiredAt: T0, heartbeatAt: now });
  });

  it('lets a challenger acquire after expiry', () => {
    const leases = registry();
    acquire(leases, 'run_111_1_1');
    now += SESSION_LEASE_TTL_MS + 1;

    expect(acquire(leases, 'run_222_2_2')).toEqual({
      acquired: true,
      lease: expect.objectContaining({ runId: 'run_222_2_2', acquiredAt: now }),
    });
  });

  it('keeps an expired holder live while the holder still has pending work', () => {
    const leases = registry();
    acquire(leases, 'run_111_1_1');
    now += SESSION_LEASE_TTL_MS + 10_000;

    const conflict = leases.acquire(
      { key: KEY, runId: 'run_222_2_2', command: 'chatgpt ask', pid: 222 },
      (runId) => runId === 'run_111_1_1',
    );
    expect(conflict).toEqual({
      acquired: false,
      holder: expect.objectContaining({ runId: 'run_111_1_1' }),
    });
    expect(leases.list((runId) => runId === 'run_111_1_1')).toHaveLength(1);
    expect(leases.list(() => false)).toEqual([]);
  });

  it('releases only leases owned by the requested run and reports the count', () => {
    const leases = registry();
    acquire(leases, 'run_111_1_1');
    acquire(leases, 'run_111_1_1', getSessionLeaseKey('work', 'session_b'));

    expect(leases.releaseByRunId('run_999_9_9')).toBe(0);
    expect(leases.list(() => false)).toHaveLength(2);
    expect(leases.releaseByRunId('run_111_1_1')).toBe(2);
    expect(leases.list(() => false)).toEqual([]);
  });
});
