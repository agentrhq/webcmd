import { afterEach, describe, expect, it, vi } from 'vitest';

describe('DEFAULT_DAEMON_PORT', () => {
  const original = process.env.WEBCMD_DAEMON_PORT;

  afterEach(() => {
    if (original === undefined) delete process.env.WEBCMD_DAEMON_PORT;
    else process.env.WEBCMD_DAEMON_PORT = original;
    vi.resetModules();
  });

  it('uses WEBCMD_DAEMON_PORT when it is a valid TCP port', async () => {
    process.env.WEBCMD_DAEMON_PORT = '19876';
    const { DEFAULT_DAEMON_PORT } = await import('./constants.js');

    expect(DEFAULT_DAEMON_PORT).toBe(19876);
  });

  it('falls back to 9777 for invalid values', async () => {
    process.env.WEBCMD_DAEMON_PORT = 'not-a-port';
    const { DEFAULT_DAEMON_PORT } = await import('./constants.js');

    expect(DEFAULT_DAEMON_PORT).toBe(9777);
  });
});
