import { describe, expect, it } from 'vitest';
import { BrowserManager } from './adapters/core/browser_manager.js';

describe('PC2A BrowserManager smoke test', () => {
  it('runs start -> navigate -> read -> structured JSON against a real page', async () => {
    const browser = new BrowserManager();
    const result = await browser.runSmokeTest('https://example.com');
    console.log('SMOKE TEST RESULT:', JSON.stringify(result, null, 2));

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.data?.title.length).toBeGreaterThan(0);
    expect(result.data?.content_found).toBe(true);
  }, 120_000);
});
