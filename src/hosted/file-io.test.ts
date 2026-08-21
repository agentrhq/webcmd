import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVirtualFileMap, createVirtualOutputSink } from './virtual-files.js';
import { VirtualFileMissingError, createRealHostedFileIo, createVirtualHostedFileIo, realHostedFileIo } from './file-io.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function virtualIo(entries: { path: string; content: Uint8Array }[]) {
  const outputs = createVirtualOutputSink();
  return { io: createVirtualHostedFileIo(createVirtualFileMap(entries), outputs), outputs };
}

describe('createVirtualHostedFileIo', () => {
  it('reads a supplied virtual file', async () => {
    const { io } = virtualIo([{ path: 'input.json', content: bytes('{"a":1}') }]);
    expect(await io.readText('input.json')).toBe('{"a":1}');
    expect(await io.readFile('./input.json')).toEqual(bytes('{"a":1}'));
    expect(await io.exists('input.json')).toBe(true);
  });

  it('reports a missing virtual file as a CLI-shaped error, not ENOENT', async () => {
    const { io } = virtualIo([]);
    await expect(io.readText('missing.json')).rejects.toBeInstanceOf(VirtualFileMissingError);
    expect(await io.exists('missing.json')).toBe(false);
  });

  it('refuses a host path instead of falling back to the real filesystem', async () => {
    const { io } = virtualIo([]);
    await expect(io.readText('/etc/passwd')).rejects.toThrow(/relative/);
    await expect(io.readText('../../etc/passwd')).rejects.toThrow(/escapes/);
  });

  it('routes writes into the output sink rather than the filesystem', async () => {
    const { io, outputs } = virtualIo([]);
    await io.writeText('report.csv', 'a,b');
    expect(outputs.files()).toEqual([{ path: 'report.csv', content: bytes('a,b') }]);
  });

  it('treats a supplied virtual file as a regular file', async () => {
    const { io } = virtualIo([{ path: 'input.json', content: bytes('{"a":1}') }]);
    expect(await io.readRegularFile('input.json')).toEqual(bytes('{"a":1}'));
  });
});

describe('realHostedFileIo', () => {
  it('exposes the same shape as the virtual implementation', () => {
    expect(Object.keys(realHostedFileIo).sort()).toEqual(
      ['exists', 'readFile', 'readRegularFile', 'readText', 'writeFile', 'writeText'].sort(),
    );
  });

  it('rejects a non-regular path when a hosted command requires a file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'webcmd-file-io-'));
    try {
      await expect(realHostedFileIo.readRegularFile(directory)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('does not follow symlinks when a hosted command requires a file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'webcmd-file-io-'));
    const target = path.join(directory, 'target.txt');
    const link = path.join(directory, 'target-link.txt');
    try {
      await writeFile(target, 'secret');
      await symlink(target, link);
      await expect(realHostedFileIo.readRegularFile(link)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('cleans the temporary file when replacing a destination fails', async () => {
    const contents = new Map<string, Uint8Array>([['result.txt', bytes('old contents')]]);
    const written: Uint8Array[] = [];
    const removed: string[] = [];
    const io = createRealHostedFileIo({
      mkdir: async () => undefined,
      open: async (filePath: string) => ({
        writeFile: async (body: Uint8Array) => {
          written.push(body);
          contents.set(filePath, body);
        },
        sync: async () => undefined,
        close: async () => undefined,
      }),
      rename: async () => { throw new Error('rename failed'); },
      rm: async (filePath: string) => {
        removed.push(filePath);
        contents.delete(filePath);
      },
    });

    await expect(io.writeText('result.txt', 'new contents')).rejects.toThrow('rename failed');
    expect(new TextDecoder().decode(written[0]!)).toBe('new contents');
    expect(new TextDecoder().decode(contents.get('result.txt')!)).toBe('old contents');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/^\.result\.txt\..+\.tmp$/);
  });
});
