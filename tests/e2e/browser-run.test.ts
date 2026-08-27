import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonOutput, type CliResult } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = path.join(ROOT, 'dist', 'src', 'main.js');
const DAEMON_PORT = 9777;

async function runCliWithStdin(args: string[], input: string, env: Record<string, string>): Promise<CliResult> {
  return await new Promise((resolve) => {
    const child = spawn(process.env.WEBCMD_TEST_RUNTIME || 'node', [MAIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', () => resolve({ stdout: '', stderr: '', code: 1 }));
    child.on('close', code => resolve({
      stdout: Buffer.concat(stdout).toString('utf-8'),
      stderr: Buffer.concat(stderr).toString('utf-8'),
      code: code ?? 1,
    }));
    child.stdin.end(input);
  });
}

async function stopDaemon(): Promise<void> {
  await fetch(`http://127.0.0.1:${DAEMON_PORT}/shutdown`, {
    method: 'POST',
    headers: { 'X-Webcmd': '1' },
    signal: AbortSignal.timeout(3_000),
  }).catch(() => undefined);
}

async function startFixture(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/download') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Disposition': 'attachment; filename="receipt.txt"',
      });
      res.end('receipt');
      return;
    }
    if (req.url === '/popup') {
      res.end('<title>Popup receipt</title><p>popup ready</p>');
      return;
    }
    res.end(`
      <title>Lifecycle</title>
      <label>Name <input id="name"></label>
      <button id="save" onclick="document.querySelector('#status').textContent = document.querySelector('#name').value">Save</button>
      <p id="status"></p>
      <a id="popup" href="/popup" target="_blank">Popup</a>
      <a id="download" href="/download" download>Download</a>
    `);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe('browser run local lifecycle', () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    await stopDaemon();
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    })));
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
  });

  it('keeps browser state while each stdin run gets a fresh JavaScript scope', async () => {
    await stopDaemon();
    const fixture = await startFixture();
    servers.push(fixture.server);
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcmd-browser-run-'));
    tempDirs.push(cacheDir);
    const env = { WEBCMD_CACHE_DIR: cacheDir, WEBCMD_CONFIG_DIR: cacheDir };

    const created = await runCliWithStdin(['session', 'create', 'browser-run-e2e', '-f', 'json'], '', env);
    expect(created.code).toBe(0);
    const session = parseJsonOutput(created.stdout).id as string;

    const first = await runCliWithStdin(['--session', session, 'browser', 'run', '--stdin'], `
      globalThis.onlyThisRun = 'gone';
      await page.goto(${JSON.stringify(fixture.url)});
      await page.locator('#name').fill('Ada');
      await page.locator('#save').click();
      const popupPromise = context.waitForEvent('page');
      await page.locator('#popup').click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#download').click();
      const download = await downloadPromise;
      await page.screenshot({ path: 'lifecycle.png' });
      return {
        saved: await page.locator('#status').innerText(),
        popupTitle: await popup.title(),
        download: download.suggestedFilename(),
      };
    `, env);

    expect(first.code).toBe(0);
    const firstData = parseJsonOutput(first.stdout);
    expect(firstData).toMatchObject({
      result: {
        saved: 'Ada',
        popupTitle: 'Popup receipt',
        download: 'receipt.txt',
      },
      artifacts: [expect.objectContaining({ filename: 'lifecycle.png', contentType: 'image/png' })],
    });
    expect(firstData.snapshotDiff).toContain('Ada');

    const snapshot = await runCliWithStdin(['--session', session, 'browser', 'snapshot', '--snapshot-mode', 'act'], '', env);
    expect(snapshot.code).toBe(0);
    expect(snapshot.stdout).toContain('Ada');

    const second = await runCliWithStdin(['--session', session, 'browser', 'run', '--stdin', '--no-snapshot-diff'], `
      return {
        saved: await page.locator('#status').innerText(),
        variable: typeof globalThis.onlyThisRun,
      };
    `, env);
    expect(second.code).toBe(0);
    const secondData = parseJsonOutput(second.stdout);
    expect(secondData).toMatchObject({
      result: { saved: 'Ada', variable: 'undefined' },
    });
    expect(secondData).not.toHaveProperty('snapshotDiff');

    const tabs = await runCliWithStdin(['--session', session, 'browser', 'tabs'], '', env);
    expect(tabs.code).toBe(0);
    const popup = parseJsonOutput(tabs.stdout).find((tab: { title: string }) => tab.title === 'Popup receipt');
    expect(popup).toMatchObject({ id: expect.any(String) });

    const bound = await runCliWithStdin(['--session', session, 'browser', 'bind', '--page', popup.id], '', env);
    expect(bound.code).toBe(0);
    expect(parseJsonOutput(bound.stdout)).toMatchObject({ page: popup.id, title: 'Popup receipt' });

    const closed = await runCliWithStdin(['--session', session, 'browser', 'close'], '', env);
    expect(closed.code).toBe(0);
    expect(parseJsonOutput(closed.stdout)).toMatchObject({ closed: true });

    const tabsAfterClose = await runCliWithStdin(['--session', session, 'browser', 'tabs'], '', env);
    expect(tabsAfterClose.code).toBe(0);
    expect(parseJsonOutput(tabsAfterClose.stdout)).toEqual([]);
  }, 120_000);
});
