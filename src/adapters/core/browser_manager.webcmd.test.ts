import { describe, expect, it, vi } from 'vitest';
import { BrowserManager } from './browser_manager.js';
import { FakeWebcmdClient } from '../webcmd/client.js';

describe('BrowserManager Webcmd delegation', () => {
  it('delegates lifecycle and safe page reads to a fake Webcmd client', async () => {
    const client = new FakeWebcmdClient({
      evaluate: vi.fn(async (fn: unknown) => String(fn).includes('title') ? 'Example Domain' : 'Example Domain body'),
    });
    const manager = new BrowserManager({ client });
    const session = await manager.startSession('test-session');

    const state = await manager.navigate(session, 'https://example.com');
      expect(state).toMatchObject({ url: 'https://example.com', title: 'Example Domain', content_found: true });
    expect(client.connectedSessions).toHaveLength(1);

    await manager.pauseSession(session);
    expect(session.isPaused).toBe(true);
    await expect(manager.readPage(session)).rejects.toThrow(/paused/i);
    expect(session.isClosed).toBe(false);

    await manager.closeSession(session);
    expect(client.closedPages).toHaveLength(1);
    expect(session.isClosed).toBe(true);
  });

  it('cleans up a failed safe smoke run', async () => {
    const client = new FakeWebcmdClient({
      goto: vi.fn(async () => { throw new Error('navigation failed'); }),
    });
    const manager = new BrowserManager({ client });

    const result = await manager.runSmokeTest('https://example.com');
    expect(result).toMatchObject({ success: false, status: 'failed', data: null });
    expect(client.closedPages).toHaveLength(1);
  });

  it('pauses without closing so a human can take over the live session', async () => {
    const client = new FakeWebcmdClient();
    const manager = new BrowserManager({ client });
    const session = await manager.startSession('handoff');

    await manager.pauseSession(session);
    expect(session.isPaused).toBe(true);
    expect(session.isClosed).toBe(false);
    expect(client.closedPages).toHaveLength(0);
  });
});