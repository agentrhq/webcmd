import { describe, expect, it, vi } from 'vitest';
import { dispatchSlabAction } from './actions.js';

function fixture(send: ReturnType<typeof vi.fn>) {
  const detach = vi.fn().mockResolvedValue(undefined);
  const manager = {
    getPage: vi.fn().mockResolvedValue({
      profileId: 'default',
      pageId: 'page-1',
      page: {},
      context: { newCDPSession: vi.fn().mockResolvedValue({ send, detach }) },
    }),
  };
  const command = { id: 'cdp-1', action: 'cdp' as const, session: 'agent', surface: 'browser' as const, cdpMethod: 'Runtime.enable' };
  return { manager, command, detach };
}

describe('SLAB public CDP action cleanup', () => {
  it('detaches its command-local CDP session after success', async () => {
    const { manager, command, detach } = fixture(vi.fn().mockResolvedValue({ enabled: true }));
    await expect(dispatchSlabAction(manager as never, command)).resolves.toMatchObject({ ok: true });
    expect(detach).toHaveBeenCalledOnce();
  });

  it('detaches its command-local CDP session after send failure', async () => {
    const { manager, command, detach } = fixture(vi.fn().mockRejectedValue(new Error('send failed')));
    await expect(dispatchSlabAction(manager as never, command)).resolves.toMatchObject({ ok: false, error: 'send failed' });
    expect(detach).toHaveBeenCalledOnce();
  });
});
