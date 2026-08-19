import { describe, expect, it, vi } from 'vitest';
import { SlabBridgeUnavailableError } from '../browser/runtime/local-slab/bridge-client.js';
import { SlabUpdateRequiredError } from '../errors.js';
import { launchSlab } from './launch.js';

describe('SLAB launch', () => {
  it('launches the installed CLI bridge when no app bundle is present', async () => {
    const io = {
      findInstallation: () => null,
      isRunning: vi.fn(() => false),
      launch: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      hello: vi.fn()
        .mockRejectedValueOnce(new SlabBridgeUnavailableError('offline'))
        .mockResolvedValue({ protocolVersion: 1, browserVersion: '1', browserPid: 1234, profiles: [] }),
      wait: vi.fn(async () => {}),
      now: vi.fn(() => 0),
    };

    await expect(launchSlab(io)).resolves.toMatchObject({ protocolVersion: 1 });
    expect(io.launch).toHaveBeenCalledWith('slab-browser');
  });

  it('restarts an unavailable installed browser once', async () => {
    const hello = vi.fn()
      .mockRejectedValueOnce(new SlabBridgeUnavailableError('offline'))
      .mockRejectedValueOnce(new SlabBridgeUnavailableError('offline'))
      .mockResolvedValue({ protocolVersion: 1, browserVersion: '1', browserPid: 1234, profiles: [] });
    const io = {
      findInstallation: () => ({ platform: 'darwin' as const, executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' }),
      isRunning: () => true,
      launch: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      hello,
      wait: vi.fn(async () => {}),
      now: vi.fn(() => 0),
    };

    await expect(launchSlab(io)).resolves.toMatchObject({ protocolVersion: 1 });
    expect(io.restart).toHaveBeenCalledOnce();
  });

  it('keeps polling for bridge readiness for up to five seconds', async () => {
    const hello = vi.fn()
      .mockRejectedValueOnce(new SlabBridgeUnavailableError('offline'))
      .mockRejectedValueOnce(new SlabBridgeUnavailableError('offline'))
      .mockResolvedValue({ protocolVersion: 1, browserVersion: '1', browserPid: 1234, profiles: [] });
    const io = {
      findInstallation: () => ({ platform: 'darwin' as const, executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' }),
      isRunning: () => false,
      launch: vi.fn(async () => {}), restart: vi.fn(async () => {}), hello,
      wait: vi.fn(async () => {}), now: vi.fn(() => 0),
    };

    await expect(launchSlab(io)).resolves.toMatchObject({ protocolVersion: 1 });
    expect(io.wait).toHaveBeenCalledOnce();
  });

  it('does not restart for a protocol incompatibility', async () => {
    const error = new SlabUpdateRequiredError('2', 'protocol v1');
    const io = {
      findInstallation: () => ({ platform: 'darwin' as const, executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' }),
      isRunning: vi.fn(() => true), launch: vi.fn(async () => {}), restart: vi.fn(async () => {}),
      hello: vi.fn(async () => { throw error; }), wait: vi.fn(async () => {}), now: vi.fn(() => 0),
    };

    await expect(launchSlab(io)).rejects.toBe(error);
    expect(io.restart).not.toHaveBeenCalled();
  });

  it('returns one repair command after the readiness window expires', async () => {
    const io = {
      findInstallation: () => ({ platform: 'darwin' as const, executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' }),
      isRunning: () => true, launch: vi.fn(async () => {}), restart: vi.fn(async () => {}),
      hello: vi.fn(async () => { throw new SlabBridgeUnavailableError('offline'); }),
      wait: vi.fn(async () => {}), now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(5_000),
    };

    await expect(launchSlab(io)).rejects.toMatchObject({ hint: 'Run `webcmd setup` to repair SLAB.' });
    expect(io.restart).toHaveBeenCalledOnce();
    expect(io.wait).toHaveBeenCalledOnce();
  });
});
