import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CloakSessionManager } from '../../src/browser/runtime/local-cloak/session-manager.js';
import { findExactCloakProfileProcesses } from '../../src/browser/runtime/local-cloak/process-matcher.js';
import { resolveCloakProfileDir } from '../../src/browser/runtime/local-cloak/profiles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let server: http.Server;
let baseUrl = '';
const tempDirs: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.end(`<html><title>${url.pathname}</title><body><script>document.body.dataset.referrer = document.referrer; document.body.dataset.hasOpener = String(Boolean(window.opener));</script>${url.pathname}</body></html>`);
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

describe.skipIf(process.env.WEBCMD_LIVE_CLOAK !== '1')('Cloak Session concurrency gate', () => {
  it('keeps Cloak and Playwright pinned to the supported live gate runtime', () => {
    const appPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const cloakPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/cloakbrowser/package.json'), 'utf8'));
    const playwrightPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/playwright-core/package.json'), 'utf8'));
    const cloakConfig = fs.readFileSync(path.join(ROOT, 'node_modules/cloakbrowser/dist/config.js'), 'utf8');

    expect(appPkg.dependencies.cloakbrowser).toBe('0.4.5');
    expect(appPkg.dependencies['playwright-core']).toBe('1.61.1');
    expect(cloakPkg.version).toBe('0.4.5');
    expect(playwrightPkg.version).toBe('1.61.1');
    expect(cloakConfig).toContain('"darwin-arm64": "145.0.7632.109.2"');
  });

  it('covers isolated Profiles, explicit Session windows, noopener pages, close survival, and keeper repair', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cloak-session-gate-'));
    tempDirs.push(configDir);
    const manager = new CloakSessionManager({ baseDir: configDir });
    const profileA = `gate-a-${Date.now()}`;
    const profileB = `gate-b-${Date.now()}`;
    const keyA = {
      profileId: profileA,
      session: 'session_11111111-1111-4111-8111-111111111111',
      sessionId: 'session_11111111-1111-4111-8111-111111111111',
      surface: 'browser' as const,
    };
    const keyB = { ...keyA, profileId: profileB, session: 'session_22222222-2222-4222-8222-222222222222', sessionId: 'session_22222222-2222-4222-8222-222222222222' };
    const keyA2 = { ...keyA, session: 'session_33333333-3333-4333-8333-333333333333', sessionId: 'session_33333333-3333-4333-8333-333333333333' };
    const windowId = async (page: Awaited<ReturnType<CloakSessionManager['getPage']>>['page']) => {
      const cdp = await page.context().newCDPSession(page);
      try {
        const target = await cdp.send('Target.getTargetInfo') as { targetInfo: { targetId: string } };
        return (await cdp.send('Browser.getWindowForTarget', { targetId: target.targetInfo.targetId }) as { windowId: number }).windowId;
      } finally {
        await cdp.detach();
      }
    };
    try {
      const [first, profileBFirst] = await Promise.all([manager.getPage(keyA), manager.getPage(keyB)]);
      await Promise.all([
        first.page.goto(`${baseUrl}/first`),
        profileBFirst.page.goto(`${baseUrl}/profile-b`),
      ]);

      const otherSession = await manager.getPage(keyA2);
      await otherSession.page.goto(`${baseUrl}/other-session`);
      expect(await windowId(otherSession.page)).not.toBe(await windowId(first.page));

      await first.page.bringToFront();
      expect(await first.page.evaluate(() => document.hasFocus())).toBe(true);

      const second = await manager.newPage({ ...keyA, windowMode: 'background' });
      await second.page.goto(`${baseUrl}/second`);

      expect(await windowId(second.page)).toEqual(expect.any(Number));
      expect(await second.page.evaluate(() => window.opener === null)).toBe(true);
      expect(await second.page.evaluate(() => document.referrer)).toBe('');
      expect(await first.page.evaluate(() => document.hasFocus())).toBe(true);
      expect((await manager.listPages(keyA)).map((tab) => tab.url)).toEqual([
        `${baseUrl}/first`,
        `${baseUrl}/second`,
      ]);

      await manager.closeSession(profileA, keyA.sessionId);
      await profileBFirst.page.goto(`${baseUrl}/profile-b-after-a-close`);
      expect(await profileBFirst.page.title()).toBe('/profile-b-after-a-close');

      await manager.closeSession(profileB, keyB.sessionId);
      const afterFinalClose = await manager.getPage(keyB);
      await afterFinalClose.page.goto(`${baseUrl}/keeper-survived`);
      expect(await afterFinalClose.page.title()).toBe('/keeper-survived');
    } finally {
      await manager.shutdown();
    }
  }, 180_000);

  it('falls back to a Session-owned page when window.open is blocked', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cloak-fallback-gate-'));
    tempDirs.push(configDir);
    const manager = new CloakSessionManager({ baseDir: configDir });
    const key = {
      profileId: `gate-fallback-${Date.now()}`,
      session: 'session_44444444-4444-4444-8444-444444444444',
      sessionId: 'session_44444444-4444-4444-8444-444444444444',
      surface: 'browser' as const,
    };
    try {
      const first = await manager.getPage(key);
      await first.page.goto(`${baseUrl}/first`);
      await first.page.evaluate(() => {
        (window as unknown as { open: () => null }).open = () => null;
      });

      const fallback = await manager.newPage({ ...key, windowMode: 'background' });
      await fallback.page.goto(`${baseUrl}/fallback`);

      expect(await fallback.page.evaluate(() => window.opener === null)).toBe(true);
      expect((await manager.listPages(key)).map((tab) => tab.url)).toEqual([
        `${baseUrl}/first`,
        `${baseUrl}/fallback`,
      ]);
    } finally {
      await manager.shutdown();
    }
  }, 180_000);

  it('distinguishes work and work-2 Cloak processes from real ps output', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cloak-process-gate-'));
    tempDirs.push(configDir);
    const manager = new CloakSessionManager({ baseDir: configDir });
    const work = { profileId: 'work', session: 'session_55555555-5555-4555-8555-555555555555', sessionId: 'session_55555555-5555-4555-8555-555555555555', surface: 'browser' as const };
    const work2 = { profileId: 'work-2', session: 'session_66666666-6666-4666-8666-666666666666', sessionId: 'session_66666666-6666-4666-8666-666666666666', surface: 'browser' as const };
    try {
      const [workPage, work2Page] = await Promise.all([manager.getPage(work), manager.getPage(work2)]);
      await Promise.all([
        workPage.page.goto(`${baseUrl}/work`),
        work2Page.page.goto(`${baseUrl}/work-2`),
      ]);

      const workProcesses = await findExactCloakProfileProcesses(resolveCloakProfileDir('work', { baseDir: configDir }));
      const work2Processes = await findExactCloakProfileProcesses(resolveCloakProfileDir('work-2', { baseDir: configDir }));
      expect(workProcesses.length).toBeGreaterThan(0);
      expect(work2Processes.length).toBeGreaterThan(0);
      expect(workProcesses.every(pid => !work2Processes.includes(pid))).toBe(true);
    } finally {
      await manager.shutdown();
    }
  }, 180_000);
});
