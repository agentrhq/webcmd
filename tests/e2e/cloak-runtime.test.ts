import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './helpers.js';

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
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

    res.end('<html><title>Cloak Smoke</title><body><button id="b">Go</button><script>window.answer = 42</script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Cloak runtime e2e', () => {
  it('opens a page and evaluates JavaScript through webcmd browser', async () => {
    const session = `cloak-smoke-${Date.now()}`;
    const open = await runCli(['browser', session, 'open', baseUrl], { timeout: 120_000 });
    expect(open.code).toBe(0);

    const evalResult = await runCli(['browser', session, 'eval', 'document.title + ":" + window.answer'], { timeout: 120_000 });
    expect(evalResult.code).toBe(0);
    expect(evalResult.stdout).toContain('Cloak Smoke:42');
  }, 180_000);

  it('persists cookies inside the Cloak profile', async () => {
    const session = `cloak-cookie-${Date.now()}`;
    expect((await runCli(['browser', session, 'open', `${baseUrl}/cookie`], { timeout: 120_000 })).code).toBe(0);
    const cookies = await runCli(['browser', session, 'eval', 'document.cookie'], { timeout: 120_000 });
    expect(cookies.code).toBe(0);
    expect(cookies.stdout).toContain('webcmd_smoke=ok');
  }, 180_000);
});
