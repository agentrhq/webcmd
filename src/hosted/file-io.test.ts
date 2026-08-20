import { describe, expect, it } from 'vitest';
import { createVirtualFileMap, createVirtualOutputSink } from './virtual-files.js';
import { VirtualFileMissingError, createVirtualHostedFileIo, realHostedFileIo } from './file-io.js';

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
});

describe('realHostedFileIo', () => {
  it('exposes the same shape as the virtual implementation', () => {
    expect(Object.keys(realHostedFileIo).sort()).toEqual(
      ['exists', 'readFile', 'readText', 'writeFile', 'writeText'].sort(),
    );
  });
});
