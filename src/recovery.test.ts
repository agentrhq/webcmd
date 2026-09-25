import { describe, expect, it } from 'vitest';
import { DangerousActionError, RecoveryManager } from './recovery.js';

describe('RecoveryManager', () => {
  it('retries safe failures up to the default maximum', async () => {
    let attempts = 0;
    const value = await RecoveryManager.retry(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporary');
      return 'ok';
    }, { baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 });

    expect(value).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('rejects dangerous actions', async () => {
    await expect(
      RecoveryManager.retry(async () => 'never', { dangerousAction: true }),
    ).rejects.toBeInstanceOf(DangerousActionError);
  });
});
