import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { installSlabMacos, type SlabInstallerIo } from './install.js';

const releaseBytes = Buffer.from('signed-slab-dmg');
const releaseSha256 = createHash('sha256').update(releaseBytes).digest('hex');

function fakeInstaller(options: {
  expectedSha256?: string;
  downloadedBytes?: Buffer;
  bundleId?: string;
  canWriteSystemApplications?: boolean;
  verifyManifest?: boolean;
} = {}) {
  const operations: string[] = [];
  const execFile = vi.fn(async (command: string, args: string[]) => {
    if (command === 'hdiutil' && args[0] === 'attach') operations.push('mount-readonly');
    if (command === 'hdiutil' && args[0] === 'detach') operations.push('detach');
    if (command === 'ditto') operations.push('copy-to-staging');
    if (command === 'codesign' && args.includes('--identifier')) operations.push('codesign-verify');
    if (command === 'spctl') operations.push('spctl-verify');
  });
  const io: SlabInstallerIo & { operations(): string[]; execFile: typeof execFile } = {
    homeDir: '/Users/me',
    tempDir: '/tmp',
    fetch: async (url) => url.endsWith('.json')
      ? { ok: true, json: async () => ({ url: 'https://downloads.webcmd.dev/slab/SLAB.dmg', sha256: options.expectedSha256 ?? releaseSha256, signature: 'release-signature' }) }
      : { ok: true, arrayBuffer: async () => (options.downloadedBytes ?? releaseBytes) },
    execFile,
    mkdtemp: async () => '/tmp/slab-install',
    writeFile: async () => { operations.push('download'); },
    sha256: async (bytes) => {
      operations.push('checksum');
      return createHash('sha256').update(bytes).digest('hex');
    },
    mkdir: async () => {},
    rm: vi.fn(async () => { operations.push('cleanup'); }),
    access: async (path) => {
      if (path === '/Applications' && options.canWriteSystemApplications === false) throw new Error('not writable');
    },
    replaceApp: async () => { operations.push('replace-app'); },
    verifyManifest: async () => options.verifyManifest ?? true,
    bundleId: async () => options.bundleId ?? 'dev.webcmd.slab',
    operations: () => operations.filter((operation) => operation !== 'cleanup'),
  };
  return io;
}

function fakeInstallerWithValidDmg() {
  return fakeInstaller();
}

describe('SLAB macOS installer', () => {
  it('verifies SHA-256 before mounting the DMG', async () => {
    const io = fakeInstaller({ expectedSha256: '00'.repeat(32), downloadedBytes: Buffer.from('not-the-release') });

    await expect(installSlabMacos(io)).rejects.toThrow('SLAB installer checksum mismatch');
    expect(io.execFile).not.toHaveBeenCalled();
  });

  it('stages, verifies, and then replaces the app', async () => {
    const io = fakeInstallerWithValidDmg();

    await installSlabMacos(io);

    expect(io.operations()).toEqual([
      'download', 'checksum', 'mount-readonly', 'copy-to-staging',
      'codesign-verify', 'spctl-verify', 'replace-app', 'detach',
    ]);
  });

  it('rejects an unexpected app bundle identifier', async () => {
    const io = fakeInstaller({ bundleId: 'com.example.other' });

    await expect(installSlabMacos(io)).rejects.toThrow('SLAB installer bundle identifier mismatch');
  });

  it('rejects an invalid signed release manifest', async () => {
    const io = fakeInstaller({ verifyManifest: false });

    await expect(installSlabMacos(io)).rejects.toThrow('SLAB installer release signature verification failed');
    expect(io.execFile).not.toHaveBeenCalled();
  });

  it('falls back to the user Applications directory when the system directory is not writable', async () => {
    const io = fakeInstaller({ canWriteSystemApplications: false });

    await expect(installSlabMacos(io)).resolves.toMatchObject({
      executablePath: '/Users/me/Applications/SLAB.app/Contents/MacOS/SLAB',
    });
  });

  it('detaches and removes temporary files when verification fails after mounting', async () => {
    const io = fakeInstaller({ bundleId: 'com.example.other' });

    await expect(installSlabMacos(io)).rejects.toThrow('SLAB installer bundle identifier mismatch');
    expect(io.operations()).toContain('detach');
    expect(io.operations()).not.toContain('replace-app');
    expect(io.rm).toHaveBeenCalledWith('/tmp/slab-install');
  });
});
