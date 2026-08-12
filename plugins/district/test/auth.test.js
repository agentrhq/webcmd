import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import '../auth.js';

describe('district auth', () => {
  it('opens the avatar login modal without waiting for full page load', async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce({ status: 401, text: '', data: null })
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
    };

    await expect(getRegistry().get('district/login').func(page, {}))
      .resolves.toEqual([expect.objectContaining({ status: 'action_required' })]);

    expect(page.goto).toHaveBeenCalledWith('https://www.district.in', {
      waitUntil: 'none',
      settleMs: 1000,
    });
    expect(page.evaluate.mock.calls[1][0]).toContain('User Avatar');
    expect(page.evaluate.mock.calls[2][0]).toContain('mobileNumber');
  });
});
