import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ unref: vi.fn() })));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: spawnMock,
}));

import { browserConnectErrorFromHealth, spawnDaemonProcess } from './daemon-lifecycle.js';

describe('spawnDaemonProcess', () => {
  const originalTmpdir = process.env.TMPDIR;

  afterEach(() => {
    spawnMock.mockClear();
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
  });

  it('does not inherit a caller-owned temporary directory', () => {
    process.env.TMPDIR = '/tmp/deleted-eval-attempt/tmp';

    spawnDaemonProcess();

    expect(spawnMock).toHaveBeenCalledOnce();
    const options = spawnMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
    expect(options?.env).not.toHaveProperty('TMPDIR');
    expect(options?.env).not.toHaveProperty('TMP');
    expect(options?.env).not.toHaveProperty('TEMP');
  });
});

describe('provider-specific readiness errors', () => {
  it('never tells a SLAB user to open Chrome or enable Cloak', () => {
    for (const state of ['profile-disconnected', 'no-runtime'] as const) {
      const error = browserConnectErrorFromHealth({ state, status: null } as never, 'work', 'slab');
      expect(`${error.message}\n${error.hint}`).toContain('SLAB');
      expect(`${error.message}\n${error.hint}`).not.toMatch(/Chrome|Cloak/);
    }
  });

  it('names configured direct and custom runtimes without Cloak instructions', () => {
    const chrome = browserConnectErrorFromHealth({ state: 'no-runtime', status: null } as never, undefined, 'chrome');
    const custom = browserConnectErrorFromHealth({ state: 'no-runtime', status: null } as never, undefined, 'custom');
    expect(chrome.hint).toContain('configured Chrome runtime');
    expect(custom.hint).toContain('custom browser runtime');
    expect(`${chrome.hint}${custom.hint}`).not.toContain('Cloak');
  });
});
