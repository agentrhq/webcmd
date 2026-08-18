import { describe, expect, it, vi } from 'vitest';
import { launchSlab } from './launch.js';

describe('SLAB launch', () => {
  it('restarts an unavailable installed browser once', async () => {
    const hello = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ protocolVersion: 1, browserVersion: '1', browserPid: 1234, profiles: [] });
    const io = {
      findInstallation: () => ({ platform: 'darwin' as const, executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB' }),
      isRunning: () => true,
      launch: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      hello,
      wait: vi.fn(async () => {}),
    };

    await expect(launchSlab(io)).resolves.toMatchObject({ protocolVersion: 1 });
    expect(io.restart).toHaveBeenCalledOnce();
  });
});
