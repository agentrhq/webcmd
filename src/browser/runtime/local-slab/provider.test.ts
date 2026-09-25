import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalBrowserRuntimeProvider } from './provider.js';

describe('LocalSlabRuntimeProvider Session lifecycle', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes explicit Session records when user close requests discard', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-slab-provider-'));
    tempDirs.push(baseDir);
    const provider = createLocalBrowserRuntimeProvider({
      baseDir,
      statusBridge: vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        hello: vi.fn().mockResolvedValue({
          protocolVersion: 2,
          browserVersion: '152.0.7977.65',
          browserPid: 1234,
          profiles: [{ id: 'default', displayName: 'Default' }],
        }),
      }),
    });

    const session = await provider.createSession({
      id: 'create',
      action: 'session-create',
      contextId: 'default',
      sessionName: 'Smoke',
    });

    await expect(provider.listSessions({ profileId: 'default', includeDiscovered: false })).resolves.toHaveLength(1);
    await expect(provider.closeSession({
      id: 'close',
      action: 'session-close',
      contextId: 'default',
      session: session.id,
      discard: true,
    })).resolves.toMatchObject({ session: session.id });
    await expect(provider.listSessions({ profileId: 'default', includeDiscovered: false })).resolves.toEqual([]);
  });
});
