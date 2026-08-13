import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './helpers.js';

let server: http.Server;
let baseUrl = '';
const sourceDirs: string[] = [];
let sharedConfigDir = '';
let sharedProfile = '';

function isolatedOptions(options: Parameters<typeof runCli>[1] = {}): Parameters<typeof runCli>[1] {
  return {
    ...options,
    env: {
      HOME: path.join(sharedConfigDir, 'home'),
      USERPROFILE: path.join(sharedConfigDir, 'home'),
      WEBCMD_CONFIG_DIR: sharedConfigDir,
      WEBCMD_PROFILE: sharedProfile,
      ...options.env,
    },
  };
}

function browserRun(session: string, source: string, options: Parameters<typeof runCli>[1] = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cloak-run-'));
  sourceDirs.push(dir);
  const sourcePath = path.join(dir, 'program.js');
  fs.writeFileSync(sourcePath, source);
  return runCli(['--session', session, 'browser', 'run', '--file', sourcePath], isolatedOptions(options));
}

async function createSession(options: Parameters<typeof runCli>[1] = {}) {
  const result = await runCli(['session', 'create', '-f', 'json'], isolatedOptions(options));
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout).id as string;
}

beforeAll(async () => {
  sharedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cloak-suite-'));
  sharedProfile = `cloak-suite-${Date.now()}`;
  sourceDirs.push(sharedConfigDir);
  server = http.createServer((req, res) => {
    if (req.url === '/cookie') {
      res.setHeader('Set-Cookie', 'webcmd_smoke=ok; Path=/');
      res.end('<html><title>Cookie</title><body>cookie</body></html>');
      return;
    }

    if (req.url === '/api') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname === '/counter') {
      const index = requestUrl.searchParams.get('index');
      if (!index || !/^\d+$/.test(index)) {
        res.statusCode = 400;
        res.end('invalid counter index');
        return;
      }
      res.end(`<html><title>Counter ${index}</title><body data-index="${index}">counter</body></html>`);
      return;
    }

    res.end('<html><title>Cloak Smoke</title><body><button id="b">Go</button><script>window.answer = 42</script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of sourceDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Cloak runtime e2e', () => {
  it('runs Playwright against a page through webcmd browser', async () => {
    const session = await createSession({ timeout: 120_000 });
    const result = await browserRun(session, `
      await page.goto(${JSON.stringify(baseUrl)});
      return await page.evaluate(() => document.title + ':' + window.answer);
    `, { timeout: 120_000 });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Cloak Smoke:42');
  }, 180_000);

  it('persists cookies inside the Cloak profile', async () => {
    const session = await createSession({ timeout: 120_000 });
    const cookies = await browserRun(session, `
      await page.goto(${JSON.stringify(`${baseUrl}/cookie`)});
      return await page.evaluate(() => document.cookie);
    `, { timeout: 120_000 });
    expect(cookies.code).toBe(0);
    expect(cookies.stdout).toContain('webcmd_smoke=ok');
  }, 180_000);

  it('survives sequential open and evaluate cycles in one persistent profile', async () => {
    const profile = `task5-${Date.now()}`;
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-cloak-sequential-'));
    const run = (args: string[]) => runCli(args, {
      timeout: 120_000,
      env: {
        WEBCMD_CONFIG_DIR: configDir,
        WEBCMD_PROFILE: profile,
      },
    });
    const waitForStoppedDaemon = async () => {
      let status = await run(['daemon', 'status']);
      for (let attempt = 0; attempt < 20 && !status.stdout.includes('Daemon: not running'); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 250));
        status = await run(['daemon', 'status']);
      }
      return status;
    };
    let stopCode: number | undefined;
    let stoppedStatus = { stdout: '', stderr: '', code: 1 };

    try {
      expect((await run(['daemon', 'stop'])).code).toBe(0);
      expect((await waitForStoppedDaemon()).stdout).toContain('Daemon: not running');

      try {
        const session = await createSession({
          timeout: 120_000,
          env: { WEBCMD_CONFIG_DIR: configDir, WEBCMD_PROFILE: profile },
        });
        expect((await browserRun(session, `await page.goto(${JSON.stringify(`${baseUrl}/cookie`)}); return null;`, {
          timeout: 120_000,
          env: { WEBCMD_CONFIG_DIR: configDir, WEBCMD_PROFILE: profile },
        })).code).toBe(0);

        for (let index = 0; index < 3; index += 1) {
          const evaluated = await browserRun(session, `
            await page.goto(${JSON.stringify(`${baseUrl}/counter?index=${index}`)});
            return await page.locator('body').getAttribute('data-index');
          `, {
            timeout: 120_000,
            env: { WEBCMD_CONFIG_DIR: configDir, WEBCMD_PROFILE: profile },
          });
          expect(evaluated.code).toBe(0);
          expect(evaluated.stdout).toContain(`"result": "${index}"`);
        }

        const cookies = await browserRun(session, 'return await page.evaluate(() => document.cookie);', {
          timeout: 120_000,
          env: { WEBCMD_CONFIG_DIR: configDir, WEBCMD_PROFILE: profile },
        });
        expect(cookies.code).toBe(0);
        expect(cookies.stdout).toContain('webcmd_smoke=ok');

        const status = await run(['daemon', 'status']);
        expect(status.code).toBe(0);
        expect(status.stdout).toContain('Daemon: running');
        expect(status.stdout).toContain('Runtime: cloak connected');
        expect(status.stdout).toContain(`Profiles: ${profile}`);
      } finally {
        const stopped = await run(['daemon', 'stop']);
        stopCode = stopped.code;
      }

    } finally {
      if (stopCode !== undefined) {
        stoppedStatus = await waitForStoppedDaemon();
      }
      fs.rmSync(configDir, { recursive: true, force: true });
    }

    expect(stopCode).toBe(0);
    expect(stoppedStatus.code).toBe(0);
    expect(stoppedStatus.stdout).toContain('Daemon: not running');
  }, 480_000);
});
