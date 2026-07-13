import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getConfigPath } from './config.js';
import { runHostedSetup } from './setup.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('webcmd setup', () => {
  it('writes local mode from interactive answer', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-'));
    const answers = ['local'];
    const messages: string[] = [];
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;

    const code = await runHostedSetup({
      env,
      now: () => new Date('2026-07-08T00:00:00.000Z'),
      question: async () => answers.shift() ?? '',
      write: (message) => messages.push(message),
    });

    expect(code).toBe(0);
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toEqual({
      mode: 'local',
      updatedAt: '2026-07-08T00:00:00.000Z',
    });
    expect(messages.join('')).toContain('local mode');
  });

  it('writes hosted mode and validates with /v1/me', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webcmd-setup-'));
    const answers = ['hosted', 'wcmd_live_test'];
    const env = { WEBCMD_CONFIG_DIR: tempDir } as NodeJS.ProcessEnv;
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const prompts: string[] = [];

    const code = await runHostedSetup({
      env,
      now: () => new Date('2026-07-08T00:00:00.000Z'),
      question: async (prompt) => {
        prompts.push(prompt);
        return answers.shift() ?? '';
      },
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: new Headers(init?.headers).get('authorization'),
        });
        return new Response(JSON.stringify({ ok: true, user: { id: 'user_demo' } }), { status: 200 });
      },
      write: () => undefined,
    });

    expect(code).toBe(0);
    expect(prompts).toEqual([
      'Use hosted Webcmd Cloud or local Webcmd? [hosted/local] ',
      'Webcmd API key: ',
    ]);
    expect(requests).toEqual([{ url: 'https://api.webcmd.dev/v1/me', authorization: 'Bearer wcmd_live_test' }]);
    expect(JSON.parse(await readFile(getConfigPath({ env }), 'utf8'))).toMatchObject({
      mode: 'hosted',
      hosted: {
        apiBaseUrl: 'https://api.webcmd.dev',
        apiKey: 'wcmd_live_test',
      },
    });
  });
});
