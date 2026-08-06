import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonOutput, runCli } from './helpers.js';

const DAEMON_PORT = 9777;
const PKG_VERSION: string = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', 'package.json'),
  'utf-8',
)).version;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stopDaemon(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = request({
      host: '127.0.0.1',
      port: DAEMON_PORT,
      path: '/shutdown',
      method: 'POST',
      headers: { 'X-Webcmd': '1' },
      timeout: 500,
    }, res => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', resolve);
    req.on('timeout', () => req.destroy());
    req.end();
  });
}

function json(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
}

async function startFakeDaemon(): Promise<{ close: () => Promise<void>; lastRunSource: () => string | undefined }> {
  await stopDaemon();
  let source: string | undefined;
  const server = createServer(async (req, res) => {
    const pathname = req.url?.split('?')[0];
    if (req.method === 'GET' && pathname === '/status') {
      json(res, { ok: true, daemonVersion: PKG_VERSION, runtimeConnected: true });
      return;
    }
    if (req.method === 'POST' && pathname === '/command') {
      const body = await readBody(req);
      switch (body.action) {
        case 'tabs':
          json(res, { id: body.id, ok: true, data: [
            { id: 'page-one', page: 'page-one', title: 'One', url: 'https://one.example/' },
            { id: 'page-two', page: 'page-two', title: 'Two', url: 'https://two.example/' },
          ] });
          return;
        case 'bind':
          json(res, { id: body.id, ok: true, page: body.page, data: {
            bound: true,
            page: body.page,
            title: body.page === 'page-two' ? 'Two' : 'One',
          } });
          return;
        case 'run':
          source = typeof body.source === 'string' ? body.source : undefined;
          json(res, { id: body.id, ok: true, data: { result: 'ran' } });
          return;
        case 'close-window':
          json(res, { id: body.id, ok: true, data: { closed: true } });
          return;
        default:
          json(res, { id: body.id, ok: false, error: `Unexpected action: ${String(body.action)}` });
          return;
      }
    }
    json(res, { ok: false, error: 'Not found' });
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(DAEMON_PORT, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt === 9) throw error;
      await sleep(100);
    }
  }
  return {
    close: async () => await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    lastRunSource: () => source,
  };
}

describe('browser public command surface e2e', () => {
  const daemons: Array<{ close: () => Promise<void> }> = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (daemons.length) await daemons.pop()!.close();
    while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it('uses tabs, bind, run, and close through the built CLI', async () => {
    const daemon = await startFakeDaemon();
    daemons.push(daemon);
    const session = 'four-command-surface';
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-browser-tabs-'));
    tempDirs.push(tempDir);
    const sourcePath = path.join(tempDir, 'program.js');
    fs.writeFileSync(sourcePath, "return 'from file';");

    const tabs = await runCli(['browser', session, 'tabs']);
    expect(tabs.code).toBe(0);
    expect(parseJsonOutput(tabs.stdout)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'page-one', title: 'One' }),
      expect.objectContaining({ id: 'page-two', title: 'Two' }),
    ]));

    const bound = await runCli(['browser', session, 'bind', '--page', 'page-two']);
    expect(bound.code).toBe(0);
    expect(parseJsonOutput(bound.stdout)).toMatchObject({ bound: true, page: 'page-two', title: 'Two' });

    const run = await runCli(['browser', session, 'run', '--file', sourcePath]);
    expect(run.code).toBe(0);
    expect(parseJsonOutput(run.stdout)).toEqual({ result: 'ran' });
    expect(daemon.lastRunSource()).toBe("return 'from file';");

    const closed = await runCli(['browser', session, 'close']);
    expect(closed.code).toBe(0);
    expect(parseJsonOutput(closed.stdout)).toEqual({ closed: true });
  }, 30_000);
});
