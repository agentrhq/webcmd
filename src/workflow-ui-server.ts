import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planWithGemini } from './planner/gemini.js';
import { runBrowserWorkflow } from './planner/index.js';
import { sendCommand } from './browser/daemon-client.js';
import { profileRouteParams, resolveProfileSelection } from './browser/profile.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(root, '../ui');
const requestedPort = Number(process.env.WEBCMD_UI_PORT ?? 4317);

type RequestBody = { goal?: string; profile?: string; session?: string; model?: string };

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<RequestBody> {
  let raw = '';
  for await (const chunk of request) raw += String(chunk);
  try { return JSON.parse(raw) as RequestBody; } catch { return {}; }
}

async function workflow(request: IncomingMessage, execute: boolean): Promise<unknown> {
  const input = await body(request);
  if (!input.goal?.trim()) throw new Error('A natural-language goal is required.');
  const workflow = await planWithGemini(input.goal, { model: input.model });
  if (!execute) return { workflow };

  const profile = resolveProfileSelection(input.profile || 'default');
  const profileId = profile?.contextId ?? 'default';
  let session = input.session?.trim();
  let created = false;
  if (!session) {
    const createdData = await sendCommand('session-create', { contextId: profileId, sessionName: 'ui-workflow' });
    if (!createdData || typeof createdData !== 'object' || typeof (createdData as { id?: unknown }).id !== 'string') throw new Error('Browser daemon did not return a Session ID.');
    session = (createdData as { id: string }).id;
    created = true;
  }
  try {
    return { session, ...(await runBrowserWorkflow(workflow, { session, profile: input.profile, context: {} })) };
  } finally {
    if (created) {
      await sendCommand('session-close', { contextId: profileId, session, force: true, discard: true }).catch(() => undefined);
    }
  }
}

async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'styles.css', 'app.js'].includes(file)) { response.writeHead(404); response.end('Not found'); return; }
  const content = await readFile(path.join(uiDir, file));
  const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
  response.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
  response.end(content);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'POST' && request.url === '/api/plan') sendJson(response, 200, await workflow(request, false));
    else if (request.method === 'POST' && request.url === '/api/run') sendJson(response, 200, await workflow(request, true));
    else if (request.method === 'GET') await serveStatic(request, response);
    else sendJson(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

function listen(port: number): void {
  const onError = (error: NodeJS.ErrnoException): void => {
    server.off('error', onError);
    if (error.code === 'EADDRINUSE' && port < requestedPort + 20) {
      listen(port + 1);
      return;
    }
    throw error;
  };
  server.once('error', onError);
  server.listen(port, '127.0.0.1', () => {
    server.off('error', onError);
    console.log(`Webcmd workflow UI: http://127.0.0.1:${port}`);
  });
}

listen(requestedPort);
