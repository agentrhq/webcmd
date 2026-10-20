import { describe, expect, it, vi } from 'vitest';
import { BrowserManager } from '../core/browser_manager.js';
import { FakeWebcmdClient } from './client.js';
import { runCoreSmoke } from './core-smoke.js';

describe('PC2A core-smoke runner', () => {
  it('runs start -> navigate -> readPage and returns valid StandardResult on success', async () => {
    const client = new FakeWebcmdClient({
      evaluate: vi.fn(async (fn: unknown) =>
        String(fn).includes('title') ? 'Example Domain' : 'Example Domain content',
      ),
    });
    const browser = new BrowserManager({ client });

    const result = await runCoreSmoke(browser, 'https://example.com');

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.adapter).toBe('webcmd-core');
    expect(result.action).toBe('browser_smoke_test');
    expect(result.data).toMatchObject({
      url: 'https://example.com',
      title: 'Example Domain',
      content_found: true,
      isSensitive: false,
      isPaused: false,
    });
    expect(result.metadata.source).toBe('webcmd');
    expect(result.error).toBeNull();
    expect(client.connectedSessions).toHaveLength(1);
    expect(client.closedPages).toHaveLength(1);
  });

  it('safely handles failures, returns failure StandardResult, and ensures session is closed', async () => {
    const client = new FakeWebcmdClient({
      goto: vi.fn(async () => {
        throw new Error('Navigation timed out');
      }),
    });
    const browser = new BrowserManager({ client });

    const result = await runCoreSmoke(browser, 'https://example.com');

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.adapter).toBe('webcmd-core');
    expect(result.action).toBe('browser_smoke_test');
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      code: 'SMOKE_TEST_FAILED',
      message: 'Navigation timed out',
    });
    expect(client.closedPages).toHaveLength(1);
  });
});
