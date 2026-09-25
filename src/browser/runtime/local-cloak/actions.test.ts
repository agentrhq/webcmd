import { describe, expect, it, vi } from 'vitest';
import { dispatchCloakAction } from './actions.js';

describe('Cloak public CDP action cleanup', () => {
  it.each([false, true])('detaches its command-local CDP session when send failure=%s', async (fails) => {
    const send = fails ? vi.fn().mockRejectedValue(new Error('send failed')) : vi.fn().mockResolvedValue({ enabled: true });
    const detach = vi.fn().mockResolvedValue(undefined);
    const manager = {
      getPage: vi.fn().mockResolvedValue({
        profileId: 'default', pageId: 'page-1', page: {},
        context: { newCDPSession: vi.fn().mockResolvedValue({ send, detach }) },
      }),
    };
    const result = await dispatchCloakAction(manager as never, {
      id: 'cdp-1', action: 'cdp', session: 'agent', surface: 'browser', cdpMethod: 'Runtime.enable',
    });
    expect(result.ok).toBe(!fails);
    expect(detach).toHaveBeenCalledOnce();
  });
});
