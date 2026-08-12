import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CloakSessionManager } from '../../src/browser/runtime/local-cloak/session-manager.js';

let server: http.Server;
let baseUrl = '';
const tempDirs: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.end(`<html><title>${url.pathname}</title><body>${url.pathname}</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Cloak Session concurrency gate', () => {
  it('creates subsequent Session pages as tabs in the existing window', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cloak-session-gate-'));
    tempDirs.push(configDir);
    const manager = new CloakSessionManager({ baseDir: configDir });
    const key = {
      profileId: `gate-${Date.now()}`,
      session: 'session_11111111-1111-4111-8111-111111111111',
      sessionId: 'session_11111111-1111-4111-8111-111111111111',
      surface: 'browser' as const,
    };
    try {
      const first = await manager.getPage(key);
      await first.page.goto(`${baseUrl}/first`);
      const second = await manager.newPage(key);
      await second.page.goto(`${baseUrl}/second`);
      const windowId = async (page: typeof first.page) => {
        const cdp = await first.context.newCDPSession(page);
        try {
          const target = await cdp.send('Target.getTargetInfo');
          return (await cdp.send('Browser.getWindowForTarget', { targetId: target.targetInfo.targetId })).windowId;
        } finally {
          await cdp.detach();
        }
      };

      expect(await windowId(second.page)).toBe(await windowId(first.page));
      expect((await manager.listPages(key)).map((tab) => tab.url)).toEqual([
        `${baseUrl}/first`,
        `${baseUrl}/second`,
      ]);
    } finally {
      await manager.shutdown();
    }
  }, 180_000);
});
