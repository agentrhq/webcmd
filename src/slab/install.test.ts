import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { installSlabMacos, replaceSlabAppAtomically, type SlabInstallerIo } from './install.js';

const releaseBytes = Buffer.from('signed-slab-dmg');
const releaseSha256 = createHash('sha256').update(releaseBytes).digest('hex');

function fakeInstaller(options: {
  expectedSha256?: string;
  downloadedBytes?: Buffer;
  bundleId?: string;
  verifyManifest?: boolean;
  failCommand?: 'codesign' | 'xattr';
  xattrAbsent?: boolean;
} = {}) {
  const operations: string[] = [];
  const writes: string[] = [];
  const execFile = vi.fn(async (command: string, args: string[]) => {
    if (command === options.failCommand) throw new Error(`${command} rejected the staged app`);
    if (command === 'hdiutil' && args[0] === 'attach') operations.push('mount-readonly');
    if (command === 'hdiutil' && args[0] === 'detach') operations.push('detach');
    if (command === 'ditto') operations.push('copy-to-staging');
    if (command === 'codesign') operations.push('codesign-verify');
    if (command === 'xattr') {
      operations.push('clear-quarantine');
      if (options.xattrAbsent) {
        const error = new Error('No such xattr: com.apple.quarantine') as Error & { stderr?: string };
        error.stderr = 'xattr: No such xattr: com.apple.quarantine';
        throw error;
      }
    }
  });
  const replaceApp = vi.fn(async () => { operations.push('replace-app'); });
  const access = vi.fn(async () => {});
  const io: SlabInstallerIo & { operations(): string[]; execFile: typeof execFile; replaceApp: typeof replaceApp; access: typeof access } = {
    homeDir: '/Users/me',
    tempDir: '/tmp',
    fetch: async (url) => url.endsWith('.json')
      ? { ok: true, json: async () => ({ url: 'https://downloads.webcmd.dev/slab/SLAB.dmg', sha256: options.expectedSha256 ?? releaseSha256, signature: 'release-signature' }) }
      : { ok: true, arrayBuffer: async () => {
        const bytes = options.downloadedBytes ?? releaseBytes;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      } },
    execFile,
    mkdtemp: async () => '/tmp/slab-install',
    writeFile: async () => { operations.push('download'); },
    sha256: async bytes => {
      operations.push('checksum');
      return createHash('sha256').update(bytes).digest('hex');
    },
    mkdir: async () => {},
    rm: async () => { operations.push('cleanup'); },
    access,
    replaceApp,
    verifyManifest: () => options.verifyManifest ?? true,
    bundleId: async () => options.bundleId ?? 'dev.webcmd.slab',
    write: async message => { writes.push(message); },
    operations: () => operations.filter(operation => operation !== 'cleanup'),
  };
  return { ...io, writes };
}

