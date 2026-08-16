import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloakSessionManager } from './session-manager.js';
import { dispatchCloakAction } from './actions.js';

const runBrowserProgram = vi.hoisted(() => vi.fn());

vi.mock('../../run/runner.js', () => ({
  runBrowserProgram,
}));

// Trimmed copy of the fakeContext helper in session-manager.test.ts — only the
// surface `browser run` recovery touches (getPage/browserRunScope/CDP window
// bookkeeping) needs to be here.
function fakeContext() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const targetIds = new WeakMap<object, string>();
  const windowIds = new Map<string, number>();
  let targetCounter = 0;
  let windowCounter = 0;
  const fakePage = () => {
    let closed = false;
    let currentUrl = 'https://example.com/';
    const page: any = {
      goto: vi.fn().mockImplementation(async (url: string) => { currentUrl = url; }),
      evaluate: vi.fn().mockResolvedValue('ok'),
      title: vi.fn().mockResolvedValue('Title'),
      url: vi.fn(() => currentUrl),
      isClosed: vi.fn(() => closed),
      close: vi.fn(async () => { closed = true; }),
      opener: vi.fn().mockResolvedValue(null),
      on() {},
      once() {},
      off() {},
    };
    const targetId = `target-${++targetCounter}`;
    targetIds.set(page, targetId);
    windowIds.set(targetId, ++windowCounter);
    return page;
  };
  const page = fakePage();
  const allPages = [page];
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const cdp = {
    send: vi.fn(async (command: string, params?: { targetId?: string }) => {
      if (command === 'Target.createTarget') {
        const created = await context.newPage();
        allPages.push(created);
        queueMicrotask(() => emit('page', created));
        return { targetId: targetIds.get(created) };
      }
      if (command === 'Browser.getWindowForTarget') return { windowId: windowIds.get(params?.targetId ?? '') };
      if (command === 'Target.closeTarget') return { success: true };
      return {};
    }),
    on: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  let context: any;
  return {
    context: context = {
      on(event: string, listener: (...args: unknown[]) => void) {
        const bucket = listeners.get(event) ?? new Set();
        bucket.add(listener);
        listeners.set(event, bucket);
      },
      off(event: string, listener: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(listener);
      },
      emit,
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
      browser: vi.fn().mockReturnValue({ newBrowserCDPSession: vi.fn().mockResolvedValue(cdp) }),
      cookies: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    },
    page,
  };
}

describe('browser run recovery from a dead context (#314)', () => {
  afterEach(() => {
    runBrowserProgram.mockReset();
  });

  it('evicts the dead Profile runtime after a closed-target run failure so the next command gets a fresh page', async () => {
    const dead = fakeContext();
    const replacement = fakeContext();
    const launchPersistentContext = vi.fn()
      .mockResolvedValueOnce(dead.context)
      .mockResolvedValueOnce(replacement.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-run-recovery-test', launchPersistentContext });
    const command = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      action: 'run' as const,
      profileId: 'default',
      session: 'work',
      surface: 'browser' as const,
      source: "return 'ok';",
      ...extra,
    });

    // Existing page still reports isClosed() === false, but the program that
    // uses it hits the closed-target signature — the same shape the issue's
    // diagnostic trace showed for a dead-but-not-yet-noticed runtime.
    runBrowserProgram.mockRejectedValueOnce(new Error('Target page, context or browser has been closed'));
    const failed = await dispatchCloakAction(manager, command('run-1'));

    expect(failed.ok).toBe(false);
    expect(dead.page.isClosed()).toBe(false);

    runBrowserProgram.mockResolvedValueOnce({ ok: true, result: 'ok' });
    const recovered = await dispatchCloakAction(manager, command('run-2'));

    expect(recovered).toMatchObject({ ok: true, data: { ok: true, result: 'ok' } });
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('does not evict the runtime for an unrelated failure', async () => {
    const context = fakeContext();
    const launchPersistentContext = vi.fn().mockResolvedValue(context.context);
    const manager = new CloakSessionManager({ baseDir: '/tmp/webcmd-run-recovery-test-2', launchPersistentContext });
    const command = (id: string) => ({
      id,
      action: 'run' as const,
      profileId: 'default',
      session: 'work',
      surface: 'browser' as const,
      source: "throw new Error('boom');",
    });

    runBrowserProgram.mockRejectedValueOnce(new Error('boom'));
    const failed = await dispatchCloakAction(manager, command('run-1'));
    expect(failed.ok).toBe(false);

    runBrowserProgram.mockResolvedValueOnce({ ok: true, result: 'ok' });
    await dispatchCloakAction(manager, command('run-2'));

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
  });
});
