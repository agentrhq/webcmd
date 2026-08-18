import { describe, expect, it, vi } from 'vitest';
import { attachSlabProfile } from './attachment.js';

describe('attachSlabProfile', () => {
  it('connects to the attached CDP endpoint and releases the bridge attachment', async () => {
    const context = {};
    const browser = { contexts: vi.fn(() => [context]), version: vi.fn(() => '146.0'), close: vi.fn() };
    const bridge = {
      attach: vi.fn().mockResolvedValue({
        connectionId: 'connection-1',
        profile: { id: 'work', displayName: 'Work' },
        cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/1',
        bearerToken: 'secret',
        expiresAt: '2026-08-19T00:00:00.000Z',
      }),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const connectOverCDP = vi.fn().mockResolvedValue(browser);

    const attached = await attachSlabProfile('work', { bridge, connectOverCDP });

    expect(attached).toMatchObject({ profileId: 'work', browserVersion: '146.0', context, browser });
    expect(connectOverCDP).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/browser/1', {
      headers: { Authorization: 'Bearer secret' },
    });
    await attached.release();
    expect(bridge.release).toHaveBeenCalledWith('connection-1');
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('releases an attachment when CDP connection setup fails', async () => {
    const bridge = {
      attach: vi.fn().mockResolvedValue({
        connectionId: 'connection-1', profile: { id: 'work', displayName: 'Work' }, cdpUrl: 'ws://127.0.0.1:9222', bearerToken: 'secret', expiresAt: '2026-08-19T00:00:00.000Z',
      }),
      release: vi.fn().mockResolvedValue(undefined),
    };

    await expect(attachSlabProfile('work', { bridge, connectOverCDP: vi.fn().mockRejectedValue(new Error('CDP refused')) }))
      .rejects.toThrow('CDP refused');
    expect(bridge.release).toHaveBeenCalledWith('connection-1');
  });
});