describe('SLAB macOS installer', () => {
  it('rejects an invalid manifest signature before download', async () => {
    const io = fakeInstaller({ verifyManifest: false });

    await expect(installSlabMacos(io)).rejects.toThrow('SLAB installer release signature verification failed');
    expect(io.execFile).not.toHaveBeenCalled();
  });

  it('verifies SHA-256 before mounting the DMG', async () => {
    const io = fakeInstaller({ expectedSha256: '00'.repeat(32), downloadedBytes: Buffer.from('not-the-release') });

    await expect(installSlabMacos(io)).rejects.toThrow('SLAB installer checksum mismatch');
    expect(io.execFile).not.toHaveBeenCalled();
  });

  it('mounts the downloaded DMG read-only and stages it before replacement', async () => {
    const io = fakeInstaller();

    await installSlabMacos(io);

    expect(io.execFile).toHaveBeenCalledWith('hdiutil', expect.arrayContaining(['attach', '-readonly', '-nobrowse', '-mountpoint']));
    expect(io.operations()).toEqual([
      'download', 'checksum', 'mount-readonly', 'copy-to-staging',
      'codesign-verify', 'clear-quarantine', 'replace-app', 'detach',
    ]);
    expect(io.replaceApp).toHaveBeenCalledWith('/Applications/.SLAB.app.webcmd-staging', '/Applications/SLAB.app');
  });

  it('rejects a staged app with the wrong bundle identifier', async () => {
    await expect(installSlabMacos(fakeInstaller({ bundleId: 'com.example.other' })))
      .rejects.toThrow('SLAB installer bundle identifier mismatch');
  });

  it.each(['codesign', 'xattr'] as const)('does not replace the app when %s verification fails', async (failCommand) => {
    const io = fakeInstaller({ failCommand });

    await expect(installSlabMacos(io)).rejects.toThrow(`${failCommand} rejected the staged app`);
    expect(io.replaceApp).not.toHaveBeenCalled();
  });

  it('treats an absent quarantine attribute as harmless', async () => {
    const io = fakeInstaller({ xattrAbsent: true });

    await expect(installSlabMacos(io)).resolves.toMatchObject({
      appPath: '/Applications/SLAB.app',
    });
    expect(io.replaceApp).toHaveBeenCalled();
  });

  it('removes only the quarantine xattr after verification and before replacement', async () => {
    const io = fakeInstaller();

    await installSlabMacos(io);

    expect(io.execFile).toHaveBeenCalledWith('xattr', ['-dr', 'com.apple.quarantine', '/Applications/.SLAB.app.webcmd-staging']);
    expect(io.operations()).toEqual([
      'download', 'checksum', 'mount-readonly', 'copy-to-staging',
      'codesign-verify', 'clear-quarantine', 'replace-app', 'detach',
    ]);
  });

  it('reports percent and byte progress when Content-Length is known', async () => {
    const bytes = Buffer.from('signed-slab-dmg');
    const io = fakeInstaller({
      downloadedBytes: bytes,
    });
    io.fetch = async (url) => url.endsWith('.json')
      ? { ok: true, json: async () => ({ url: 'https://downloads.webcmd.dev/slab/SLAB.dmg', sha256: releaseSha256, signature: 'release-signature' }) }
      : {
        ok: true,
        headers: { get: (name: string) => name.toLowerCase() === 'content-length' ? String(bytes.length) : null },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 4));
            controller.enqueue(bytes.subarray(4));
            controller.close();
          },
        }),
      };

    await installSlabMacos(io);

    expect(io.writes.join('')).toContain('100%');
    expect(io.writes.join('')).toContain(`${bytes.length.toFixed(1)} B / ${bytes.length.toFixed(1)} B`);
  });

  it('reports downloaded bytes when Content-Length is unknown', async () => {
    const bytes = Buffer.from('signed-slab-dmg');
    const io = fakeInstaller({
      downloadedBytes: bytes,
    });
    io.fetch = async (url) => url.endsWith('.json')
      ? { ok: true, json: async () => ({ url: 'https://downloads.webcmd.dev/slab/SLAB.dmg', sha256: releaseSha256, signature: 'release-signature' }) }
      : {
        ok: true,
        headers: { get: () => null },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 4));
            controller.enqueue(bytes.subarray(4));
            controller.close();
          },
        }),
      };

    await installSlabMacos(io);

    expect(io.writes.join('')).not.toContain('%');
    expect(io.writes.join('')).toContain(`${bytes.length.toFixed(1)} B`);
  });

  it('checks system Applications write access before choosing its staging directory', async () => {
    const io = fakeInstaller();

    await installSlabMacos(io);

    expect(io.access).toHaveBeenCalledWith('/Applications', constants.W_OK);
  });

  it('rolls the existing app back when the staging rename fails', async () => {
    const rename = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('destination busy'))
      .mockResolvedValueOnce(undefined);
    const rm = vi.fn(async () => {});

    await expect(replaceSlabAppAtomically({ rename, rm }, '/Applications/.SLAB.app.webcmd-staging', '/Applications/SLAB.app'))
      .rejects.toThrow('destination busy');
    expect(rename).toHaveBeenNthCalledWith(1, '/Applications/SLAB.app', '/Applications/SLAB.app.previous');
    expect(rename).toHaveBeenNthCalledWith(2, '/Applications/.SLAB.app.webcmd-staging', '/Applications/SLAB.app');
    expect(rename).toHaveBeenNthCalledWith(3, '/Applications/SLAB.app.previous', '/Applications/SLAB.app');
    expect(rm).toHaveBeenCalledTimes(1);
  });
});
