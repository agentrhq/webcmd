import { access, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { SlabBridgeClient } from '../../src/slab/bridge-client.js';
import { createSlabInstallerIo, installSlabMacos } from '../../src/slab/install.js';
import { findSlabInstallation, slabControlEndpoint } from '../../src/slab/installation.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(process.env.WEBCMD_LIVE_SLAB_ALPHA !== '1')('SLAB alpha installer live gate', () => {
  it('installs from the explicit alpha manifest into an isolated home and answers hello', async () => {
    const manifestUrl = process.env.WEBCMD_SLAB_ALPHA_MANIFEST_URL;
    if (!manifestUrl) throw new Error('WEBCMD_SLAB_ALPHA_MANIFEST_URL is required when WEBCMD_LIVE_SLAB_ALPHA=1');
    if (findSlabInstallation({ platform: 'darwin', homeDir: homedir(), existsSync })) {
      throw new Error('Refusing to run live alpha installer against an existing daily SLAB app');
    }

    const testHome = await mkdtemp(join(tmpdir(), 'webcmd-slab-alpha-home-'));
    tempDirs.push(testHome);

    const installation = await installSlabMacos({
      ...createSlabInstallerIo(),
      homeDir: testHome,
      access: async (path, mode) => {
        if (path === '/Applications' && mode === constants.W_OK) {
          const error = new Error('permission denied') as Error & { code?: string };
          error.code = 'EACCES';
          throw error;
        }
        await access(path, mode);
      },
    }, {
      manifestUrl,
      launchAfterInstall: true,
    });

    expect(installation.appPath).toBe(join(testHome, 'Applications', 'SLAB.app'));

    const client = await SlabBridgeClient.connect(slabControlEndpoint(testHome), { timeoutMs: 5_000 });
    try {
      const hello = await client.hello();
      expect(hello.protocolVersion).toBe(1);
    } finally {
      await client.close();
    }
  }, 180_000);
});
