/**
 * Tests for the plugin lifecycle hooks system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProgram, isExternalRootCommand } from './cli.js';
import {
  onStartup,
  onBeforeExecute,
  onAfterExecute,
  emitHook,
  clearAllHooks,
  shouldEmitStartupHook,
  shouldRunStartupSideEffects,
  WEBCMD_ROOT_COMMANDS,
  type HookContext,
} from './hooks.js';

beforeEach(() => {
  clearAllHooks();
});

describe('hook registration and emission', () => {
  it('onBeforeExecute hook is called with context', async () => {
    const calls: HookContext[] = [];
    onBeforeExecute((ctx) => { calls.push({ ...ctx }); });

    await emitHook('onBeforeExecute', { command: 'test/cmd', args: { limit: 5 }, startedAt: 100 });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('test/cmd');
    expect(calls[0].args).toEqual({ limit: 5 });
    expect(calls[0].startedAt).toBe(100);
  });

  it('onAfterExecute hook receives result', async () => {
    const results: unknown[] = [];
    onAfterExecute((_ctx, result) => { results.push(result); });

    const mockResult = [{ title: 'item1' }, { title: 'item2' }];
    await emitHook('onAfterExecute', { command: 'test/cmd', args: {} }, mockResult);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(mockResult);
  });

  it('onStartup hook fires', async () => {
    let fired = false;
    onStartup(() => { fired = true; });

    await emitHook('onStartup', { command: '__startup__', args: {} });
    expect(fired).toBe(true);
  });

  it('multiple hooks on the same event fire in order', async () => {
    const order: number[] = [];
    onBeforeExecute(() => { order.push(1); });
    onBeforeExecute(() => { order.push(2); });
    onBeforeExecute(() => { order.push(3); });

    await emitHook('onBeforeExecute', { command: 'test/cmd', args: {} });
    expect(order).toEqual([1, 2, 3]);
  });

  it('async hooks are awaited', async () => {
    const order: string[] = [];
    onBeforeExecute(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('async-done');
    });
    onBeforeExecute(() => { order.push('sync'); });

    await emitHook('onBeforeExecute', { command: 'test/cmd', args: {} });
    expect(order).toEqual(['async-done', 'sync']);
  });
});

describe('hook error isolation', () => {
  it('failing hook does not prevent other hooks from running', async () => {
    const calls: string[] = [];

    onBeforeExecute(() => { calls.push('first'); });
    onBeforeExecute(() => { throw new Error('boom'); });
    onBeforeExecute(() => { calls.push('third'); });

    await emitHook('onBeforeExecute', { command: 'test/cmd', args: {} });

    // First and third should still run despite the second throwing
    expect(calls).toEqual(['first', 'third']);
  });

  it('async hook rejection does not prevent other hooks', async () => {
    const calls: string[] = [];

    onAfterExecute(() => { calls.push('before-reject'); });
    onAfterExecute(async () => { throw new Error('async boom'); });
    onAfterExecute(() => { calls.push('after-reject'); });

    await emitHook('onAfterExecute', { command: 'test/cmd', args: {} }, null);

    expect(calls).toEqual(['before-reject', 'after-reject']);
  });
});

describe('no-op when no hooks registered', () => {
  it('emitHook with no registered hooks does nothing', async () => {
    // Should not throw
    await emitHook('onBeforeExecute', { command: 'test/cmd', args: {} });
    await emitHook('onAfterExecute', { command: 'test/cmd', args: {} }, []);
    await emitHook('onStartup', { command: '__startup__', args: {} });
  });
});

describe('startup hook gating', () => {
  it('covers every unconditional createProgram root in the authoritative inventory', () => {
    const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-root-inventory-'));
    try {
      const program = createProgram('', '', pluginsDir);
      const actual = new Set(program.commands
        .filter(command => !isExternalRootCommand(program, command.name()))
        .map(command => command.name()));
      const missing = [...actual].filter(name => !WEBCMD_ROOT_COMMANDS.has(name)).sort();
      const stale = [...WEBCMD_ROOT_COMMANDS].filter(name => !actual.has(name)).sort();

      expect({ missing, stale }).toEqual({ missing: [], stale: [] });
    } finally {
      fs.rmSync(pluginsDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['--help'],
    ['list', '--format', 'json'],
    ['list', '--json'],
  ])('skips startup side effects for help or requested data output: %j', (...argv) => {
    expect(shouldRunStartupSideEffects(argv)).toBe(false);
  });

  it('keeps startup side effects for completion discovery', () => {
    expect(shouldRunStartupSideEffects(['--get-completions', '--cursor', '1'])).toBe(true);
  });

  it.each([
    ['agent-context', '--json'],
    ['demo', 'state', '--json'],
    ['demo', 'state', '-f', 'json'],
  ])('keeps startup side effects for real plugin command execution: %j', (...argv) => {
    expect(shouldRunStartupSideEffects(argv)).toBe(true);
    expect(shouldEmitStartupHook(argv)).toBe(true);
  });

  it.each([
    ['--help'],
    ['--get-completions'],
  ])('skips startup hooks for terminal help/completion paths: %j', (...argv) => {
    expect(shouldEmitStartupHook(argv)).toBe(false);
  });
});

describe('clearAllHooks', () => {
  it('removes all hooks', async () => {
    let called = false;
    onStartup(() => { called = true; });

    clearAllHooks();
    await emitHook('onStartup', { command: '__startup__', args: {} });

    expect(called).toBe(false);
  });
});

describe('globalThis singleton', () => {
  it('uses globalThis.__webcmd_hooks__ for shared state', () => {
    expect(globalThis.__webcmd_hooks__).toBeInstanceOf(Map);
  });
});
