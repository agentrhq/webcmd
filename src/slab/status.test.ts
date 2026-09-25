import { describe, expect, it, vi } from 'vitest';
import { inspectSlabStatus, slabStatusHasHello } from './status.js';

const hello = { protocolVersion: 1, browserVersion: '1', browserPid: 1234, profiles: [] };
const installation = {
  platform: 'darwin' as const,
  appPath: '/Applications/SLAB.app',
  executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB',
};

describe('SLAB setup status', () => {
  it.each([
    ['preliminary-running', true],
    ['installed-running', true],
    ['installed-not-running', false],
    ['not-installed', false],
  ] as const)('recognizes whether %s completed the control hello', (status, expected) => {
    expect(slabStatusHasHello(status)).toBe(expected);
  });

  it('reports a control-ready app without requiring a signed installation', async () => {
    const io = {
      findInstallation: vi.fn(() => null),
      hello: vi.fn().mockResolvedValue(hello),
    };

    await expect(inspectSlabStatus(io)).resolves.toBe('preliminary-running');
    expect(io.findInstallation).toHaveBeenCalledOnce();
  });

  it('reports an installed normal app that is already running', async () => {
    await expect(inspectSlabStatus({
      findInstallation: () => installation,
      hello: async () => hello,
    })).resolves.toBe('installed-running');
  });

  it('reports a missing app when its control socket is unavailable', async () => {
    await expect(inspectSlabStatus({
      findInstallation: () => null,
      hello: async () => { throw new Error('control socket unavailable'); },
    })).resolves.toBe('not-installed');
  });
});
